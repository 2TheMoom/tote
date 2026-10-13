/** Mirrors the constants in contracts/tote.py; a test fails if they drift apart. */
export const MIN_WINDOW = 3600;
export const MAX_WINDOW = 7 * 86400;
export const MIN_STALE = 7200;
export const MAX_STALE = 30 * 86400;
export const BOND_BPS = 500;
export const MIN_MARKER = 12;
export const MAX_MARKER = 200;

/** The text the contract compares: curly quotes straightened, whitespace collapsed, lower-cased. */
export function normalizeLine(s: string): string {
  return s
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Why a marker would be refused by create_engagement, or null when it is fine. */
export function markerProblem(marker: string, what = "Marker"): string | null {
  const m = normalizeLine(marker);
  if (m.length < MIN_MARKER || m.length > MAX_MARKER) return `${what} must be ${MIN_MARKER} to ${MAX_MARKER} characters.`;
  if (!/[0-9]/.test(m) || !/\p{L}/u.test(m)) return `${what} needs a letter and a digit (make it specific: a date, version or id).`;
  return null;
}

/** Mirrors the contract's URL rules closely enough to explain a refusal before it costs a transaction. */
export function urlProblem(u: string): string | null {
  if (!u.startsWith("https://") || u.length > 300) return "The URL must start with https:// and be at most 300 characters.";
  if (/[\s"'<>\\`]/.test(u)) return "The URL has a character the contract refuses.";
  const host = u.slice(8).split("/")[0].split("?")[0].split("#")[0].toLowerCase();
  if (host.includes("@") || host.includes(":")) return "The URL may not contain credentials or a port.";
  const parts = host.split(".");
  const internal = ["local", "internal", "lan", "localhost", "home", "corp", "intranet", "localdomain", "arpa"];
  const last = parts[parts.length - 1];
  if (parts.length < 2 || internal.includes(last) || !/[a-z]/.test(last)) return "The URL host must be a public domain name.";
  if (parts.some((p) => p.length < 1 || p.length > 63 || p.startsWith("-") || p.endsWith("-") || !/^[a-z0-9-]+$/.test(p))) {
    return "The URL host is not a valid domain name.";
  }
  return null;
}

/** 5% of all stakes, at least 1 wei: what challenge() requires exactly. */
export function requiredBond(totalStakedWei: bigint): bigint {
  const b = (totalStakedWei * BigInt(BOND_BPS)) / BigInt(10000);
  return b > BigInt(1) ? b : BigInt(1);
}

/** GEN amount for display. Small amounts keep their precision: a bond on a 0.002 GEN escrow is 0.0002, never "0.000". */
export function formatGen(wei: string): string {
  const n = Number(wei) / 1e18;
  if (!Number.isFinite(n) || n === 0) return "0.000";
  const text = n >= 1 ? n.toFixed(3) : n.toFixed(9).replace(/0+$/, "");
  const [whole, frac = ""] = text.split(".");
  return `${whole}.${frac.padEnd(3, "0")}`;
}
