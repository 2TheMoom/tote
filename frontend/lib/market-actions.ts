import type { Market } from "./contracts/types.ts";
import { requiredBond } from "./limits.ts";

export type Side = "yes" | "no";

/** What the connected wallet holds in one market, read from the contract. */
export interface Position {
  yesStake: bigint;
  noStake: bigint;
  /** A claim for this wallet has been scheduled (its payout record exists). */
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

/** The last second a challenge is accepted: resolved_at + challenge_window. */
export function challengeDeadline(m: Market): number {
  return Number(m.resolved_at) > 0 ? Number(m.resolved_at) + Number(m.challenge_window) : 0;
}

/** When a stuck dispute can be settled: disputed_at + stale_after. */
export function disputeStaleAt(m: Market): number {
  return m.status === "disputed" ? Number(m.disputed_at) + Number(m.stale_after) : 0;
}

/** challenge() is allowed up to and including the deadline. */
export function challengeOpen(m: Market, now: number): boolean {
  return m.status === "resolved" && now <= challengeDeadline(m);
}

/** finalize() is allowed strictly after the deadline. */
export function readyToFinalize(m: Market, now: number): boolean {
  return m.status === "resolved" && now > challengeDeadline(m);
}

/** resolve_stale_dispute(): a dispute stale_after past disputed_at. */
export function disputeIsStale(m: Market, now: number): boolean {
  return m.status === "disputed" && now >= disputeStaleAt(m);
}

/** reclaim_stake(): a market stuck open stale_after past resolve_after, or one already abandoned. */
export function stakesReclaimable(m: Market, now: number): boolean {
  if (m.status === "abandoned") return true;
  return m.status === "open" && now >= Number(m.resolve_after) + Number(m.stale_after);
}

/** What a challenge must post: 5% of every stake in the market, at least 1 wei. */
export function bondFor(m: Market): bigint {
  return requiredBond(BigInt(m.total_yes_pool || "0") + BigInt(m.total_no_pool || "0"));
}

/**
 * The actions the connected wallet can usefully trigger, mapped from the
 * contract's rules:
 *  - stake: anyone but the creator, before lock_time
 *  - resolve, finalize, resolve_dispute, resolve_stale_dispute: permissionless
 *  - challenge: a staker in this market, up to the deadline, with a bond
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

/** Short notes explaining the recovery paths, for the market panel. */
export function recoveryNote(m: Market, now: number): string | null {
  if (disputeIsStale(m, now)) {
    return "Nobody could adjudicate this dispute in time. Anyone can settle it: the recorded outcome stands and the challenger's bond goes to the winners. This is not a refund.";
  }
  if (m.status === "open" && stakesReclaimable(m, now)) {
    return "This market never resolved in time. Each staker can take back their own original stake.";
  }
  if (m.status === "abandoned") {
    return "This market was abandoned. Each staker can take back their own original stake.";
  }
  return null;
}

/** Status the market must read back as for a write to count as done. */
export function expectedStatus(action: MarketAction | "create"): ((m: Market) => boolean) | null {
  switch (action) {
    case "create": return (m) => m.status === "open";
    case "resolve": return (m) => m.status === "resolved";
    case "challenge": return (m) => m.status === "disputed";
    case "finalize": return (m) => m.status === "finalized";
    // an inconclusive verdict reverts, so a dispute that is still "disputed" means nothing changed
    case "resolve_dispute": return (m) => m.status === "finalized";
    case "resolve_stale_dispute": return (m) => m.status === "finalized";
    // stake, claim and reclaim are confirmed against the wallet's own position instead
    default: return null;
  }
}

/** True for actions whose transfer only lands when the transaction finalizes. */
export function movesFunds(action: MarketAction | "create"): boolean {
  return action === "claim" || action === "reclaim_yes" || action === "reclaim_no" || action === "resolve_dispute";
}
