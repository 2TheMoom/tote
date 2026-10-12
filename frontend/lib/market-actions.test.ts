import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { decodeMarket } from "./contracts/decode.ts";
import type { Market } from "./contracts/types.ts";
import {
  EMPTY_POSITION,
  RECOVERY_TIMEOUT_SECONDS,
  availableActions,
  challengeOpen,
  disputeIsStale,
  readyToFinalize,
  recoveryNote,
  stakesReclaimable,
  type Position,
} from "./market-actions.ts";

const CREATOR = "0x1111111111111111111111111111111111111111";
const ALICE = "0x2222222222222222222222222222222222222222";
const BOB = "0x3333333333333333333333333333333333333333";
const T = 1_800_000_000;
// Hard-coded on purpose: this is the contract's 24 hours, not whatever the app module says.
const DAY = 86400;
const ONE = BigInt(1000);
const ZERO = BigInt(0);

function market(over: Partial<Market>): Market {
  return {
    creator: CREATOR,
    question: "q",
    verification_url: "https://example.com",
    yes_marker: "yes",
    no_marker: "no",
    lock_time: String(T + 3600),
    resolve_after: String(T + 3700),
    status: "open",
    outcome: "",
    resolved_at: "0",
    challenge_deadline: "0",
    dispute_reason: "",
    resolution_note: "",
    total_yes_pool: "1000",
    total_no_pool: "1000",
    ...over,
  };
}

function position(over: Partial<Position>): Position {
  return { ...EMPTY_POSITION, ...over };
}

const has = (m: Market, who: string | null, now: number, pos?: Position) =>
  availableActions(m, { address: who, now, position: pos });

describe("recovery window matches the contract", () => {
  it("the app constant equals RECOVERY_TIMEOUT_SECONDS in contracts/tote.py", () => {
    const source = readFileSync(new URL("../../contracts/tote.py", import.meta.url), "utf8");
    const match = source.match(/^RECOVERY_TIMEOUT_SECONDS\s*=\s*(\d+)/m);
    assert.ok(match, "constant not found in the contract");
    assert.equal(RECOVERY_TIMEOUT_SECONDS, Number(match[1]));
    assert.equal(RECOVERY_TIMEOUT_SECONDS, DAY);
  });
});

describe("decodeMarket", () => {
  it("decodes the Map genlayer-js returns, including the abandoned status", () => {
    const m = decodeMarket(new Map<string, unknown>([["status", "abandoned"], ["challenge_deadline", 1_799_999_000n]]));
    assert.equal(m.status, "abandoned");
    assert.equal(m.challenge_deadline, "1799999000");
  });

  it("defaults missing fields", () => {
    const m = decodeMarket({});
    assert.equal(m.status, "open");
    assert.equal(m.total_yes_pool, "0");
  });
});

describe("window boundaries mirror the contract", () => {
  const resolved = market({ status: "resolved", challenge_deadline: String(T) });

  it("challenge is open up to and including challenge_deadline", () => {
    assert.equal(challengeOpen(resolved, T), true);
    assert.equal(challengeOpen(resolved, T + 1), false);
  });

  it("finalize opens strictly after challenge_deadline", () => {
    assert.equal(readyToFinalize(resolved, T), false);
    assert.equal(readyToFinalize(resolved, T + 1), true);
  });

  it("a dispute is stale exactly at challenge_deadline + 24h", () => {
    const d = market({ status: "disputed", challenge_deadline: String(T) });
    assert.equal(disputeIsStale(d, T + DAY - 1), false);
    assert.equal(disputeIsStale(d, T + DAY), true);
  });

  it("an open market's stakes are reclaimable exactly at resolve_after + 24h", () => {
    const o = market({ status: "open", resolve_after: String(T) });
    assert.equal(stakesReclaimable(o, T + DAY - 1), false);
    assert.equal(stakesReclaimable(o, T + DAY), true);
  });

  it("an abandoned market is always reclaimable", () => {
    assert.equal(stakesReclaimable(market({ status: "abandoned" }), T), true);
  });

  it("a stuck dispute is never reclaimable through reclaim_stake", () => {
    const d = market({ status: "disputed", resolve_after: String(T - 100 * DAY), challenge_deadline: String(T - 100 * DAY) });
    assert.equal(stakesReclaimable(d, T), false);
    const pos = position({ yesStake: ONE });
    assert.ok(!has(d, ALICE, T, pos).includes("reclaim_yes"));
  });

  for (const status of ["resolved", "finalized"] as const) {
    it(`${status} markets are never reclaimable`, () => {
      assert.equal(stakesReclaimable(market({ status, resolve_after: String(T - 100 * DAY) }), T), false);
    });
  }
});

