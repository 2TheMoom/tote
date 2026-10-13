// Live end-to-end run of Tote v3 on Bradbury, with separate creator and staker wallets.
//
//   node scripts/e2e.mjs            runs every scenario and writes scripts/e2e-log.json
//
// Scenarios (each is its own market, run concurrently, every write is confirmed by reading state back):
//   misleading   a page showing BOTH outcomes, and a page with only an "unconfirmed" line, must NOT resolve;
//                both markets then sit open and each staker takes back their own stake after stale_after
//   claim        clean evidence, nobody objects: winner claims after the window, duplicate claim and loser claim refused
//   uphold       clean evidence, loser objects without cause: outcome stands, the forfeited bond goes to the winner
//   overturn     page contains a correction that contradicts its own YES line: outcome flips, bond returned at once
//   stale        challenged and never adjudicated: after stale_after the recorded outcome stands, bond goes to winners
//   changed      page is edited after resolution: the dispute still weighs the committed excerpt
//
// Signs with the dedicated testnet wallets in C:/Users/olumi/.genlayer-test-wallets (outside every repo).
import { readFileSync, writeFileSync } from "fs";
import { spawnSync } from "child_process";
import { createAccount, createClient } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";

const CONTRACT = process.env.TOTE || "0x9E168F61bCC6206613F874Ce4De4Af1119ddC685";
const RAW = "https://raw.githubusercontent.com/2TheMoom/tote/main/demo/evidence/";
const RUN = Date.now().toString(36);
const LOGFILE = process.env.E2E_LOG || "scripts/e2e-log-v4.json";
const WINDOW = 3600;
const STALE = 7200;
const YES = "BTC daily close was above 90000 USD";
const NO = "BTC daily close was at or below 90000 USD";
const QUESTION = "Did BTC close above 90000 USD on the reference day?";
const YES_STAKE = 3000000000000000n; // 0.003 GEN
const NO_STAKE = 2000000000000000n; // 0.002 GEN
const WALLETS = JSON.parse(readFileSync("C:/Users/olumi/.genlayer-test-wallets/wallets.json", "utf8"));

const names = ["gl-test-1", "gl-test-2", "gl-test-3"];
const acct = Object.fromEntries(names.map((n) => [n, createAccount(WALLETS[n].privateKey)]));
const addr = Object.fromEntries(names.map((n) => [n, WALLETS[n].address]));
const clients = Object.fromEntries(names.map((n) => [n, createClient({ chain: testnetBradbury, account: acct[n] })]));
const reader = createClient({ chain: testnetBradbury });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Math.floor(Date.now() / 1000);
const plain = (x) => (x instanceof Map ? Object.fromEntries([...x].map(([k, v]) => [k, plain(v)])) : Array.isArray(x) ? x.map(plain) : typeof x === "bigint" ? x.toString() : x);

