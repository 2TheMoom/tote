"""Direct-mode tests for the Tote contract."""

import json
from datetime import datetime, timezone

CONTRACT = "contracts/tote.py"
CHALLENGE_WINDOW_SECONDS = 600

T0 = "2026-01-01T00:00:00Z"
T0_TS = int(datetime(2026, 1, 1, 0, 0, 0, tzinfo=timezone.utc).timestamp())
LOCK_TIME = T0_TS + 3600
RESOLVE_AFTER = T0_TS + 3700

URL = "https://price.example.com/btc"
YES_MARKER = "closed above 90000"
NO_MARKER = "closed at or below 90000"
QUESTION = "Will BTC close above $90,000?"


def _mock_outcome(vm, outcome: str):
    """outcome: 'yes' | 'no' | 'neither' | 'both'"""
    vm.clear_mocks()
    if outcome == "yes":
        body = f"<html>BTC {YES_MARKER}</html>"
    elif outcome == "no":
        body = f"<html>BTC {NO_MARKER}</html>"
    elif outcome == "both":
        body = f"<html>BTC {YES_MARKER} ... {NO_MARKER}</html>"
    else:
        body = "<html>price pending</html>"
    vm.mock_web(r"price\.example\.com/btc", {"method": "GET", "status": 200, "body": body})


def _mock_dispute_llm(vm, verdict: str, outcome: str = "yes", reasoning: str = "because"):
    _mock_outcome(vm, outcome)
    vm.mock_llm(
        r".*adjudicating a disputed prediction market.*",
        json.dumps({"verdict": verdict, "reasoning": reasoning}),
    )


def _create(direct_vm, contract, creator, market_id="tote-1", lock_time=LOCK_TIME, resolve_after=RESOLVE_AFTER):
    direct_vm.sender = creator
    contract.create_market(market_id, QUESTION, URL, YES_MARKER, NO_MARKER, lock_time, resolve_after)


def _stake(direct_vm, contract, staker, side, value, market_id="tote-1"):
    direct_vm.sender = staker
    direct_vm.value = value
    contract.stake(market_id, side)
    direct_vm.value = 0


# ---------------------------------------------------------------------------
# create_market
# ---------------------------------------------------------------------------