describe("stake and resolve", () => {
  const open = market({});

  it("lets anyone but the creator stake before lock_time", () => {
    assert.ok(has(open, ALICE, T).includes("stake"));
    assert.ok(!has(open, CREATOR, T).includes("stake"));
    assert.ok(!has(open, null, T).includes("stake"));
    assert.ok(!has(open, ALICE, T + 3600).includes("stake"));
  });

  it("offers resolve to any connected account once resolve_after has passed and both pools are non-empty", () => {
    const now = T + 3700;
    assert.ok(has(open, BOB, now).includes("resolve"));
    assert.ok(!has(open, null, now).includes("resolve"));
    assert.ok(!has(open, BOB, now - 1).includes("resolve"));
    assert.ok(!has(market({ total_no_pool: "0" }), BOB, now).includes("resolve"));
    assert.ok(!has(market({ total_yes_pool: "0" }), BOB, now).includes("resolve"));
  });
});

describe("challenge is for stakers in the market only", () => {
  const resolved = market({ status: "resolved", outcome: "yes", challenge_deadline: String(T + 600) });

  it("offers it to a staker on either side", () => {
    assert.ok(has(resolved, ALICE, T, position({ yesStake: ONE })).includes("challenge"));
    assert.ok(has(resolved, ALICE, T, position({ noStake: ONE })).includes("challenge"));
  });

  it("does not offer it to a non-staker, a disconnected visitor, or after the window", () => {
    assert.ok(!has(resolved, BOB, T, position({})).includes("challenge"));
    assert.ok(!has(resolved, BOB, T).includes("challenge"));
    assert.ok(!has(resolved, null, T, position({ yesStake: ONE })).includes("challenge"));
    assert.ok(!has(resolved, ALICE, T + 601, position({ yesStake: ONE })).includes("challenge"));
  });
});

describe("finalize and dispute resolution are permissionless for any connected account", () => {
  it("finalize", () => {
    const resolved = market({ status: "resolved", challenge_deadline: String(T) });
    assert.ok(has(resolved, BOB, T + 1).includes("finalize"));
    assert.ok(!has(resolved, BOB, T).includes("finalize"));
    assert.ok(!has(resolved, null, T + 1).includes("finalize"));
  });

  it("resolve_dispute, and nobody when disconnected", () => {
    const d = market({ status: "disputed", challenge_deadline: String(T) });
    for (const who of [CREATOR, ALICE, BOB]) assert.ok(has(d, who, T + 5).includes("resolve_dispute"), who);
    assert.ok(!has(d, null, T + 5).includes("resolve_dispute"));
  });

  it("resolve_stale_dispute only after 24h, for any connected account", () => {
    const d = market({ status: "disputed", challenge_deadline: String(T) });
    assert.ok(!has(d, BOB, T + DAY - 1).includes("resolve_stale_dispute"));
    assert.ok(has(d, BOB, T + DAY).includes("resolve_stale_dispute"));
    assert.ok(!has(d, null, T + DAY).includes("resolve_stale_dispute"));
  });
});