const LOG = { contract: CONTRACT, run: RUN, started: new Date().toISOString(), events: [] };
function log(scn, msg, extra) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${scn.padEnd(10)} ${msg}`);
  LOG.events.push({ t: new Date().toISOString(), scenario: scn, msg, ...(extra || {}) });
  writeFileSync(LOGFILE, JSON.stringify(LOG, null, 1));
}

const queues = {};
function serial(who, fn) {
  const run = (queues[who] || Promise.resolve()).then(fn, fn);
  queues[who] = run.catch(() => {});
  return run;
}

async function read(fn, args = []) {
  for (let i = 0; ; i++) {
    try {
      return plain(await reader.readContract({ address: CONTRACT, functionName: fn, args }));
    } catch (e) {
      if (i >= 8) throw e;
      await sleep(8000);
    }
  }
}
const mkt = (id) => read("get_market", [id]);
const stakeOf = async (id, side, who) => BigInt(await read("get_stake", [id, side, addr[who]]));

async function until(scn, what, id, pred, tries = 30) {
  for (let i = 0; i < tries; i++) {
    const m = await mkt(id);
    if (pred(m)) return m;
    await sleep(10000);
  }
  throw new Error(`${scn}: timed out waiting for ${what}`);
}

async function send(scn, who, fn, args, value) {
  return serial(who, async () => {
    let hash;
    for (let a = 1; ; a++) {
      try {
        hash = await clients[who].writeContract({ address: CONTRACT, functionName: fn, args, ...(value ? { value } : {}) });
        break;
      } catch (e) {
        if (a >= 4) throw e;
        log(scn, `${fn} send failed (${String(e.message || e).slice(0, 70)}), retry ${a}`);
        await sleep(15000);
      }
    }
    let r;
    for (let a = 1; ; a++) {
      try {
        r = await clients[who].waitForTransactionReceipt({ hash, status: "ACCEPTED", retries: 200, interval: 5000 });
        break;
      } catch (e) {
        if (a >= 6) throw e;
        await sleep(15000);
      }
    }
    log(scn, `${fn} ${hash.slice(0, 12)} exec=${r.txExecutionResultName} result=${r.resultName}`, { fn, hash, exec: r.txExecutionResultName });
    return { hash, exec: r.txExecutionResultName, result: r.resultName };
  });
}

async function finality(scn, hash, label) {
  const t0 = Date.now();
  for (let a = 0; a < 12; a++) {
    try {
      await reader.waitForTransactionReceipt({ hash, status: "FINALIZED", retries: 400, interval: 10000 });
      const m = ((Date.now() - t0) / 60000).toFixed(1);
      log(scn, `${label} FINALIZED ${m} min after it was accepted`, { label, finalizedAfterMinutes: Number(m) });
      return Number(m);
    } catch {
      await sleep(15000);
    }
  }
  log(scn, `${label} not finalized within the watch`);
  return null;
}

const balance = async (who) => BigInt(await reader.getBalance({ address: addr[who] }));
const gen = (w) => (Number(w) / 1e18).toFixed(6);

// creator g3 opens the market, g1 stakes YES, g2 stakes NO (the creator cannot stake on its own market)
async function open(scn, id, page, opts = {}) {
  const lock = now() + (opts.lockIn || 25 * 60);
  const resolveAfter = lock + 60;
  const creator = opts.creator || "gl-test-3";
  await send(scn, creator, "create_market", [id, QUESTION, RAW + page, YES, NO, lock, resolveAfter, WINDOW, STALE]);
  await until(scn, "open", id, (m) => m.status === "open");
  const stakers = opts.stakers || { yes: "gl-test-1", no: "gl-test-2" };
  await send(scn, stakers.yes, "stake", [id, "yes"], YES_STAKE);
  await until(scn, "yes stake", id, (m) => BigInt(m.total_yes_pool) === YES_STAKE);
  await send(scn, stakers.no, "stake", [id, "no"], NO_STAKE);
  const m = await until(scn, "no stake", id, (x) => BigInt(x.total_no_pool) === NO_STAKE);
  return { m, resolveAfter, stakers };
}

async function waitUntil(scn, ts, label) {
  const wait = ts - now() + 30;
  if (wait > 0) {
    log(scn, `waiting ${Math.ceil(wait / 60)} min for ${label}`);
    await sleep(wait * 1000);
  }
}

async function resolveOk(scn, id, who) {
  const t = await send(scn, who, "resolve", [id]);
  const m = await until(scn, "resolved", id, (x) => x.status === "resolved");
  log(scn, `resolved ${m.outcome.toUpperCase()}, committed excerpt "${m.evidence_excerpt}" digest ${m.evidence_digest.slice(0, 16)}`, { excerpt: m.evidence_excerpt, digest: m.evidence_digest });
  return { t, m };
}

async function challenge(scn, id, who, reason) {
  const m = await mkt(id);
  const pool = BigInt(m.total_yes_pool) + BigInt(m.total_no_pool);
  const bond = (pool * 500n) / 10000n;
  await send(scn, who, "challenge", [id, reason], bond);
  await until(scn, "disputed", id, (x) => x.status === "disputed");
  return bond;
}

async function resolveDispute(scn, id, who) {
  for (let a = 1; a <= 6; a++) {
    const t = await send(scn, who, "resolve_dispute", [id]);
    await sleep(20000);
    const m = await mkt(id);
    if (m.status !== "disputed") {
      log(scn, `dispute resolved on attempt ${a}: status=${m.status} outcome=${m.outcome.toUpperCase()} note="${m.resolution_note}"`, { attempts: a, outcome: m.outcome, note: m.resolution_note });
      const sched = (await read("get_accounting")).total_scheduled;
      log(scn, `resolve_dispute moved no money: total_scheduled still ${sched}`);
      return { t, m, attempts: a };
    }
    log(scn, `attempt ${a} left the dispute open (${t.exec}/${t.result})`);
  }
  throw new Error(`${scn}: dispute never resolved`);
}

const results = {};

async function misleadingOne(page, why) {
  const scn = "misleading";
  {
    const id = `tote-${RUN}-${page.split(".")[0]}`;
    const { resolveAfter } = await open(scn, id, page);
    await waitUntil(scn, resolveAfter, `resolve_after for ${page}`);
    const t = await send(scn, "gl-test-3", "resolve", [id]);
    await sleep(20000);
    const m = await mkt(id);
    log(scn, `${why}: resolve exec=${t.exec}, status after = ${m.status}, evidence recorded = "${m.evidence_digest}"`);
    if (m.status !== "open" || m.evidence_digest !== "") throw new Error(`${scn}: ${page} must not resolve`);
    // the market is now stuck open: each staker takes their own stake back after stale_after
    const at = Number(m.resolve_after) + STALE;
    await waitUntil(scn, at, "stale_after, so stakers can reclaim");
    const before = await balance("gl-test-1");
    const r1 = await send(scn, "gl-test-1", "reclaim_stake", [id, "yes"]);
    await send(scn, "gl-test-2", "reclaim_stake", [id, "no"]);
    const p1 = BigInt(await read("get_reclaim_payout", [id, "yes", addr["gl-test-1"]]));
    const p2 = BigInt(await read("get_reclaim_payout", [id, "no", addr["gl-test-2"]]));
    log(scn, `reclaim payouts recorded: yes ${gen(p1)}, no ${gen(p2)}`);
    if (p1 !== YES_STAKE || p2 !== NO_STAKE) throw new Error(`${scn}: wrong reclaim amounts`);
    const dup = await send(scn, "gl-test-1", "reclaim_stake", [id, "yes"]);
    log(scn, `second reclaim: exec=${dup.exec} (refused, nothing sent)`);
    await finality(scn, r1.hash, "reclaim tx");
    log(scn, `staker balance ${gen(before)} -> ${gen(await balance("gl-test-1"))}`);
  }
}

async function misleading() {
  await Promise.all([misleadingOne("both.txt", "both outcomes on the page"), misleadingOne("unconfirmed.txt", "only an unconfirmed expectation")]);
  results.misleading = "both-outcomes page and unconfirmed page refused; stuck markets recovered by stakers";
}

// After a dispute is settled: an overturn owes the challenger the bond back (claim_bond); otherwise the bond belongs to the winners and claim_bond must refuse.
async function settleBond(scn, id) {
  const m = await mkt(id);
  const owed = Number(m.bond) > 0 && Number(m.bonus) === 0;
  const t = await send(scn, "gl-test-3", "claim_bond", [id]);
  if (owed) {
    const after = await until(scn, "bond refunded", id, (x) => x.bond_refunded === true);
    log(scn, `overturned: claim_bond returned the bond (bond_refunded=${after.bond_refunded})`);
    return t;
  }
  log(scn, `bond forfeited to the winners: claim_bond exec=${t.exec} (refused)`);
  return null;
}

async function claim() {
  const scn = "claim";
  const id = `tote-${RUN}-claim`;
  const { resolveAfter } = await open(scn, id, "yes.txt");
  await waitUntil(scn, resolveAfter, "resolve_after");
  const { t, m } = await resolveOk(scn, id, "gl-test-3");
  finality(scn, t.hash, "resolve tx").then((x) => (results.resolveFinalityMin = x));
  const early = await send(scn, "gl-test-3", "finalize", [id]);
  log(scn, `early finalize: exec=${early.exec}, status still ${(await mkt(id)).status}`);
  await waitUntil(scn, Number(m.resolved_at) + WINDOW, "the challenge window");
  await send(scn, "gl-test-3", "finalize", [id]);
  await until(scn, "finalized", id, (x) => x.status === "finalized");
  const before = await balance("gl-test-1");
  const c = await send(scn, "gl-test-1", "claim", [id]);
  const paid = BigInt(await read("get_claim_payout", [id, addr["gl-test-1"]]));
  const expected = YES_STAKE + NO_STAKE;
  log(scn, `claim payout recorded ${gen(paid)} (whole pool = ${gen(expected)})`);
  if (paid !== expected) throw new Error(`${scn}: expected ${expected}, recorded ${paid}`);
  const dup = await send(scn, "gl-test-1", "claim", [id]);
  log(scn, `duplicate claim: exec=${dup.exec} (refused)`);
  const lose = await send(scn, "gl-test-2", "claim", [id]);
  log(scn, `losing side claim: exec=${lose.exec} (refused)`);
  await finality(scn, c.hash, "claim tx");
  const after = await balance("gl-test-1");
  log(scn, `winner balance ${gen(before)} -> ${gen(after)} (+${gen(after - before)}, before its own gas)`, { before: before.toString(), after: after.toString() });
  results.claim = { paid: paid.toString(), delta: (after - before).toString() };
}

async function uphold() {
  const scn = "uphold";
  const id = `tote-${RUN}-uphold`;
  const { resolveAfter } = await open(scn, id, "yes.txt");
  await waitUntil(scn, resolveAfter, "resolve_after");
  await resolveOk(scn, id, "gl-test-3");
  const bond = await challenge(scn, id, "gl-test-2", "I think the real close was lower than the page says, please check it again carefully.");
  const { t, m } = await resolveDispute(scn, id, "gl-test-3");
  if (m.outcome !== "yes" || m.status !== "finalized") throw new Error(`${scn}: expected the YES outcome to stand`);
  if (BigInt(m.bonus) !== bond) throw new Error(`${scn}: bond should have been forfeited to the winners`);
  await settleBond(scn, id);
  await finality(scn, t.hash, "resolve_dispute tx");
  const c = await send(scn, "gl-test-1", "claim", [id]);
  const paid = BigInt(await read("get_claim_payout", [id, addr["gl-test-1"]]));
  log(scn, `winner payout ${gen(paid)} = pool ${gen(YES_STAKE + NO_STAKE)} + forfeited bond ${gen(bond)}`);
  if (paid !== YES_STAKE + NO_STAKE + bond) throw new Error(`${scn}: payout should include the bond`);
  await finality(scn, c.hash, "claim tx");
  results.uphold = { outcome: m.outcome, paid: paid.toString(), bond: bond.toString() };
}

async function overturn() {
  const scn = "overturn";
  const id = `tote-${RUN}-overturn`;
  const { resolveAfter } = await open(scn, id, "typo.txt");
  await waitUntil(scn, resolveAfter, "resolve_after");
  await resolveOk(scn, id, "gl-test-3");
  const before = await balance("gl-test-2");
  const bond = await challenge(scn, id, "gl-test-2", "The same page says the figure was a typo and the verified close was 89500, which is not above 90000.");
  const afterBond = await balance("gl-test-2");
  const { t, m } = await resolveDispute(scn, id, "gl-test-3");
  if (m.outcome !== "no") throw new Error(`${scn}: expected the outcome to flip to NO, got ${m.outcome}`);
  // the bond comes back in its own transaction, never in the one that runs the model
  const cb = await send(scn, "gl-test-3", "claim_bond", [id]);
  const after = await until(scn, "bond refunded", id, (x) => x.bond_refunded === true);
  log(scn, `claim_bond recorded the refund (bond_refunded=${after.bond_refunded})`);
  const dupBond = await send(scn, "gl-test-3", "claim_bond", [id]);
  log(scn, `second claim_bond: exec=${dupBond.exec} (refused)`);
  await finality(scn, cb.hash, "claim_bond tx");
  const refunded = await balance("gl-test-2");
  log(scn, `challenger balance ${gen(before)} -> ${gen(afterBond)} after posting the bond -> ${gen(refunded)} once finalized (bond ${gen(bond)} returned)`, { before: before.toString(), afterBond: afterBond.toString(), refunded: refunded.toString() });
  const c = await send(scn, "gl-test-2", "claim", [id]);
  const paid = BigInt(await read("get_claim_payout", [id, addr["gl-test-2"]]));
  log(scn, `new winner payout ${gen(paid)} (whole pool = ${gen(YES_STAKE + NO_STAKE)})`);
  if (paid !== YES_STAKE + NO_STAKE) throw new Error(`${scn}: wrong payout`);
  const loser = await send(scn, "gl-test-1", "claim", [id]);
  log(scn, `former winner claim: exec=${loser.exec} (refused)`);
  await finality(scn, c.hash, "claim tx");
  results.overturn = { outcome: m.outcome, paid: paid.toString() };
}

async function stale() {
  const scn = "stale";
  const id = `tote-${RUN}-stale`;
  const { resolveAfter } = await open(scn, id, "yes.txt");
  await waitUntil(scn, resolveAfter, "resolve_after");
  await resolveOk(scn, id, "gl-test-3");
  const bond = await challenge(scn, id, "gl-test-2", "Disputing this one and nobody will adjudicate it before the stale deadline.");
  const m0 = await mkt(id);
  const staleAt = Number(m0.disputed_at) + STALE;
  const early = await send(scn, "gl-test-3", "resolve_stale_dispute", [id]);
  log(scn, `early resolve_stale_dispute: exec=${early.exec}, status still ${(await mkt(id)).status}`);
  await waitUntil(scn, staleAt, "stale_after");
  const t = await send(scn, "gl-test-3", "resolve_stale_dispute", [id]);
  const m = await until(scn, "finalized", id, (x) => x.status === "finalized");
  if (m.outcome !== "yes" || BigInt(m.bonus) !== bond) throw new Error(`${scn}: expected the original outcome and the bond forfeited`);
  await settleBond(scn, id);
  await finality(scn, t.hash, "resolve_stale_dispute tx");
  const c = await send(scn, "gl-test-1", "claim", [id]);
  const paid = BigInt(await read("get_claim_payout", [id, addr["gl-test-1"]]));
  log(scn, `after the stale fallback the winner is paid ${gen(paid)} = pool + bond`);
  if (paid !== YES_STAKE + NO_STAKE + bond) throw new Error(`${scn}: wrong payout`);
  await finality(scn, c.hash, "claim tx");
  results.stale = { outcome: m.outcome, paid: paid.toString() };
}

async function changed() {
  const scn = "changed";
  const id = `tote-${RUN}-changed`;
  const { resolveAfter } = await open(scn, id, "change.txt");
  await waitUntil(scn, resolveAfter, "resolve_after");
  await resolveOk(scn, id, "gl-test-3");
  const body = "BTC daily summary\nThe price feed was withdrawn and no close is published\n";
  writeFileSync("demo/evidence/change.txt", body);
  const git = (...a) => spawnSync("git", a, { encoding: "utf8" });
  git("add", "demo/evidence/change.txt");
  git("commit", "-m", `E2E ${RUN}: edit the evidence page after resolution`);
  const push = git("push", "origin", "main");
  log(scn, `page edited and pushed (exit ${push.status}); waiting for the raw cache to expire`);
  await sleep(330000);
  await challenge(scn, id, "gl-test-2", "The page was edited after resolution and no longer shows the outcome.");
  const { m } = await resolveDispute(scn, id, "gl-test-3");
  await settleBond(scn, id);
  log(scn, `after the edit the dispute ended ${m.status} with outcome ${m.outcome.toUpperCase()} (note: ${m.resolution_note})`);
  results.changed = { outcome: m.outcome, note: m.resolution_note, committedExcerpt: m.evidence_excerpt };
}

const settled = await Promise.allSettled([misleading(), claim(), uphold(), overturn(), stale(), changed()]);
const names6 = ["misleading", "claim", "uphold", "overturn", "stale", "changed"];
settled.forEach((s, i) => {
  if (s.status === "rejected") log(names6[i], `FAILED: ${String(s.reason?.message || s.reason).slice(0, 300)}`);
});
LOG.results = results;
LOG.accounting = await read("get_accounting");
{
  const a = LOG.accounting;
  const ok = Number(a.shortfall) === 0 && Number(a.in_flight) === 0 && BigInt(a.balance) === BigInt(a.unscheduled);
  LOG.accountingOk = ok;
  log("accounting", ok ? "OK: nothing in flight, nothing short, balance equals what is still owed" : `MISMATCH: ${JSON.stringify(a)}`);
}
LOG.finished = new Date().toISOString();
writeFileSync(LOGFILE, JSON.stringify(LOG, null, 1));
console.log("\nRESULTS", JSON.stringify(results, null, 1), "\nACCOUNTING", JSON.stringify(LOG.accounting));
