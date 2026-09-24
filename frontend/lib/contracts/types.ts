/**
 * TypeScript types for the GenLayer Tote contract
 */

export type MarketStatus = "open" | "resolved" | "disputed" | "finalized";
export type MarketOutcome = "" | "yes" | "no";

export interface Market {
  creator: string;
  question: string;
  verification_url: string;
  yes_marker: string;
  no_marker: string;
  lock_time: string; // unix seconds
  resolve_after: string; // unix seconds
  status: MarketStatus;
  outcome: MarketOutcome;
  resolved_at: string;
  challenge_deadline: string;
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
