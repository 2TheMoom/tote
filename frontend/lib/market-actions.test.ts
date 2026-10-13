import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { decodeMarket } from "./contracts/decode.ts";
import type { Market } from "./contracts/types.ts";
import {
  EMPTY_POSITION,
  availableActions,
  bondFor,
  challengeDeadline,
  challengeOpen,
  disputeIsStale,
  disputeStaleAt,
  expectedStatus,
  movesFunds,
  readyToFinalize,
  recoveryNote,
  stakesReclaimable,
  type Position,
} from "./market-actions.ts";
import { formatGen, BOND_BPS, MAX_MARKER, MAX_STALE, MAX_WINDOW, MIN_MARKER, MIN_STALE, MIN_WINDOW, markerProblem, normalizeLine, requiredBond, urlProblem } from "./limits.ts";

const CREATOR = "0x1111111111111111111111111111111111111111";
const ALICE = "0x2222222222222222222222222222222222222222";
const BOB = "0x3333333333333333333333333333333333333333";
const OUTSIDER = "0x4444444444444444444444444444444444444444";
const T = 1_800_000_000;
const HOUR = 3600;

function market(over: Partial<Market>): Market {
  return {
    creator: CREATOR,
    question: "q",
    verification_url: "https://example.com/x",
    yes_marker: "outcome was yes 1",
    no_marker: "outcome was no 1",
    lock_time: String(T + HOUR),
    resolve_after: String(T + 2 * HOUR),
    challenge_window: String(HOUR),
    stale_after: String(2 * HOUR),
    status: "open",
    outcome: "",
    resolved_at: "0",
    disputed_at: "0",
    bond: "0",
    bonus: "0",
    evidence_excerpt: "",
    evidence_digest: "",
    dispute_reason: "",
    resolution_note: "",
    total_yes_pool: "600",
    total_no_pool: "400",
    ...over,
  };
}

const pos = (over: Partial<Position>): Position => ({ ...EMPTY_POSITION, ...over });
const yesStaker = pos({ yesStake: BigInt(600) });
const noStaker = pos({ noStake: BigInt(400) });

describe("limits match the contract", () => {
  const source = readFileSync(new URL("../../contracts/tote.py", import.meta.url), "utf8");
  const constant = (name: string) => {
    const m = source.match(new RegExp(`^${name}\\s*=\\s*([0-9 *]+)`, "m"));
    assert.ok(m, `${name} not found in the contract`);
    return m[1].split("*").reduce((a, b) => a * Number(b.trim()), 1);
  };
  it("every constant the form validates against is the contract's", () => {
    assert.equal(MIN_WINDOW, constant("MIN_WINDOW"));
    assert.equal(MAX_WINDOW, constant("MAX_WINDOW"));
    assert.equal(MIN_STALE, constant("MIN_STALE"));
    assert.equal(MAX_STALE, constant("MAX_STALE"));
    assert.equal(BOND_BPS, constant("BOND_BPS"));
    assert.equal(MIN_MARKER, constant("MIN_MARKER"));
    assert.equal(MAX_MARKER, constant("MAX_MARKER"));
  });
  it("the challenge window is longer than the ~30 minute finality measured on Bradbury", () => {
    assert.ok(MIN_WINDOW >= 2 * 30 * 60);
  });
});

describe("validation mirrors the contract", () => {
  it("normalizes like the contract", () => {
    assert.equal(normalizeLine("  It’s   Done Now "), "it's done now");
  });
  it("refuses short, digit-less and letter-less markers", () => {
    assert.ok(markerProblem("done 1"));
    assert.ok(markerProblem("closed above ninety thousand"));
    assert.ok(markerProblem("123456789012"));
    assert.equal(markerProblem("BTC daily close was above 90000 USD"), null);
  });
  it("refuses the urls the contract refuses", () => {
    for (const u of ["http://a.com/x", "https://127.0.0.1/x", "https://localhost/x", "https://a.com:8080/x", "https://u:p@a.com/x", "https://printer.local/x"]) {
      assert.ok(urlProblem(u), u);
    }
    assert.equal(urlProblem("https://raw.githubusercontent.com/o/r/main/price.txt"), null);
  });
  it("the bond is 5% of all stakes, at least 1", () => {
    assert.equal(requiredBond(BigInt(1000)), BigInt(50));
    assert.equal(requiredBond(BigInt(5)), BigInt(1));
    assert.equal(bondFor(market({})), BigInt(50));
  });
});

