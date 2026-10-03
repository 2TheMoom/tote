// Proves the Payee payout mechanism delivers value for real:
// gl.evm.contract_interface-wrapped emit_transfer (EthSend, an external
// chain-layer message through this IC's own ghost contract) - the SDK's
// documented path for paying a wallet, not gl.get_contract_at().
// emit_transfer(), an internal GenVM-layer message with nowhere valid to
// land at a plain EOA's address. Runs Tote's full undisputed happy path
// for real: create_market -> stake (both sides) -> resolve -> finalize ->
// claim, then reads the winner's on-chain balance before and after to
// confirm it actually rose by the pari-mutuel payout.
//
// Usage (PowerShell):
//   $env:PK = "0x<64-hex-char private key of the market creator>"
//   $env:PK2 = "0x<64-hex-char private key of the YES staker/winner>"
//   $env:PK3 = "0x<64-hex-char private key of the NO staker>"
//   node verify-payee-live.mjs
//
// Get keys via: genlayer account export --name <account-name>
// (exports a keystore file; decrypt it yourself, this script never sees
// your password)

import { createAccount, createClient } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";

const CONTRACT = "0xa9465dBb90ab60d1D27Dca893bb024a39Ffa7C31";
const MARKET_ID = "tote-live-fix-" + Date.now();
const YES_VALUE = 4000000000000000n; // 0.004 GEN
const NO_VALUE = 1000000000000000n; // 0.001 GEN
const URL = "https://raw.githubusercontent.com/genlayerlabs/genlayer-project-boilerplate/main/README.md";
const YES_MARKER = "football bets";
const NO_MARKER = "this text never appears in that readme";

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Set $env:${name} first`);
  return v.startsWith("0x") ? v : "0x" + v;
}

async function waitAccepted(client, hash) {
  const receipt = await client.waitForTransactionReceipt({ hash, retries: 200 });
  console.log(`  status=${receipt.statusName} result=${receipt.resultName} exec=${receipt.txExecutionResultName}`);
  if (receipt.statusName !== "ACCEPTED" && receipt.statusName !== "FINALIZED") {
    throw new Error(`Transaction not accepted: ${JSON.stringify(receipt)}`);
  }
  return receipt;
}

async function main() {
  const creatorAccount = createAccount(need("PK"));
  const yesAccount = createAccount(need("PK2"));
  const noAccount = createAccount(need("PK3"));

  const creatorClient = createClient({ chain: testnetBradbury, account: creatorAccount });
  const yesClient = createClient({ chain: testnetBradbury, account: yesAccount });
  const noClient = createClient({ chain: testnetBradbury, account: noAccount });

  const yesAddress = yesAccount.address;
  const balanceBefore = await creatorClient.getBalance({ address: yesAddress });
  console.log(`YES staker balance before: ${balanceBefore} wei`);

  const lockTime = Math.floor(Date.now() / 1000) + 120;
  const resolveAfter = lockTime + 60;

  console.log("\n1. create_market...");
  let hash = await creatorClient.writeContract({
    address: CONTRACT,
    functionName: "create_market",
    args: [
      MARKET_ID,
      "Does the boilerplate README mention football bets?",
      URL,
      YES_MARKER,
      NO_MARKER,
      lockTime,
      resolveAfter,
    ],
  });
  await waitAccepted(creatorClient, hash);

  console.log("\n2. stake YES (0.004 GEN)...");
  hash = await yesClient.writeContract({
    address: CONTRACT,
    functionName: "stake",
    args: [MARKET_ID, "yes"],
    value: YES_VALUE,
  });
  await waitAccepted(yesClient, hash);

  console.log("\n3. stake NO (0.001 GEN)...");
  hash = await noClient.writeContract({
    address: CONTRACT,
    functionName: "stake",
    args: [MARKET_ID, "no"],
    value: NO_VALUE,
  });
  await waitAccepted(noClient, hash);

  console.log("\nWaiting for lock_time and resolve_after to pass...");
  const waitMs = (resolveAfter - Math.floor(Date.now() / 1000) + 10) * 1000;
  if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));

  console.log("\n4. resolve...");
  hash = await creatorClient.writeContract({
    address: CONTRACT,
    functionName: "resolve",
    args: [MARKET_ID],
  });
  await waitAccepted(creatorClient, hash);

  console.log("\nWaiting 11 minutes for the challenge window to close...");
  await new Promise((r) => setTimeout(r, 11 * 60 * 1000));

  console.log("\n5. finalize...");
  hash = await creatorClient.writeContract({
    address: CONTRACT,
    functionName: "finalize",
    args: [MARKET_ID],
  });
  await waitAccepted(creatorClient, hash);

  console.log("\n6. claim (YES staker)...");
  hash = await yesClient.writeContract({
    address: CONTRACT,
    functionName: "claim",
    args: [MARKET_ID],
  });
  await waitAccepted(yesClient, hash);

  const balanceAfter = await creatorClient.getBalance({ address: yesAddress });
  console.log(`\nYES staker balance after: ${balanceAfter} wei`);
  const delta = balanceAfter - balanceBefore;
  console.log(`Delta: ${delta} wei (expected roughly +${YES_VALUE - 0n}... net of the 0.004 GEN already staked, full pool 0.005 GEN returned)`);
  console.log(delta > 0n ? "\n✔ CONFIRMED: the native transfer delivered a real payout." : "\n✖ No positive delta - investigate.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
