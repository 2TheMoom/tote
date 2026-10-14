/**
 * What a transaction receipt says about whether the contract actually ran.
 *
 * A wallet shows a transaction as "confirmed" once it is included on chain. That says nothing about the
 * GenLayer execution: validators can time out on a model call (LEADER_TIMEOUT) and then nothing is
 * recorded at all, and the contract itself can refuse (FINISHED_WITH_ERROR). Returns a plain explanation
 * when the write did NOT take effect, or null when it executed and returned.
 */
const TIMED_OUT = ["LEADER_TIMEOUT", "VALIDATORS_TIMEOUT", "UNDETERMINED", "CANCELED"];

export function failedReceiptMessage(receipt: any, functionName: string, txHash: string): string | null {
  const status = String(receipt?.statusName ?? "");
  const exec = String(receipt?.txExecutionResultName ?? "");
  if (TIMED_OUT.includes(status) || exec === "NOT_VOTED" || exec === "IDLE") {
    return (
      `Validators did not complete ${functionName} (${status || exec}). Nothing was recorded, so nothing changed, ` +
      `even though your wallet may show the transaction as confirmed. This happens now and then when the model call is slow: try again. Transaction ${txHash}.`
    );
  }
  if (exec && exec !== "FINISHED_WITH_RETURN") {
    return `The contract refused ${functionName} (${exec}). Nothing changed. Transaction ${txHash}.`;
  }
  return null;
}
