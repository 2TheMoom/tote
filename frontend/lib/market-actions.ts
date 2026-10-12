import type { Market } from "./contracts/types.ts";

/** Mirrors RECOVERY_TIMEOUT_SECONDS in contracts/tote.py. */
export const RECOVERY_TIMEOUT_SECONDS = 86400;

export type Side = "yes" | "no";

/** What the connected wallet holds in one market, read from the contract. */
export interface Position {
  yesStake: bigint;
  noStake: bigint;
  claimed: boolean;
  reclaimedYes: boolean;
  reclaimedNo: boolean;
}

export const EMPTY_POSITION: Position = {
  yesStake: BigInt(0),
  noStake: BigInt(0),
  claimed: false,
  reclaimedYes: false,
  reclaimedNo: false,
};

export type MarketAction =
  | "stake"
  | "resolve"
  | "challenge"
  | "finalize"
  | "resolve_dispute"
  | "resolve_stale_dispute"
  | "claim"
  | "reclaim_yes"
  | "reclaim_no";

export interface ActionContext {
  /** The connected wallet, or null when nobody is connected. */
  address: string | null | undefined;
  /** Current unix time in seconds. */
  now: number;
  /** The wallet's position in this market, if it has been loaded. */
  position?: Position;
}

function sameAddr(a?: string | null, b?: string | null): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

/** challenge() is allowed up to and including challenge_deadline. */
export function challengeOpen(m: Market, now: number): boolean {
  return m.status === "resolved" && now <= Number(m.challenge_deadline);
}

/** finalize() is allowed strictly after challenge_deadline. */
export function readyToFinalize(m: Market, now: number): boolean {
  return m.status === "resolved" && now > Number(m.challenge_deadline);
}

/** resolve_stale_dispute(): a dispute 24h past challenge_deadline. */
export function disputeIsStale(m: Market, now: number): boolean {
  return m.status === "disputed" && now >= Number(m.challenge_deadline) + RECOVERY_TIMEOUT_SECONDS;
}

/**
 * reclaim_stake(): a market stuck open 24h past resolve_after, or one that
 * has already been marked abandoned by an earlier reclaim. A stuck dispute is
 * NOT reclaimable here; it goes through resolve_stale_dispute().
 */
export function stakesReclaimable(m: Market, now: number): boolean {
  if (m.status === "abandoned") return true;
  return m.status === "open" && now >= Number(m.resolve_after) + RECOVERY_TIMEOUT_SECONDS;
}

/**
 * The actions the connected wallet can usefully trigger, mapped from the
 * contract's rules:
 *  - stake: anyone but the creator, before lock_time
 *  - resolve, finalize, resolve_dispute, resolve_stale_dispute: permissionless
 *  - challenge: a staker in this market, up to challenge_deadline
 *  - claim: a wallet with a winning stake that has not claimed
 *  - reclaim: a wallet with a stake on that side that has not reclaimed it
 */
export function availableActions(m: Market, ctx: ActionContext): MarketAction[] {
  const actions: MarketAction[] = [];
  const connected = !!ctx.address;
  const pos = ctx.position ?? EMPTY_POSITION;
  const isCreator = sameAddr(ctx.address, m.creator);
  const isStaker = pos.yesStake > BigInt(0) || pos.noStake > BigInt(0);
  const bothPools = BigInt(m.total_yes_pool || "0") > BigInt(0) && BigInt(m.total_no_pool || "0") > BigInt(0);

  if (m.status === "open" && ctx.now < Number(m.lock_time) && connected && !isCreator) actions.push("stake");
  if (m.status === "open" && ctx.now >= Number(m.resolve_after) && bothPools && connected) actions.push("resolve");
  if (challengeOpen(m, ctx.now) && connected && isStaker) actions.push("challenge");
  if (readyToFinalize(m, ctx.now) && connected) actions.push("finalize");
  if (m.status === "disputed" && connected) actions.push("resolve_dispute");
  if (disputeIsStale(m, ctx.now) && connected) actions.push("resolve_stale_dispute");

  if (m.status === "finalized" && connected && !pos.claimed && (m.outcome === "yes" || m.outcome === "no")) {
    const winning = m.outcome === "yes" ? pos.yesStake : pos.noStake;
    if (winning > BigInt(0)) actions.push("claim");
  }

  if (connected && stakesReclaimable(m, ctx.now)) {
    if (pos.yesStake > BigInt(0) && !pos.reclaimedYes) actions.push("reclaim_yes");
    if (pos.noStake > BigInt(0) && !pos.reclaimedNo) actions.push("reclaim_no");
  }

  return actions;
}

/** Short notes explaining the two recovery paths, for the market panel. */
export function recoveryNote(m: Market, now: number): string | null {
  if (disputeIsStale(m, now)) {
    return "Adjudication never reached a verdict in 24 hours. Anyone can settle the market at the original outcome. This is not a refund.";
  }
  if (m.status === "open" && stakesReclaimable(m, now)) {
    return "This market never resolved in 24 hours. Each staker can take back their own original stake. Anyone with a stake can do it.";
  }
  if (m.status === "abandoned") {
    return "This market was abandoned. Each staker can take back their own original stake.";
  }
  return null;
}
