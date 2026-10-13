import type { Market } from "./types.ts";

/**
 * genlayer-js decodes Python dicts (and dataclasses) as JS Map instances,
 * keyed by field name. This flattens one level of the Map into a plain
 * object.
 */
function toPlainObject(raw: any): Record<string, any> {
  const entries = raw instanceof Map ? Array.from(raw.entries()) : Object.entries(raw ?? {});
  const obj: Record<string, any> = {};
  for (const [key, value] of entries) {
    obj[key] = value;
  }
  return obj;
}

const s = (v: unknown, fallback = "0") => String(v ?? fallback);

export function decodeMarket(raw: any): Market {
  const obj = toPlainObject(raw);
  return {
    creator: s(obj.creator, ""),
    question: s(obj.question, ""),
    verification_url: s(obj.verification_url, ""),
    yes_marker: s(obj.yes_marker, ""),
    no_marker: s(obj.no_marker, ""),
    lock_time: s(obj.lock_time),
    resolve_after: s(obj.resolve_after),
    challenge_window: s(obj.challenge_window),
    stale_after: s(obj.stale_after),
    status: s(obj.status, "open") as Market["status"],
    outcome: s(obj.outcome, "") as Market["outcome"],
    resolved_at: s(obj.resolved_at),
    disputed_at: s(obj.disputed_at),
    bond: s(obj.bond),
    bonus: s(obj.bonus),
    bond_refunded: obj.bond_refunded === true,
    challenger: s(obj.challenger, ""),
    evidence_excerpt: s(obj.evidence_excerpt, ""),
    evidence_digest: s(obj.evidence_digest, ""),
    dispute_reason: s(obj.dispute_reason, ""),
    resolution_note: s(obj.resolution_note, ""),
    total_yes_pool: s(obj.total_yes_pool),
    total_no_pool: s(obj.total_no_pool),
  };
}