describe("decodeMarket", () => {
  it("decodes the v3 fields from the Map genlayer-js returns", () => {
    const m = decodeMarket(new Map<string, unknown>([["status", "finalized"], ["bonus", 50n], ["challenge_window", 3600n], ["evidence_digest", "ab12"]]));
    assert.equal(m.status, "finalized");
    assert.equal(m.bonus, "50");
    assert.equal(m.challenge_window, "3600");
    assert.equal(m.evidence_digest, "ab12");
  });
  it("falls back to safe defaults", () => {
    const m = decodeMarket(new Map());
    assert.equal(m.status, "open");
    assert.equal(m.stale_after, "0");
  });
});

describe("derived times follow the contract", () => {
  const resolved = market({ status: "resolved", outcome: "yes", resolved_at: String(T), challenge_window: String(HOUR) });
  it("the challenge window is resolved_at + challenge_window, inclusive of its last second", () => {
    assert.equal(challengeDeadline(resolved), T + HOUR);
    assert.equal(challengeOpen(resolved, T + HOUR), true);
    assert.equal(challengeOpen(resolved, T + HOUR + 1), false);
    assert.equal(readyToFinalize(resolved, T + HOUR), false);
    assert.equal(readyToFinalize(resolved, T + HOUR + 1), true);
  });
  it("there is no deadline before resolution", () => {
    assert.equal(challengeDeadline(market({})), 0);
  });
  it("a dispute is stale at disputed_at + stale_after, to the second", () => {
    const d = market({ status: "disputed", disputed_at: String(T), stale_after: String(2 * HOUR) });
    assert.equal(disputeStaleAt(d), T + 2 * HOUR);
    assert.equal(disputeIsStale(d, T + 2 * HOUR - 1), false);
    assert.equal(disputeIsStale(d, T + 2 * HOUR), true);
  });
  it("an open market is reclaimable stale_after past resolve_after", () => {
    const m = market({});
    const at = T + 2 * HOUR + 2 * HOUR;
    assert.equal(stakesReclaimable(m, at - 1), false);
    assert.equal(stakesReclaimable(m, at), true);
    assert.equal(stakesReclaimable(market({ status: "abandoned" }), T), true);
    assert.equal(stakesReclaimable(market({ status: "resolved" }), at + 1e9), false);
  });
});

