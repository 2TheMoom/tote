// Polls a payout transaction until it finalizes, then confirms the
// contract's in_flight returns to 0 and the recipient's balance moved.
// Usage: node watch-finality.mjs <contract> <payoutTxHash> <recipient>
import { createClient } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";

const [contract, tx, recipient] = process.argv.slice(2);
const client = createClient({ chain: testnetBradbury });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const j = (x) => JSON.stringify(x, (k, v) => (typeof v === "bigint" ? v.toString() : v));

async function acct() {
  const a = await client.readContract({ address: contract, functionName: "get_accounting", args: [] });
  return Object.fromEntries(a instanceof Map ? a : Object.entries(a));
}

const start = Date.now();
const startBal = await client.getBalance({ address: recipient });
console.log(new Date().toISOString(), "recipient balance at start", startBal.toString(), "acct", j(await acct()));
for (;;) {
  try {
    const t = await client.getTransaction({ hash: tx });
    const a = await acct();
    const bal = await client.getBalance({ address: recipient });
    const mins = ((Date.now() - start) / 60000).toFixed(1);
    console.log(`${new Date().toISOString()} +${mins}m status=${t.statusName} in_flight=${a.in_flight} balance=${a.balance} recipient=${bal}`);
    if (String(a.in_flight) === "0" && t.statusName === "FINALIZED") {
      console.log("LANDED", j({ status: t.statusName, acct: a, recipientDelta: (bal - startBal).toString() }));
      break;
    }
  } catch (e) {
    console.log(new Date().toISOString(), "poll error", String(e.message || e).slice(0, 120));
  }
  if (Date.now() - start > 4 * 3600 * 1000) {
    console.log("TIMEOUT after 4h");
    break;
  }
  await sleep(60000);
}