def test_create_market_stores_fields(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(CONTRACT)
    direct_vm.warp(T0)
    _create(direct_vm, contract, direct_alice)

    m = contract.get_market("tote-1")
    assert m["question"] == QUESTION
    assert m["status"] == "open"
    assert m["outcome"] == ""
    assert m["total_yes_pool"] == 0
    assert m["total_no_pool"] == 0
    assert m["lock_time"] == LOCK_TIME
    assert m["resolve_after"] == RESOLVE_AFTER
    assert contract.get_all_market_ids() == ["tote-1"]


def test_create_market_duplicate_id_fails(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(CONTRACT)
    direct_vm.warp(T0)
    _create(direct_vm, contract, direct_alice)

    with direct_vm.expect_revert("already exists"):
        _create(direct_vm, contract, direct_alice)


def test_create_market_empty_question_fails(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(CONTRACT)
    direct_vm.warp(T0)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("question cannot be empty"):
        contract.create_market("tote-1", "", URL, YES_MARKER, NO_MARKER, LOCK_TIME, RESOLVE_AFTER)


def test_create_market_non_https_url_fails(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(CONTRACT)
    direct_vm.warp(T0)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("https://"):
        contract.create_market("tote-1", QUESTION, "http://x.com", YES_MARKER, NO_MARKER, LOCK_TIME, RESOLVE_AFTER)


def test_create_market_empty_marker_fails(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(CONTRACT)
    direct_vm.warp(T0)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("cannot be empty"):
        contract.create_market("tote-1", QUESTION, URL, "", NO_MARKER, LOCK_TIME, RESOLVE_AFTER)


def test_create_market_same_markers_fails(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(CONTRACT)
    direct_vm.warp(T0)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("must be different"):
        contract.create_market("tote-1", QUESTION, URL, "same", "same", LOCK_TIME, RESOLVE_AFTER)


def test_create_market_past_lock_time_fails(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(CONTRACT)
    direct_vm.warp(T0)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("must be in the future"):
        contract.create_market("tote-1", QUESTION, URL, YES_MARKER, NO_MARKER, T0_TS - 1, RESOLVE_AFTER)


def test_create_market_resolve_before_lock_fails(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(CONTRACT)
    direct_vm.warp(T0)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("at or after lock_time"):
        contract.create_market("tote-1", QUESTION, URL, YES_MARKER, NO_MARKER, LOCK_TIME, LOCK_TIME - 1)


# ---------------------------------------------------------------------------
# stake
# ---------------------------------------------------------------------------


def test_stake_happy_path_both_sides(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract = direct_deploy(CONTRACT)
    direct_vm.warp(T0)
    _create(direct_vm, contract, direct_alice)

    _stake(direct_vm, contract, direct_bob, "yes", 1000)
    _stake(direct_vm, contract, direct_charlie, "no", 400)

    m = contract.get_market("tote-1")
    assert m["total_yes_pool"] == 1000
    assert m["total_no_pool"] == 400
    assert contract.get_yes_stakers("tote-1") is not None
    assert len(contract.get_yes_stakers("tote-1")) == 1
    assert len(contract.get_no_stakers("tote-1")) == 1


def test_stake_accumulates_same_side(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT)
    direct_vm.warp(T0)
    _create(direct_vm, contract, direct_alice)

    _stake(direct_vm, contract, direct_bob, "yes", 500)
    _stake(direct_vm, contract, direct_bob, "yes", 300)

    assert contract.get_market("tote-1")["total_yes_pool"] == 800
    assert len(contract.get_yes_stakers("tote-1")) == 1  # not duplicated


def test_stake_creator_cannot_stake_fails(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(CONTRACT)
    direct_vm.warp(T0)
    _create(direct_vm, contract, direct_alice)

    with direct_vm.expect_revert("creator cannot stake"):
        _stake(direct_vm, contract, direct_alice, "yes", 500)


def test_stake_invalid_side_fails(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT)
    direct_vm.warp(T0)
    _create(direct_vm, contract, direct_alice)

    with direct_vm.expect_revert("side must be"):
        _stake(direct_vm, contract, direct_bob, "maybe", 500)


def test_stake_zero_value_fails(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT)
    direct_vm.warp(T0)
    _create(direct_vm, contract, direct_alice)

    with direct_vm.expect_revert("positive amount"):
        _stake(direct_vm, contract, direct_bob, "yes", 0)


def test_stake_after_lock_time_fails(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT)
    direct_vm.warp(T0)
    _create(direct_vm, contract, direct_alice)

    direct_vm.warp("2026-01-01T01:05:00Z")  # past LOCK_TIME (T0+3600)
    with direct_vm.expect_revert("Staking has closed"):
        _stake(direct_vm, contract, direct_bob, "yes", 500)


# ---------------------------------------------------------------------------
# resolve
# ---------------------------------------------------------------------------


def _to_open_with_stakes(direct_vm, contract, creator, yes_staker, no_staker, market_id="tote-1", **kwargs):
    _create(direct_vm, contract, creator, market_id=market_id, **kwargs)
    _stake(direct_vm, contract, yes_staker, "yes", 1200, market_id=market_id)
    _stake(direct_vm, contract, no_staker, "no", 800, market_id=market_id)


def test_resolve_yes_outcome(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract = direct_deploy(CONTRACT)
    direct_vm.warp(T0)
    _to_open_with_stakes(direct_vm, contract, direct_alice, direct_bob, direct_charlie)

    direct_vm.warp("2026-01-01T01:10:00Z")  # past RESOLVE_AFTER
    _mock_outcome(direct_vm, "yes")
    contract.resolve("tote-1")

    m = contract.get_market("tote-1")
    assert m["status"] == "resolved"
    assert m["outcome"] == "yes"
    assert m["challenge_deadline"] == m["resolved_at"] + CHALLENGE_WINDOW_SECONDS


def test_resolve_no_outcome(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract = direct_deploy(CONTRACT)
    direct_vm.warp(T0)
    _to_open_with_stakes(direct_vm, contract, direct_alice, direct_bob, direct_charlie)

    direct_vm.warp("2026-01-01T01:10:00Z")
    _mock_outcome(direct_vm, "no")
    contract.resolve("tote-1")

    assert contract.get_market("tote-1")["outcome"] == "no"


def test_resolve_before_resolve_after_fails(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract = direct_deploy(CONTRACT)
    direct_vm.warp(T0)
    _to_open_with_stakes(direct_vm, contract, direct_alice, direct_bob, direct_charlie)

    with direct_vm.expect_revert("has not passed yet"):
        contract.resolve("tote-1")


def test_resolve_without_both_pools_fails(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT)
    direct_vm.warp(T0)
    _create(direct_vm, contract, direct_alice)
    _stake(direct_vm, contract, direct_bob, "yes", 500)

    direct_vm.warp("2026-01-01T01:10:00Z")
    with direct_vm.expect_revert("needs stakes on both sides"):
        contract.resolve("tote-1")


def test_resolve_neither_marker_reverts_cleanly_then_succeeds(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract = direct_deploy(CONTRACT)
    direct_vm.warp(T0)
    _to_open_with_stakes(direct_vm, contract, direct_alice, direct_bob, direct_charlie)

    direct_vm.warp("2026-01-01T01:10:00Z")
    _mock_outcome(direct_vm, "neither")
    with direct_vm.expect_revert("not yet determinable"):
        contract.resolve("tote-1")
    assert contract.get_market("tote-1")["status"] == "open"

    _mock_outcome(direct_vm, "yes")
    contract.resolve("tote-1")
    assert contract.get_market("tote-1")["status"] == "resolved"


def test_resolve_both_markers_fails(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract = direct_deploy(CONTRACT)
    direct_vm.warp(T0)
    _to_open_with_stakes(direct_vm, contract, direct_alice, direct_bob, direct_charlie)

    direct_vm.warp("2026-01-01T01:10:00Z")
    _mock_outcome(direct_vm, "both")
    with direct_vm.expect_revert("not yet determinable"):
        contract.resolve("tote-1")


# ---------------------------------------------------------------------------
# challenge
# ---------------------------------------------------------------------------


def _to_resolved(direct_vm, contract, creator, yes_staker, no_staker, market_id="tote-1", outcome="yes", **kwargs):
    _to_open_with_stakes(direct_vm, contract, creator, yes_staker, no_staker, market_id=market_id, **kwargs)
    direct_vm.warp("2026-01-01T01:10:00Z")
    _mock_outcome(direct_vm, outcome)
    contract.resolve(market_id)


def test_challenge_happy_path(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract = direct_deploy(CONTRACT)
    direct_vm.warp(T0)
    _to_resolved(direct_vm, contract, direct_alice, direct_bob, direct_charlie)

    direct_vm.sender = direct_charlie  # the losing (no) staker disputes
    contract.challenge("tote-1", "The price actually closed below 90000")

    m = contract.get_market("tote-1")
    assert m["status"] == "disputed"
    assert m["dispute_reason"] == "The price actually closed below 90000"


def test_challenge_by_non_staker_fails(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract = direct_deploy(CONTRACT)
    direct_vm.warp(T0)
    _to_resolved(direct_vm, contract, direct_alice, direct_bob, direct_charlie)

    direct_vm.sender = direct_alice  # creator never staked
    with direct_vm.expect_revert("Only a staker"):
        contract.challenge("tote-1", "reason")


def test_challenge_window_closed_fails(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract = direct_deploy(CONTRACT)
    direct_vm.warp(T0)
    _to_resolved(direct_vm, contract, direct_alice, direct_bob, direct_charlie)

    direct_vm.warp("2026-01-01T01:25:00Z")  # past resolved_at + 600s
    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("Challenge window has closed"):
        contract.challenge("tote-1", "reason")


def test_challenge_empty_reason_fails(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract = direct_deploy(CONTRACT)
    direct_vm.warp(T0)
    _to_resolved(direct_vm, contract, direct_alice, direct_bob, direct_charlie)

    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("reason is required"):
        contract.challenge("tote-1", "")


# ---------------------------------------------------------------------------
# resolve_dispute
# ---------------------------------------------------------------------------


def test_resolve_dispute_uphold_keeps_outcome(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract = direct_deploy(CONTRACT)
    direct_vm.warp(T0)
    _to_resolved(direct_vm, contract, direct_alice, direct_bob, direct_charlie, outcome="yes")
    direct_vm.sender = direct_charlie
    contract.challenge("tote-1", "I don't believe it")

    _mock_dispute_llm(direct_vm, verdict="uphold", outcome="yes", reasoning="Marker genuinely present")
    contract.resolve_dispute("tote-1")

    m = contract.get_market("tote-1")
    assert m["status"] == "finalized"
    assert m["outcome"] == "yes"
    assert "genuinely present" in m["resolution_note"]


def test_resolve_dispute_overturn_flips_outcome(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract = direct_deploy(CONTRACT)
    direct_vm.warp(T0)
    _to_resolved(direct_vm, contract, direct_alice, direct_bob, direct_charlie, outcome="yes")
    direct_vm.sender = direct_charlie
    contract.challenge("tote-1", "The page is stale, price actually dropped")

    _mock_dispute_llm(direct_vm, verdict="overturn", outcome="yes", reasoning="Stale snapshot confirmed")
    contract.resolve_dispute("tote-1")

    m = contract.get_market("tote-1")
    assert m["status"] == "finalized"
    assert m["outcome"] == "no"


def test_resolve_dispute_wrong_status_fails(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract = direct_deploy(CONTRACT)
    direct_vm.warp(T0)
    _to_resolved(direct_vm, contract, direct_alice, direct_bob, direct_charlie)

    with direct_vm.expect_revert("not under dispute"):
        contract.resolve_dispute("tote-1")


# ---------------------------------------------------------------------------
# finalize
# ---------------------------------------------------------------------------


def test_finalize_happy_path(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract = direct_deploy(CONTRACT)
    direct_vm.warp(T0)
    _to_resolved(direct_vm, contract, direct_alice, direct_bob, direct_charlie)

    direct_vm.warp("2026-01-01T01:25:00Z")
    contract.finalize("tote-1")

    assert contract.get_market("tote-1")["status"] == "finalized"


def test_finalize_within_window_fails(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract = direct_deploy(CONTRACT)
    direct_vm.warp(T0)
    _to_resolved(direct_vm, contract, direct_alice, direct_bob, direct_charlie)

    with direct_vm.expect_revert("Challenge window is still open"):
        contract.finalize("tote-1")


def test_finalize_wrong_status_fails(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract = direct_deploy(CONTRACT)
    direct_vm.warp(T0)
    _to_open_with_stakes(direct_vm, contract, direct_alice, direct_bob, direct_charlie)

    with direct_vm.expect_revert("not awaiting finalization"):
        contract.finalize("tote-1")


# ---------------------------------------------------------------------------
# claim
# ---------------------------------------------------------------------------


def _to_finalized(direct_vm, contract, creator, yes_staker, no_staker, market_id="tote-1", outcome="yes", **kwargs):
    _to_resolved(direct_vm, contract, creator, yes_staker, no_staker, market_id=market_id, outcome=outcome, **kwargs)
    direct_vm.warp("2026-01-01T01:25:00Z")
    contract.finalize(market_id)


def test_claim_pari_mutuel_payout(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract = direct_deploy(CONTRACT)
    direct_vm.warp(T0)
    _to_finalized(direct_vm, contract, direct_alice, direct_bob, direct_charlie, outcome="yes")
    # yes pool 1200, no pool 800, total 2000; bob is the sole yes staker -> full pot

    direct_vm.sender = direct_bob
    contract.claim("tote-1")

    assert contract.has_claimed("tote-1", "0x" + direct_bob.hex()) is True


def test_claim_already_claimed_fails(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract = direct_deploy(CONTRACT)
    direct_vm.warp(T0)
    _to_finalized(direct_vm, contract, direct_alice, direct_bob, direct_charlie, outcome="yes")

    direct_vm.sender = direct_bob
    contract.claim("tote-1")
    with direct_vm.expect_revert("Already claimed"):
        contract.claim("tote-1")


def test_claim_no_winning_stake_fails(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract = direct_deploy(CONTRACT)
    direct_vm.warp(T0)
    _to_finalized(direct_vm, contract, direct_alice, direct_bob, direct_charlie, outcome="yes")

    direct_vm.sender = direct_charlie  # staked "no", outcome is "yes"
    with direct_vm.expect_revert("No winning stake"):
        contract.claim("tote-1")


def test_claim_not_finalized_fails(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract = direct_deploy(CONTRACT)
    direct_vm.warp(T0)
    _to_resolved(direct_vm, contract, direct_alice, direct_bob, direct_charlie)

    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("not finalized"):
        contract.claim("tote-1")


# ---------------------------------------------------------------------------
# views / misc
# ---------------------------------------------------------------------------


def test_get_market_unknown_fails(direct_vm, direct_deploy):
    contract = direct_deploy(CONTRACT)
    with direct_vm.expect_revert("not found"):
        contract.get_market("nonexistent")


def test_get_stake_and_has_claimed_defaults(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT)
    direct_vm.warp(T0)
    _create(direct_vm, contract, direct_alice)

    assert contract.get_stake("tote-1", "yes", "0x" + direct_bob.hex()) == 0
    assert contract.has_claimed("tote-1", "0x" + direct_bob.hex()) is False


def test_two_markets_are_independent(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract = direct_deploy(CONTRACT)
    direct_vm.warp(T0)
    _create(direct_vm, contract, direct_alice, market_id="tote-1")
    _create(direct_vm, contract, direct_alice, market_id="tote-2")

    _stake(direct_vm, contract, direct_bob, "yes", 500, market_id="tote-1")
    _stake(direct_vm, contract, direct_charlie, "no", 300, market_id="tote-2")

    assert contract.get_market("tote-1")["total_yes_pool"] == 500
    assert contract.get_market("tote-1")["total_no_pool"] == 0
    assert contract.get_market("tote-2")["total_yes_pool"] == 0
    assert contract.get_market("tote-2")["total_no_pool"] == 300
    assert contract.get_all_market_ids() == ["tote-1", "tote-2"]
