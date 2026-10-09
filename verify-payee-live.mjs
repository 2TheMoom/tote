// Live proof that a Tote payout is delivered exactly once.
//
// Runs the undisputed happy path for real: create_market -> stake (both
// sides) -> resolve -> finalize -> claim. Then tries to claim again, which
// must fail, and prints get_accounting(): right after the claim, in_flight
// equals the payout (scheduled, waiting for the claim transaction to
// finalize). Once it finalizes the transfer lands and in_flight returns to
// 0; watch that with
//   genlayer call <CONTRACT> get_accounting
//
// Usage: node verify-payee-live.mjs
// Signs with the dedicated testnet wallets in
// C:/Users/olumi/.genlayer-test-wallets/wallets.json (outside every repo).

import { readFileSync } from "fs";
import { createAccount, createClient } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";

const CONTRACT = "0xC8879351B08bD2b0176a025a03a0F11b388e694F";
const MARKET_ID = "tote-once-" + Date.now();
const YES_VALUE = 2000000000000000n; // 0.002 GEN
const NO_VALUE = 1000000000000000n; // 0.001 GEN
const URL = "https://raw.githubusercontent.com/genlayerlabs/genlayer-project-boilerplate/main/README.md";
const YES_MARKER = "football bets";
const NO_MARKER = "this text never appears in that readme";

const WALLETS = JSON.parse(readFileSync("C:/Users/olumi/.genlayer-test-wallets/wallets.json", "utf8"));

function wallet(name) {
  const w = WALLETS[name];
  if (!w) throw new Error(`No test wallet named ${name}`);
  return createAccount(w.privateKey);
}

async function send(client, functionName, args, value) {
  const hash = await client.writeContract({ address: CONTRACT, functionName, args, ...(value ? { value } : {}) });
  console.log(`  ${functionName}: ${hash}`);
  let receipt;
  for (let attempt = 1; ; attempt++) {
    try {
      receipt = await client.waitForTransactionReceipt({ hash, retries: 200 });
      break;
    } catch (e) {
      // A dropped RPC connection while polling doesn't mean the transaction failed.
      if (attempt >= 10) throw e;
      console.log(`  (receipt poll failed, retrying: ${String(e.message || e).slice(0, 80)})`);
      await new Promise((r) => setTimeout(r, 15000));
    }
  }
  console.log(`  exec=${receipt.txExecutionResultName}`);
  return receipt;
}

async function accounting(client) {
  const a = await client.readContract({ address: CONTRACT, functionName: "get_accounting", args: [] });
  console.log("  get_accounting:", Object.fromEntries(a instanceof Map ? a : Object.entries(a)));
}

async function main() {
  const creator = createClient({ chain: testnetBradbury, account: wallet("gl-test-3") });
  const yes = createClient({ chain: testnetBradbury, account: wallet("gl-test-1") });
  const no = createClient({ chain: testnetBradbury, account: wallet("gl-test-2") });

  const lockTime = Math.floor(Date.now() / 1000) + 150;
  const resolveAfter = lockTime + 30;

  console.log(`\n1. create_market ${MARKET_ID}...`);
  await send(creator, "create_market", [
    MARKET_ID, "Does the boilerplate README mention football bets?", URL, YES_MARKER, NO_MARKER, lockTime, resolveAfter,
  ]);

  console.log("\n2. stake YES (0.002 GEN) and NO (0.001 GEN)...");
  await send(yes, "stake", [MARKET_ID, "yes"], YES_VALUE);
  await send(no, "stake", [MARKET_ID, "no"], NO_VALUE);
  await accounting(creator);

  console.log("\nWaiting for resolve_after to pass...");
  const waitMs = (resolveAfter - Math.floor(Date.now() / 1000) + 20) * 1000;
  if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));

  console.log("\n3. resolve...");
  await send(creator, "resolve", [MARKET_ID]);

  console.log("\nWaiting 11 minutes for the challenge window to close...");
  await new Promise((r) => setTimeout(r, 11 * 60 * 1000));

  console.log("\n4. finalize...");
  await send(creator, "finalize", [MARKET_ID]);

  console.log("\n5. claim (YES staker, paid the whole 0.003 GEN pool once)...");
  await send(yes, "claim", [MARKET_ID]);
  await accounting(creator);

  console.log("\n6. claim again (must fail, nothing sent)...");
  try {
    await send(yes, "claim", [MARKET_ID]);
  } catch (e) {
    console.log("  refused:", String(e.message || e).slice(0, 200));
  }
  await accounting(creator);
  console.log(`\nDone. Market: ${MARKET_ID}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
