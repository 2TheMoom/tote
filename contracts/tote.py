# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from dataclasses import dataclass
from datetime import datetime, timezone
from genlayer import *

CHALLENGE_WINDOW_SECONDS = 600  # 10 minutes

REQUEST_HEADERS = {
    "Accept": "text/html,application/json,*/*",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
}


@allow_storage
@dataclass
class Market:
    creator: Address
    question: str
    verification_url: str
    yes_marker: str
    no_marker: str
    lock_time: u256
    resolve_after: u256
    status: str  # open | resolved | disputed | finalized
    outcome: str  # "" | "yes" | "no"
    resolved_at: u256
    challenge_deadline: u256
    dispute_reason: str  # "" until challenged
    resolution_note: str  # LLM's reasoning on a resolved dispute - informational only
    total_yes_pool: u256
    total_no_pool: u256


class Tote(gl.Contract):
    """A verifiable pari-mutuel prediction market - "tote" for totalizator,
    the real historical term for a pooled betting system. Multiple stakers
    pool GEN on a binary outcome; the pot is split proportionally among
    correct stakers once the market settles against a fixed, checkable
    source - no LLM for the common path.

    create_market(market_id, question, verification_url, yes_marker,
    no_marker, lock_time, resolve_after) opens a market. Two markers, not
    one, because a binary market has to distinguish YES / NO / not yet
    determined against the same source. stake(market_id, side) - payable -
    lets anyone but the market's own creator back either side before
    lock_time. resolve(market_id) - callable once resolve_after has
    passed and both pools are non-empty - is fully deterministic:
    validators independently fetch verification_url and check which
    marker is present. Neither present (or both) reverts cleanly and can
    be retried once the source is less ambiguous.

    A deterministic pass isn't the same as being right, so any staker in
    the market has a CHALLENGE_WINDOW_SECONDS window after resolution to
    dispute it with a reason. Only a genuine dispute escalates to
    gl.nondet.exec_prompt - validators re-fetch the live content and weigh
    the objection against the recorded outcome, and only the verdict
    (uphold/overturn) is consensus-critical, not the reasoning text.
    finalize(market_id) closes the window with no dispute; claim(market_id)
    then pays out real pari-mutuel shares: a winning staker's payout is
    their fraction of the winning pool, multiplied across the full
    combined pool - no protocol fee, fully redistributive.

    Known platform limitation, disclosed rather than hidden: emit_transfer
    does not currently deliver value on GenLayer's Bradbury testnet
    (github.com/genlayerlabs/genvm-manager/issues/20) - the same disclosed
    issue documented on this account's Waypoint and Salvage Arbiter
    projects. Every state transition up to and including the payout
    computation is real and independently verifiable; the final balance
    movement is blocked by this platform bug, not a defect here.
    """

    markets: TreeMap[str, Market]
    market_ids: DynArray[str]
    yes_stakers: TreeMap[str, DynArray[Address]]
    no_stakers: TreeMap[str, DynArray[Address]]
    stake_amounts: TreeMap[str, u256]
    claimed: TreeMap[str, bool]

    def __init__(self):
        pass

    def _now(self) -> int:
        return int(datetime.now(timezone.utc).timestamp())

    def _get(self, market_id: str) -> Market:
        if market_id not in self.markets:
            raise gl.vm.UserError(f"Market '{market_id}' not found")
        return self.markets[market_id]

    def _stake_key(self, market_id: str, side: str, addr: Address) -> str:
        return f"{market_id}_{side}_{addr.as_hex}".lower()

    @gl.public.write
    def create_market(
        self,
        market_id: str,
        question: str,
        verification_url: str,
        yes_marker: str,
        no_marker: str,
        lock_time: int,
        resolve_after: int,
    ) -> None:
        if market_id in self.markets:
            raise gl.vm.UserError(f"Market '{market_id}' already exists")
        if not question:
            raise gl.vm.UserError("question cannot be empty")
        if not verification_url.startswith("https://"):
            raise gl.vm.UserError("verification_url must start with https://")
        if not yes_marker or not no_marker:
            raise gl.vm.UserError("yes_marker and no_marker cannot be empty")
        if yes_marker.lower() == no_marker.lower():
            raise gl.vm.UserError("yes_marker and no_marker must be different")

        now = self._now()
        if lock_time <= now:
            raise gl.vm.UserError("lock_time must be in the future")
        if resolve_after < lock_time:
            raise gl.vm.UserError("resolve_after must be at or after lock_time")

        self.markets[market_id] = Market(
            creator=gl.message.sender_address,
            question=question,
            verification_url=verification_url,
            yes_marker=yes_marker,
            no_marker=no_marker,
            lock_time=lock_time,
            resolve_after=resolve_after,
            status="open",
            outcome="",
            resolved_at=0,
            challenge_deadline=0,
            dispute_reason="",
            resolution_note="",
            total_yes_pool=0,
            total_no_pool=0,
        )
        self.market_ids.append(market_id)

    @gl.public.write.payable
    def stake(self, market_id: str, side: str) -> None:
        m = self._get(market_id)
        if side not in ("yes", "no"):
            raise gl.vm.UserError("side must be 'yes' or 'no'")
        if m.status != "open":
            raise gl.vm.UserError(f"Market is not open for staking (status: {m.status})")
        if self._now() >= m.lock_time:
            raise gl.vm.UserError("Staking has closed for this market")

        value = gl.message.value
        if value <= 0:
            raise gl.vm.UserError("Must stake a positive amount")

        sender = gl.message.sender_address
        if sender == m.creator:
            raise gl.vm.UserError("The market creator cannot stake on their own market")

        key = self._stake_key(market_id, side, sender)
        existing = self.stake_amounts.get(key, u256(0))
        if existing == 0:
            if side == "yes":
                self.yes_stakers.get_or_insert_default(market_id).append(sender)
            else:
                self.no_stakers.get_or_insert_default(market_id).append(sender)
        self.stake_amounts[key] = existing + value

        if side == "yes":
            m.total_yes_pool += value
        else:
            m.total_no_pool += value

    def _fetch_outcome(self, url: str, yes_marker: str, no_marker: str) -> dict:
        def leader_fn() -> dict:
            try:
                resp = gl.nondet.web.request(url, method="GET", headers=REQUEST_HEADERS)
                body = (resp.body or b"").decode("utf-8", errors="ignore").lower()
            except Exception:
                return {"outcome": ""}
            yes_found = yes_marker.lower() in body
            no_found = no_marker.lower() in body
            if yes_found and not no_found:
                return {"outcome": "yes"}
            if no_found and not yes_found:
                return {"outcome": "no"}
            return {"outcome": ""}

        def validator_fn(leaders_res) -> bool:
            if not isinstance(leaders_res, gl.vm.Return):
                return False
            mine = leader_fn()
            return mine["outcome"] == leaders_res.calldata["outcome"]

        return gl.vm.run_nondet_unsafe(leader_fn, validator_fn)

    @gl.public.write
    def resolve(self, market_id: str) -> None:
        m = self._get(market_id)
        if m.status != "open":
            raise gl.vm.UserError(f"Market is not awaiting resolution (status: {m.status})")
        if self._now() < m.resolve_after:
            raise gl.vm.UserError("resolve_after has not passed yet")
        if m.total_yes_pool == 0 or m.total_no_pool == 0:
            raise gl.vm.UserError("Market needs stakes on both sides to resolve")

        result = self._fetch_outcome(m.verification_url, m.yes_marker, m.no_marker)
        outcome = result.get("outcome", "")
        if outcome not in ("yes", "no"):
            raise gl.vm.UserError(
                "Outcome not yet determinable from the verification source - try again shortly"
            )

        now = self._now()
        m.status = "resolved"
        m.outcome = outcome
        m.resolved_at = now
        m.challenge_deadline = now + CHALLENGE_WINDOW_SECONDS

    @gl.public.write
    def challenge(self, market_id: str, reason: str) -> None:
        m = self._get(market_id)
        sender = gl.message.sender_address
        yes_key = self._stake_key(market_id, "yes", sender)
        no_key = self._stake_key(market_id, "no", sender)
        if self.stake_amounts.get(yes_key, u256(0)) == 0 and self.stake_amounts.get(no_key, u256(0)) == 0:
            raise gl.vm.UserError("Only a staker in this market can challenge it")
        if m.status != "resolved":
            raise gl.vm.UserError(f"Market is not in a challengeable state (status: {m.status})")
        if self._now() > m.challenge_deadline:
            raise gl.vm.UserError("Challenge window has closed")
        if not reason:
            raise gl.vm.UserError("A challenge reason is required")

        m.status = "disputed"
        m.dispute_reason = reason

    def _adjudicate_dispute(self, m: Market) -> dict:
        def leader_fn() -> dict:
            try:
                resp = gl.nondet.web.request(m.verification_url, method="GET", headers=REQUEST_HEADERS)
                body = (resp.body or b"")[:4000].decode("utf-8", errors="ignore")
            except Exception:
                body = "(the verification URL could not be fetched)"

            current_marker = m.yes_marker if m.outcome == "yes" else m.no_marker
            prompt = (
                "You are adjudicating a disputed prediction market on GenLayer.\n\n"
                f"Question: {m.question}\n"
                f"Verification URL: {m.verification_url}\n"
                f'An automated check already resolved this market to "{m.outcome}" based on '
                f'matching the marker "{current_marker}".\n'
                f"A staker disputes this outcome. Dispute reason: {m.dispute_reason}\n\n"
                "Current live content fetched from the verification URL (may be truncated):\n"
                "---\n" + body + "\n---\n\n"
                "Decide whether the automated outcome genuinely reflects what the source "
                "currently shows, given the disputer's specific objection. Respond with JSON "
                'only: {"verdict": "uphold" or "overturn", "reasoning": "one sentence"}. '
                '"uphold" means the recorded outcome stands. "overturn" means the outcome '
                "should flip to the other side."
            )
            raw = gl.nondet.exec_prompt(prompt, response_format="json")
            verdict = raw.get("verdict")
            if verdict not in ("uphold", "overturn"):
                verdict = "uphold"  # fail closed - an unparseable verdict shouldn't flip the market
            reasoning = str(raw.get("reasoning", ""))[:400]
            return {"verdict": verdict, "reasoning": reasoning}

        def validator_fn(leaders_res) -> bool:
            if not isinstance(leaders_res, gl.vm.Return):
                return False
            mine = leader_fn()
            return mine["verdict"] == leaders_res.calldata["verdict"]

        return gl.vm.run_nondet_unsafe(leader_fn, validator_fn)

    @gl.public.write
    def resolve_dispute(self, market_id: str) -> None:
        m = self._get(market_id)
        if m.status != "disputed":
            raise gl.vm.UserError(f"Market is not under dispute (status: {m.status})")

        result = self._adjudicate_dispute(m)
        m.resolution_note = result["reasoning"]
        if result["verdict"] == "overturn":
            m.outcome = "no" if m.outcome == "yes" else "yes"
        m.status = "finalized"

    @gl.public.write
    def finalize(self, market_id: str) -> None:
        m = self._get(market_id)
        if m.status != "resolved":
            raise gl.vm.UserError(f"Market is not awaiting finalization (status: {m.status})")
        if self._now() <= m.challenge_deadline:
            raise gl.vm.UserError("Challenge window is still open")
        m.status = "finalized"

    @gl.public.write
    def claim(self, market_id: str) -> None:
        m = self._get(market_id)
        if m.status != "finalized":
            raise gl.vm.UserError(f"Market is not finalized (status: {m.status})")

        sender = gl.message.sender_address
        claim_key = f"{market_id}_{sender.as_hex}".lower()
        if self.claimed.get(claim_key, False):
            raise gl.vm.UserError("Already claimed for this market")

        my_stake = self.stake_amounts.get(self._stake_key(market_id, m.outcome, sender), u256(0))
        if my_stake == 0:
            raise gl.vm.UserError("No winning stake to claim for this wallet")

        winning_pool = m.total_yes_pool if m.outcome == "yes" else m.total_no_pool
        total_pool = m.total_yes_pool + m.total_no_pool
        payout = (my_stake * total_pool) // winning_pool

        self.claimed[claim_key] = True
        gl.get_contract_at(sender).emit_transfer(value=payout)

    @gl.public.view
    def get_market(self, market_id: str) -> dict:
        m = self._get(market_id)
        return {
            "creator": m.creator.as_hex,
            "question": m.question,
            "verification_url": m.verification_url,
            "yes_marker": m.yes_marker,
            "no_marker": m.no_marker,
            "lock_time": m.lock_time,
            "resolve_after": m.resolve_after,
            "status": m.status,
            "outcome": m.outcome,
            "resolved_at": m.resolved_at,
            "challenge_deadline": m.challenge_deadline,
            "dispute_reason": m.dispute_reason,
            "resolution_note": m.resolution_note,
            "total_yes_pool": m.total_yes_pool,
            "total_no_pool": m.total_no_pool,
        }

    @gl.public.view
    def get_all_market_ids(self) -> list:
        return list(self.market_ids)

    @gl.public.view
    def get_stake(self, market_id: str, side: str, wallet: str) -> u256:
        return self.stake_amounts.get(self._stake_key(market_id, side, Address(wallet)), u256(0))

    @gl.public.view
    def has_claimed(self, market_id: str, wallet: str) -> bool:
        return self.claimed.get(f"{market_id}_{Address(wallet).as_hex}".lower(), False)

    @gl.public.view
    def get_yes_stakers(self, market_id: str) -> list:
        return [a.as_hex for a in self.yes_stakers.get(market_id, [])]

    @gl.public.view
    def get_no_stakers(self, market_id: str) -> list:
        return [a.as_hex for a in self.no_stakers.get(market_id, [])]