describe("claim is for winners who have not claimed", () => {
  const finalized = market({ status: "finalized", outcome: "yes" });

  it("offers it to a winning staker", () => {
    assert.deepEqual(has(finalized, ALICE, T, position({ yesStake: ONE })), ["claim"]);
  });

  it("does not offer it to a loser, a non-staker, someone who already claimed, or a disconnected visitor", () => {
    assert.ok(!has(finalized, ALICE, T, position({ noStake: ONE })).includes("claim"));
    assert.ok(!has(finalized, BOB, T, position({})).includes("claim"));
    assert.ok(!has(finalized, ALICE, T, position({ yesStake: ONE, claimed: true })).includes("claim"));
    assert.ok(!has(finalized, null, T).includes("claim"));
  });

  it("a staker on both sides can claim only because of the winning side", () => {
    assert.ok(has(finalized, ALICE, T, position({ yesStake: ONE, noStake: ONE })).includes("claim"));
    const noWins = market({ status: "finalized", outcome: "no" });
    assert.ok(!has(noWins, ALICE, T, position({ yesStake: ONE })).includes("claim"));
  });

  it("offers nothing when the market has no outcome", () => {
    const noOutcome = market({ status: "finalized", outcome: "" });
    assert.ok(!has(noOutcome, ALICE, T, position({ yesStake: ONE })).includes("claim"));
    assert.ok(!has(noOutcome, ALICE, T, position({ noStake: ONE })).includes("claim"));
  });
});

describe("reclaim is per side, for stakers only", () => {
  // One-sided, so it can never resolve: the real reason a market gets stuck.
  const stuck = market({ status: "open", lock_time: String(T - 2 * DAY), resolve_after: String(T - DAY), total_no_pool: "0" });

  it("offers each side the wallet staked on", () => {
    assert.deepEqual(has(stuck, ALICE, T, position({ yesStake: ONE })), ["reclaim_yes"]);
    assert.deepEqual(has(stuck, ALICE, T, position({ noStake: ONE })), ["reclaim_no"]);
    assert.deepEqual(has(stuck, ALICE, T, position({ yesStake: ONE, noStake: ONE })), ["reclaim_yes", "reclaim_no"]);
  });

  it("hides a side that was already reclaimed", () => {
    const yesDone = position({ yesStake: ONE, noStake: ONE, reclaimedYes: true });
    assert.deepEqual(has(stuck, ALICE, T, yesDone), ["reclaim_no"]);
    const noDone = position({ yesStake: ONE, noStake: ONE, reclaimedNo: true });
    assert.deepEqual(has(stuck, ALICE, T, noDone), ["reclaim_yes"]);
    const bothDone = position({ yesStake: ONE, noStake: ONE, reclaimedYes: true, reclaimedNo: true });
    assert.deepEqual(has(stuck, ALICE, T, bothDone), []);
  });

  it("offers nothing to someone with no stake, or before the 24h window", () => {
    assert.deepEqual(has(stuck, BOB, T, position({})), []);
    const early = market({ status: "open", lock_time: String(T - 2 * DAY), resolve_after: String(T - DAY + 1), total_no_pool: "0" });
    assert.ok(!has(early, ALICE, T, position({ yesStake: ONE })).includes("reclaim_yes"));
  });

  it("works on an abandoned market for a staker who has not reclaimed yet", () => {
    const ab = market({ status: "abandoned" });
    assert.deepEqual(has(ab, ALICE, T, position({ noStake: ONE })), ["reclaim_no"]);
  });

  it("offers nothing on a settled market", () => {
    for (const status of ["resolved", "finalized"] as const) {
      const m = market({ status, outcome: "yes", resolve_after: String(T - 100 * DAY), challenge_deadline: String(T - 100 * DAY) });
      const acts = has(m, ALICE, T, position({ noStake: ONE, claimed: true }));
      assert.ok(!acts.includes("reclaim_no"), status);
    }
  });
});

describe("recoveryNote describes what the contract really does", () => {
  it("says a stuck dispute settles at the original outcome and is not a refund", () => {
    const note = recoveryNote(market({ status: "disputed", challenge_deadline: String(T) }), T + DAY);
    assert.match(note ?? "", /original outcome/i);
    assert.match(note ?? "", /not a refund/i);
  });

  it("says a stuck open market returns each staker's own stake", () => {
    const note = recoveryNote(market({ status: "open", resolve_after: String(T - DAY) }), T);
    assert.match(note ?? "", /original stake/i);
  });

  it("says nothing on a healthy market", () => {
    assert.equal(recoveryNote(market({}), T), null);
    assert.equal(recoveryNote(market({ status: "disputed", challenge_deadline: String(T) }), T + 5), null);
  });
});