describe("availableActions follows the contract's access rules", () => {
  const act = (m: Market, address: string | null, now: number, position?: Position) => availableActions(m, { address, now, position });

  it("open: anyone but the creator stakes before lock_time", () => {
    const m = market({});
    assert.deepEqual(act(m, ALICE, T), ["stake"]);
    assert.deepEqual(act(m, CREATOR, T), []);
    assert.deepEqual(act(m, null, T), []);
    assert.deepEqual(act(m, ALICE, T + HOUR), []); // lock_time reached
  });

  it("open: resolving needs resolve_after and stakes on both sides", () => {
    const m = market({});
    assert.deepEqual(act(m, OUTSIDER, T + 2 * HOUR - 1), []);
    assert.deepEqual(act(m, OUTSIDER, T + 2 * HOUR), ["resolve"]);
    assert.deepEqual(act(market({ total_no_pool: "0" }), OUTSIDER, T + 2 * HOUR), []);
  });

  it("resolved: only a staker challenges inside the window; anyone finalizes after it", () => {
    const m = market({ status: "resolved", outcome: "yes", resolved_at: String(T), challenge_window: String(HOUR) });
    assert.deepEqual(act(m, ALICE, T + HOUR, noStaker), ["challenge"]);
    assert.deepEqual(act(m, ALICE, T + HOUR, yesStaker), ["challenge"]); // either side may challenge
    assert.deepEqual(act(m, OUTSIDER, T + HOUR), []);
    assert.deepEqual(act(m, CREATOR, T + HOUR), []);
    assert.deepEqual(act(m, OUTSIDER, T + HOUR + 1), ["finalize"]);
    assert.deepEqual(act(m, ALICE, T + HOUR + 1, noStaker), ["finalize"]);
  });

  it("disputed: anyone connected can resolve; the stale settlement appears only when stale", () => {
    const m = market({ status: "disputed", outcome: "yes", resolved_at: String(T), disputed_at: String(T + 10), stale_after: String(2 * HOUR) });
    assert.deepEqual(act(m, OUTSIDER, T + 20), ["resolve_dispute"]);
    assert.deepEqual(act(m, null, T + 20), []);
    assert.deepEqual(act(m, OUTSIDER, T + 10 + 2 * HOUR - 1), ["resolve_dispute"]);
    assert.deepEqual(act(m, OUTSIDER, T + 10 + 2 * HOUR), ["resolve_dispute", "resolve_stale_dispute"]);
  });

  it("finalized: only a winning, unclaimed staker claims", () => {
    const m = market({ status: "finalized", outcome: "yes" });
    assert.deepEqual(act(m, ALICE, T, yesStaker), ["claim"]);
    assert.deepEqual(act(m, ALICE, T, noStaker), []);
    assert.deepEqual(act(m, ALICE, T, { ...yesStaker, claimed: true }), []);
    assert.deepEqual(act(m, OUTSIDER, T, EMPTY_POSITION), []);
    assert.deepEqual(act(m, null, T, yesStaker), []);
  });

  it("an overturned outcome pays the other side", () => {
    const m = market({ status: "finalized", outcome: "no" });
    assert.deepEqual(act(m, ALICE, T, noStaker), ["claim"]);
    assert.deepEqual(act(m, ALICE, T, yesStaker), []);
  });

  it("reclaim: each side separately, once, only when recoverable", () => {
    const stuck = market({});
    const at = T + 4 * HOUR;
    const both = pos({ yesStake: BigInt(5), noStake: BigInt(7) });
    assert.deepEqual(act(stuck, ALICE, at - 1, both), ["resolve"]);
    assert.deepEqual(act(stuck, ALICE, at, both), ["resolve", "reclaim_yes", "reclaim_no"]);
    assert.deepEqual(act(stuck, ALICE, at, { ...both, reclaimedYes: true }), ["resolve", "reclaim_no"]);
    assert.deepEqual(act(market({ status: "abandoned" }), ALICE, T, yesStaker), ["reclaim_yes"]);
  });
});

describe("wording and write confirmation", () => {
  it("the stale dispute note says the outcome stands and the bond goes to the winners", () => {
    const d = market({ status: "disputed", disputed_at: String(T), stale_after: String(2 * HOUR) });
    const note = recoveryNote(d, T + 2 * HOUR);
    assert.match(note ?? "", /outcome stands/);
    assert.match(note ?? "", /bond goes to the winners/);
    assert.equal(recoveryNote(d, T + 1), null);
  });
  it("each write has the status it must read back", () => {
    assert.ok(expectedStatus("resolve")!(market({ status: "resolved" })));
    assert.ok(!expectedStatus("resolve")!(market({ status: "open" })));
    assert.ok(expectedStatus("challenge")!(market({ status: "disputed" })));
    assert.ok(!expectedStatus("resolve_dispute")!(market({ status: "disputed" })));
    assert.ok(expectedStatus("resolve_stale_dispute")!(market({ status: "finalized" })));
    assert.equal(expectedStatus("stake"), null); // confirmed against the wallet's own stake instead
    assert.equal(expectedStatus("claim"), null);
  });
  it("only fund-moving actions wait for finality", () => {
    assert.ok(movesFunds("claim") && movesFunds("reclaim_yes") && movesFunds("reclaim_no") && movesFunds("resolve_dispute"));
    assert.ok(!movesFunds("stake") && !movesFunds("resolve") && !movesFunds("create"));
  });
});

describe("formatGen", () => {
  it("keeps precision for small amounts instead of rounding to zero", () => {
    assert.equal(formatGen("200000000000000"), "0.0002");
    assert.equal(formatGen("2000000000000000"), "0.002");
    assert.equal(formatGen("1100000000000000"), "0.0011");
    assert.equal(formatGen("1000000000"), "0.000000001");
  });
  it("shows at least three decimals and rounds large amounts", () => {
    assert.equal(formatGen("0"), "0.000");
    assert.equal(formatGen("500000000000000000"), "0.500");
    assert.equal(formatGen("2500000000000000000"), "2.500");
    assert.equal(formatGen("not a number"), "0.000");
  });
});
