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

**Known platform limitation, disclosed rather than hidden:** `emit_transfer`
does not currently deliver value on GenLayer's Bradbury testnet
([genvm-manager#20](https://github.com/genlayerlabs/genvm-manager/issues/20)) -
the same disclosed issue already documented on this account's Waypoint and
Salvage Arbiter projects. Every state transition up to and including the
payout computation is real and independently verifiable; the final balance
movement is blocked by this platform bug, not a defect here.

## Live deployment
Deployed on **GenLayer Bradbury Testnet** (chain ID 4221):
- **Contract:** [`0x18d050c7674b93C45Ead9d3DAB1250A6D4813485`](https://explorer-bradbury.genlayer.com/address/0x18d050c7674b93C45Ead9d3DAB1250A6D4813485)
- **Frontend:** `<pending>`
- Verified via 37 passing direct-mode tests (`python -m pytest tests/direct/`),
  covering the full lifecycle (open → resolved → finalized, and the
  disputed branch), every validation guard (duplicate/empty-field checks,
  same-marker rejection, the creator-can't-stake rule, the both-pools-must-
  be-nonempty guard before resolving), a clean revert-then-retry when
  neither (or both) markers are found, the challenge-window boundary, both
  dispute verdicts (uphold and overturn - including the outcome flip),
  and real pari-mutuel payout accounting.

## What's included
- `contracts/tote.py` — the Tote Intelligent Contract
- `tests/direct/test_tote.py` — direct-mode tests (in-memory, mocked web/LLM)
- **Contract linting** — static analysis to catch common contract issues before deployment
- **CI pipeline** — GitHub Actions workflow for linting and direct tests
- A Next.js 16 frontend (TypeScript, TanStack Query, Radix UI) — a premium
  financial-instrument treatment: a vesica mark, large serif pool figures
  with a live proportion bar, and a polished wallet-connect sequence
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
8. **`get_market`** / **`get_all_market_ids`** / **`get_stake`** /
   **`has_claimed`** / **`get_yes_stakers`** / **`get_no_stakers`** — read
   back a market's full state, its stakers, and a wallet's position.

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
