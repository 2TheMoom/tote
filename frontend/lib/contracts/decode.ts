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

export function decodeMarket(raw: any): Market {
  const obj = toPlainObject(raw);
  return {
    creator: String(obj.creator ?? ""),
    question: String(obj.question ?? ""),
    verification_url: String(obj.verification_url ?? ""),
    yes_marker: String(obj.yes_marker ?? ""),
    no_marker: String(obj.no_marker ?? ""),
    lock_time: String(obj.lock_time ?? "0"),
    resolve_after: String(obj.resolve_after ?? "0"),
    status: String(obj.status ?? "open") as Market["status"],
    outcome: String(obj.outcome ?? "") as Market["outcome"],
    resolved_at: String(obj.resolved_at ?? "0"),
    challenge_deadline: String(obj.challenge_deadline ?? "0"),
    dispute_reason: String(obj.dispute_reason ?? ""),
    resolution_note: String(obj.resolution_note ?? ""),
    total_yes_pool: String(obj.total_yes_pool ?? "0"),
    total_no_pool: String(obj.total_no_pool ?? "0"),
  };
}
