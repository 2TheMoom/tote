/**
 * TypeScript types for the GenLayer Tote contract (v3)
 */

export type MarketStatus = "open" | "resolved" | "disputed" | "finalized" | "abandoned";
export type MarketOutcome = "" | "yes" | "no";

export interface Market {
  creator: string;
  question: string;
  verification_url: string;
  yes_marker: string; // the whole line that means YES
  no_marker: string; // the whole line that means NO
  lock_time: string; // unix seconds
  resolve_after: string; // unix seconds
  challenge_window: string; // seconds a staker may challenge after resolution
  stale_after: string; // seconds before a stuck market or dispute can be recovered
  status: MarketStatus;
  outcome: MarketOutcome;
  resolved_at: string;
  disputed_at: string;
  bond: string; // wei posted by the challenger, "0" until a challenge
  bonus: string; // wei of a forfeited bond added to the winners' pool
  bond_refunded: boolean; // true once an overturned challenge's bond was sent back
  challenger: string; // who posted the bond
  evidence_excerpt: string; // the lines validators agreed on when the market resolved
  evidence_digest: string; // sha256 of that excerpt
  dispute_reason: string;
  resolution_note: string;
  total_yes_pool: string; // wei, as decimal string
  total_no_pool: string; // wei, as decimal string
}

export interface TransactionReceipt {
  status: string;
  hash: string;
  blockNumber?: number;
  [key: string]: any;
}
