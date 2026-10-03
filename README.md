# Tote
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/license/mit/)
[![Discord](https://img.shields.io/badge/Discord-Join%20us-5865F2?logo=discord&logoColor=white)](https://discord.gg/8Jm4v89VAu)
[![Telegram](https://img.shields.io/badge/Telegram--T.svg?style=social&logo=telegram)](https://t.me/genlayer)
[![Twitter](https://img.shields.io/twitter/url/https/twitter.com/yeagerai.svg?style=social&label=Follow%20%40GenLayer)](https://x.com/GenLayer)

## About
Tote is a **verifiable pari-mutuel prediction market** - "tote" for
totalizator, the real historical term for a pooled betting system, not
invented terminology. Multiple stakers pool GEN on a binary (YES/NO)
real-world outcome, and the pot is split proportionally among correct
stakers once the market settles against a fixed, checkable source - no LLM
for the common path.

`create_market(market_id, question, verification_url, yes_marker,
no_marker, lock_time, resolve_after)` opens a market. Two markers, not one,
because a binary market has to distinguish YES / NO / not-yet-determined
against the same source. `stake(market_id, side)` - payable - lets anyone
but the market's own creator back either side before `lock_time` (the
creator is barred from staking on their own market - a cheap guard against
picking biased resolution criteria for a market they've also bet on).
`resolve(market_id)` - callable once `resolve_after` has passed and both
pools are non-empty - is fully deterministic: validators independently
fetch `verification_url` and check which marker is present. Neither found
(or both) reverts cleanly and can be retried once the source is less
ambiguous.

A deterministic pass isn't the same as being right, so any staker in the
market has a 10-minute window after resolution to `challenge` it with a
reason. Only a genuine dispute escalates to `gl.nondet.exec_prompt` -
validators re-fetch the live content and weigh the objection against the
recorded outcome, and only the verdict (uphold/overturn) is
consensus-critical, not the reasoning text. `finalize(market_id)` closes
the window with no dispute; `claim(market_id)` then pays out real
pari-mutuel shares - a winning staker's payout is their fraction of the
winning pool, multiplied across the full combined pool, no protocol fee.

A market that can never reach a terminal state on its own - one side
never gets a stake, the verification source never yields exactly one
marker, or a dispute can't reach validator consensus - doesn't lock
stakes forever: `reclaim_stake(market_id, side)` lets any staker recover
their own original stake once a 24-hour recovery window has passed with
no resolution.

**Payouts and refunds go through `gl.evm.contract_interface` (`Payee`),
not `gl.get_contract_at()`.** Stakers are EOAs (plain wallets), and
`gl.get_contract_at(addr).emit_transfer(...)` is an internal
Intelligent-Contract dispatch message - for an address holding no
contract code, that message is resolved by a handler that doesn't
reliably reach validator majority, so the payout can leave this contract
and be credited to nobody, intermittently and unpredictably.
`gl.evm.contract_interface` instead emits a genuine external chain-layer
value transfer (`EthSend` with empty calldata) - the SDK's documented
primitive for paying an EOA. This was flagged directly by a GenLayer
steward reviewing this project; previously this repo (like several
others on this account) mischaracterized the resulting intermittent
failures as an unconfirmed platform bug in
[genvm-manager#20](https://github.com/genlayerlabs/genvm-manager/issues/20)
rather than what it actually was: the wrong transfer primitive for the
recipient type.

## Live deployment
Deployed on **GenLayer Bradbury Testnet** (chain ID 4221):
- **Contract:** [`0xa9465dBb90ab60d1D27Dca893bb024a39Ffa7C31`](https://explorer-bradbury.genlayer.com/address/0xa9465dBb90ab60d1D27Dca893bb024a39Ffa7C31)
- **Frontend:** [tote-frontend.vercel.app](https://tote-frontend.vercel.app)
- Verified via 61 passing direct-mode tests (`python -m pytest tests/direct/`),
  covering the full lifecycle (open → resolved → finalized, and the
  disputed branch), every validation guard (duplicate/empty-field checks,
  same-marker rejection, the creator-can't-stake rule, the both-pools-must-
  be-nonempty guard before resolving), a clean revert-then-retry when
  neither (or both) markers are found, the challenge-window boundary, both
  dispute verdicts (uphold and overturn - including the outcome flip),
  real pari-mutuel payout accounting, `reclaim_stake`'s recovery paths
  (stuck-open, stuck-disputed, too-early, double-reclaim, independent
  stakers reclaiming separately), a failed/unreachable adjudication
  reverting cleanly instead of defaulting to either verdict, and the
  dispute prompt genuinely wrapping untrusted input in isolating tags
  (verified by requiring those tags in the mock match pattern itself, not
  just asserting on the output).

### Live-verified with real GEN (previous deployment)
The runs below were against `0x18d050c7674b93C45Ead9d3DAB1250A6D4813485`,
superseded by the current address after the `Payee` fix and the other
steward-requested changes above. They still stand as evidence that the
deterministic resolve/dispute machinery works correctly on real chain
data; **tote-live-3's successful payout is exactly the kind of
intermittent success the old `gl.get_contract_at()` path could produce -
not proof it was reliable.** A fresh end-to-end run against the current
address, isolating the `Payee` mechanism specifically, is documented
immediately below this section.

Three real markets run against the previous deployment on Bradbury, each
resolving against this repo's own README as the verification source
(`yes_marker: "no protocol fee"`, `no_marker: "protocol fee applies"` -
the true text is "no protocol fee applies to payouts"):

- **tote-live-1** - a timing mistake (90-second lock window) let real
  consensus latency push `lock_time` past before both stakes could land;
  both stake calls correctly reverted `FINISHED_WITH_ERROR`, confirmed via
  `get_market` that `lock_time` had genuinely passed. A test-design error,
  not a contract bug; the market was left unstaked and abandoned.
- **tote-live-2** - realistic 10-minute window. Two real stakers backed
  opposite sides (0.006 GEN YES, 0.003 GEN NO), `resolve()` correctly
  determined `outcome: "yes"`, and the losing NO staker filed a genuine
  `challenge()`. `resolve_dispute()` hit Bradbury's LLM-path
  `DETERMINISTIC_VIOLATION` degradation twice in a row (the same
  session-wide condition that blocked Summit's `refresh()` and Waypoint's
  `resolve_dispute()` repeatedly) - `get_market` confirmed the market
  state stayed safely `"disputed"` and uncorrupted after both failed
  attempts. Left parked for a future retry once the platform's LLM
  capacity recovers.
- **tote-live-3** - a full clean happy path, start to finish, all real
  GEN: `create_market` → `stake` (0.004 GEN YES, 0.001 GEN NO, two
  different wallets) → `resolve` (`outcome: "yes"`, 5/5 AGREE) →
  `finalize` after the challenge window closed with no dispute (5/5
  AGREE) → `claim` by the YES staker, paid out the full 0.005 GEN pool
  (5/5 AGREE, `FINISHED_WITH_RETURN`) - confirmed delivered by reading
  the recipient's on-chain balance afterward, not just the transaction
  result.

### Second steward round: payout reconciliation and dispute-reason floor
A later steward pass found the `Payee` fix alone insufficient: `claim()`/
`reclaim_stake()` treated a silent `emit_transfer` as delivery with no way
back if it failed to land, and `challenge()` accepted any non-empty
reason, down to a single trivial word, for a dispute that then escalates
to real LLM adjudication. Fixed by recording every payout attempt in
`pending_payouts` before firing it - `claimed`/`reclaimed` lock the
entitlement in once (so it's computed only once), and
`retry_claim_payout()`/`retry_reclaim_payout()` let a wallet re-attempt
its own pending delivery - and by adding `MIN_DISPUTE_REASON_LENGTH` (20
characters) alongside the existing maximum.

### Third steward round: a real fund-safety bug in the retry itself
This fix was still wrong: `pending_payouts` was never cleared after a
successful delivery, so a recipient whose payout actually landed could
call retry again anyway, firing a second real transfer of the same
amount and consuming GEN owed to other stakers - an unbounded drain, not
a rare edge case, and the steward caught it correctly. Fixed with a
`pending_floor` snapshot: the recipient's balance is recorded right
before the first attempt, and retry now reads the recipient's *current*
balance and compares it against `floor + amount` - if the payout already
landed, retry clears `pending_payouts` and refuses instead of re-sending.
`test_retry_*_blocked_once_balance_confirms_delivery` proves this
directly (simulates delivery via the direct-mode harness's `deal()`,
confirms retry refuses and the record is actually cleared, not just
blocked once). 61 tests pass, lint clean. Redeployed:
`0xa9465dBb90ab60d1D27Dca893bb024a39Ffa7C31`.

A real end-to-end `stake → resolve → finalize → claim` cycle against the
current address, isolating whether `Payee`'s payout is *reliable* rather
than merely possible, needs a payable transaction - the bare `genlayer
write` CLI has no flag for attaching native value to a call at all
(`--fee-value` is the consensus fee deposit, not the call's value). A
ready-to-run script (`verify-payee-live.mjs`, `genlayer-js` with real
`value:`) is included in this repo for whoever holds the deployer key to
run directly.

## What's included
- `contracts/tote.py` — the Tote Intelligent Contract
- `tests/direct/test_tote.py` — direct-mode tests (in-memory, mocked web/LLM)
- **Contract linting** — static analysis to catch common contract issues before deployment
- **CI pipeline** — GitHub Actions workflow for linting and direct tests
- A Next.js 16 frontend (TypeScript, TanStack Query, Radix UI) — a premium
  financial-instrument treatment: a vesica mark, large serif pool figures
  with a live proportion bar, and a polished wallet-connect sequence
- `verify-payee-live.mjs` — a real end-to-end script proving the `Payee`
  payout mechanism delivers value, for whoever holds the deployer key
- Configuration file template and deployment scripts

## Requirements
- Python >= 3.12
- [GenLayer CLI](https://github.com/genlayerlabs/genlayer-cli) globally installed: `npm install -g genlayer`
- GenLayer Studio (for integration tests and deployment): Install from [Docs](https://docs.genlayer.com/developers/intelligent-contracts/tooling-setup#using-the-genlayer-studio) or use the hosted [GenLayer Studio](https://studio.genlayer.com/)

## Project Structure

```
contracts/              # Python intelligent contracts
  tote.py                  # Tote
tests/
  direct/                 # Fast in-memory tests (no Studio required)
    test_tote.py
frontend/                # Next.js 16 app (TypeScript, TanStack Query, Radix UI)
deploy/                  # TypeScript deployment scripts
gltest.config.yaml       # Test runner network configuration
pyproject.toml           # Python/pytest configuration
.github/workflows/       # CI pipeline
```

## Quick Start

### 1. Set up Python environment

```shell
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2. Lint the contract

```shell
genvm-lint check contracts/tote.py
```

### 3. Run direct mode tests

```shell
python -m pytest tests/direct/ -v
```

Use `python -m pytest`, not bare `pytest` - depending on your installed
pytest version, running the bare command can fail to put the project
root on `sys.path`, breaking test discovery with
`ModuleNotFoundError: No module named 'tests'`.

### 4. Deploy the contract

1. Choose your network: `genlayer network`
2. Deploy: `genlayer deploy` (runs the script in `/deploy/deployScript.ts`)

### 5. Set up the frontend

1. Copy `frontend/.env.example` to `frontend/.env`
2. Add your deployed contract address as `NEXT_PUBLIC_CONTRACT_ADDRESS`
3. Run:

```shell
cd frontend
npm install
npm run dev
```

The app will be available at http://localhost:3000/.

## How Tote Works

1. **`create_market(...)`** — opens a market with a question, a
   verification URL, two markers (one per outcome), a staking deadline,
   and the earliest time it can resolve.
2. **`stake(market_id, side)`** — payable. Anyone but the creator can
   back either side before staking closes.
3. **`resolve(market_id)`** — permissionless, deterministic. Requires
   both pools non-empty and the resolve window to have opened.
4. **`challenge(market_id, reason)`** — any staker in the market, within
   a 10-minute window after resolution.
5. **`resolve_dispute(market_id)`** — permissionless. Validators weigh
   the dispute against the live content via `gl.nondet.exec_prompt` and
   uphold or overturn the recorded outcome.
6. **`finalize(market_id)`** — permissionless, once the challenge window
   passes with no dispute.
7. **`claim(market_id)`** — a winning staker claims their pari-mutuel
   share: `payout = (my_stake / winning_pool) * (yes_pool + no_pool)`.
8. **`reclaim_stake(market_id, side)`** — permissionless recovery for a
   market stuck 24 hours past `resolve_after` and still `open`, or past
   `challenge_deadline` and still `disputed`: any staker gets back their
   own original stake, not a payout.
9. **`get_market`** / **`get_all_market_ids`** / **`get_stake`** /
   **`has_claimed`** / **`has_reclaimed`** / **`get_yes_stakers`** /
   **`get_no_stakers`** — read back a market's full state, its stakers,
   and a wallet's position.

## Testing Strategy

| Test Type | Command | Speed | Requires Studio |
|-----------|---------|-------|-----------------|
| **Lint** | `genvm-lint check contracts/tote.py` | ~250ms | No |
| **Direct** | `python -m pytest tests/direct/ -v` | ~ms/test | No |

## Community
- **[Discord](https://discord.gg/8Jm4v89VAu)**: Discussions, support, and announcements
- **[Telegram](https://t.me/genlayer)**: Informal chats and quick updates

## Documentation
For detailed information, see our [documentation](https://docs.genlayer.com/).

## License
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
