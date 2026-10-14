# Tote
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/license/mit/)
[![Discord](https://img.shields.io/badge/Discord-Join%20us-5865F2?logo=discord&logoColor=white)](https://discord.gg/8Jm4v89VAu)
[![Telegram](https://img.shields.io/badge/Telegram--T.svg?style=social&logo=telegram)](https://t.me/genlayer)
[![Twitter](https://img.shields.io/twitter/url/https/twitter.com/yeagerai.svg?style=social&label=Follow%20%40GenLayer)](https://x.com/GenLayer)

## About
Tote is a **verifiable pari-mutuel prediction market**: a GenLayer Intelligent
Contract where stakers back YES or NO with real GEN, GenVM validators settle the
market from a fixed public page, and a genuine dispute is weighed against the
evidence that was agreed when the market resolved, not only against a page that
may have changed since.

1. `create_market(...)` fixes the question, a public https `verification_url`,
   two **whole-line markers** (one for YES, one for NO), when staking closes,
   the earliest resolve time, the challenge window and the recovery time.
2. `stake(market_id, side)` is payable. The creator cannot stake on their own
   market.
3. `resolve(market_id)` is permissionless once `resolve_after` has passed and
   both sides have stakes. Validators fetch the page themselves and must agree
   that **exactly one** marker is a whole line of it, **and on the lines around
   that marker**. The excerpt and its sha256 are stored on chain.
4. `challenge(market_id, reason)`: any staker can dispute inside the challenge
   window by posting a bond of exactly 5% of all stakes.
5. `resolve_dispute(market_id)` is permissionless. Reviewers weigh the objection
   against the **committed excerpt and the page as it reads now**. It only
   **records** the verdict and moves no money.
6. `claim_bond(market_id)` is permissionless and returns the bond to the
   challenger after an overturn, in its own transaction (see "Why a verdict and
   its payment are separate" below).
7. `finalize(market_id)` closes an undisputed market once the window has
   passed, and `claim(market_id)` pays each winner their pro-rata share.

### What counts as evidence

The first version matched the markers anywhere in the page, which a steward
correctly pointed out can be triggered by negated, historical or unrelated text.
Resolution now works on **whole lines**:

- The page is reduced to text lines (scripts, styles, comments, `noscript`,
  `svg` and `template` content are dropped; block tags and `<br>` start a new
  line; entities are decoded; whitespace and case are normalized).
- A marker must equal **an entire line**. A line that merely contains it,
  negates it ("did not close above"), quotes it, hedges it ("analysts expect:
  ...") or splits it across two lines does not match.
- **Both markers present, or neither, resolves nothing.** Ambiguous evidence
  never produces an outcome.
- Markers must be 12 to 200 characters with at least one letter and one digit,
  so a creator has to pick something specific (a date, a figure).
- If the page cannot be read cleanly (non-200, empty, network error) nothing is
  recorded and `resolve` can simply be called again.

This is still a check that a specific line is on a specific page. It cannot tell
whether the line is *true*; the creator chooses the URL and the lines, and every
staker can read them before staking. What it does guarantee is that the page
said exactly that, validators agreed on the surrounding context, and the
agreement is committed to the chain.

### Evidence commitments and disputes

At `resolve`, validators must agree on the outcome **and the excerpt** (the
matched line plus one line each side, at most 600 characters). The excerpt and
`sha256(excerpt)` are stored (`evidence_excerpt`, `evidence_digest`).

At `resolve_dispute` the reviewers receive the objection, the question, the
**committed excerpt** and the **whole current page** (never the first few
kilobytes): the contract states what the page reads now and whether the
committed evidence is unchanged. A page that cannot be read in full (non-200, or
over 12,000 characters after reduction) yields no verdict. The model may answer
`uphold`, `overturn` or `inconclusive`; only the first two ever change anything,
and `inconclusive`, unparseable or unreadable answers leave the dispute exactly
as it was so it can be retried.

### Challenge bond and the bounded dispute fallback

- A challenge needs a **bond of exactly 5% of all stakes** (at least 1 wei).
  **Upheld**: the outcome stands and the bond is added to the winners' pool.
  **Overturned**: the outcome flips and the bond is returned to the challenger
  by `claim_bond`. A frivolous challenge costs something.
- If a dispute is not adjudicated within `stale_after`, `resolve_stale_dispute`
  is open to anyone: the **committed outcome stands** (it was agreed by
  validators on whole-line evidence) and the **bond goes to the winners**. A
  challenge nobody pursued to a verdict is not free, and resolving is
  permissionless, so a genuine challenger can push the verdict as often as
  anyone during the whole recovery time. Nothing stays locked.
- A market that never resolves can be unwound: after `stale_after` past
  `resolve_after`, each staker takes back their own stake with
  `reclaim_stake`.
- Windows are bounded on chain: challenge window 1 hour to 7 days, recovery
  time 2 hours to 30 days. The one hour floor is deliberately above the roughly
  30 minute finality measured on Bradbury, so a challenge can never be cut off
  by consensus latency.

### Why a verdict and its payment are separate

A live run of this contract exposed a real hazard. Its own `get_accounting()`
ended the run with a **shortfall of exactly one bond** (0.00025 GEN). Reading the
transaction data showed that an *upheld* dispute (which by design sends nothing)
carried a refund message to the challenger; that it was the only dispute
transaction whose leader had been **rotated** (`rotationsLeft` 2 of 3); and that
the contract's balance had physically dropped twice (at 16:18 and 16:19 UTC on
the day of the run) while its ledger had scheduled one payment. The most
plausible reading is that a message from a rotated-out leader's execution
survived into the final result. That is a platform behavior a contract cannot
prevent, only avoid.

So no transfer may share a transaction with a nondeterministic block.
`resolve_dispute` (which runs the model) now only records the verdict, and
`claim_bond` (deterministic, so never rotated) does the paying from recorded
state. A stale message can then leave nothing behind to pay. Waypoint uses the
same split (`resolve_dispute`, then `settle`). The affected deployment
(`0x077a8e55...`, with its run in `scripts/e2e-log-v3.json`) stays as it was, and
its 0.00025 GEN shortfall is real and unrecovered; nothing here claims otherwise.

### Payouts

Payments go through `gl.evm.contract_interface` (`Payee`), the documented
chain-layer path for paying a wallet. A payment only executes when the
transaction that emitted it **finalizes**; if that transaction is rejected or
overturned the message is dropped with it. Every entitlement (a claim, a stake
reclaim, a returned bond) is recorded in `payouts` and its transfer emitted in
the **same transaction**, one record per key, and none of those transactions runs
a model, so nothing can be paid twice.
There is no retry method, because re-sending a payment that was merely slow to
finalize is what once created the duplicate-delivery risk.

`get_accounting()` reconciles the ledger against the contract's real balance,
read-only: `unscheduled` (still owed), `in_flight` (scheduled, waiting for
finality) and `shortfall`. `in_flight` returning to 0 means every scheduled
payout has landed.

## Live deployment
Deployed on **GenLayer Bradbury Testnet** (chain ID 4221):
- **Contract (v4):** [`0x9E168F61bCC6206613F874Ce4De4Af1119ddC685`](https://explorer-bradbury.genlayer.com/address/0x9E168F61bCC6206613F874Ce4De4Af1119ddC685)
- **Frontend:** https://tote-frontend.vercel.app
- Earlier deployments are superseded: v3 `0x077a8e55...` (refunded the bond
  inside `resolve_dispute`; its run, including the shortfall described above, is
  kept in `scripts/e2e-log-v3.json`), `0xC8879351...` (substring markers) and
  before it the first deployment.

<!--LIVE_START-->
## Live evidence (Bradbury, contract v4)

`scripts/e2e.mjs` ran every scenario below against the deployed v4 contract with a **separate creator wallet and two staker wallets**. The full machine-readable log is `scripts/e2e-log-v4.json` (the earlier run against v3 is `scripts/e2e-log-v3.json`); the evidence pages are in `demo/evidence/`. Run `mv72auew`.

| Scenario | What was tested | Transactions | Result |
|---|---|---|---|
| Misleading evidence | a page showing **both** outcome lines, and a page with only a hedged "analysts expect" line | resolve [`0x0da363cceb`](https://explorer-bradbury.genlayer.com/tx/0x0da363cceba3a7f2824f48096eaad6241cc0d3ed187da6d0fab3961bdaf742f1) [`0xce49ee6634`](https://explorer-bradbury.genlayer.com/tx/0xce49ee66349b07eaf7c29cb67b6a4b5e6049b498329ec025bd678ed873a0efb2) | Both resolves `FINISHED_WITH_ERROR`; the market stays `open` and `evidence_digest` stays empty. The both-outcomes market was then recovered: each staker took back their own stake after `stale_after` and a repeat reclaim was refused (the hedged-line market runs the same recovery; its entries are in the log once it finishes) |
| Clean resolve and claim | no objection; early `finalize` inside the window; duplicate and losing-side claims | resolve [`0x993fe0d9a6`](https://explorer-bradbury.genlayer.com/tx/0x993fe0d9a625eebae8dd1431a28e9bd49bbe8b4baa4d730af1706165eca7b56b), finalize [`0xfaa7654b4b`](https://explorer-bradbury.genlayer.com/tx/0xfaa7654b4bf3dcb8ff42e11c20f537a27644f8cc4eb9142846a71b3a3e461cd5), claim [`0xee4881fc45`](https://explorer-bradbury.genlayer.com/tx/0xee4881fc459204a3014d30939b30ea2e5eedb5d7ced95e762d8e4f617e9d5776) | Early finalize refused; the winner's payout record equals the whole pool; duplicate claim and the loser's claim refused |
| Uphold | outcome is right, a staker objects without cause | resolve [`0xabc0559584`](https://explorer-bradbury.genlayer.com/tx/0xabc0559584df49a3a07dcdf7bdb9655902bb7568b4f0c51764260c8c3c5d9694), challenge [`0x7718b35ab9`](https://explorer-bradbury.genlayer.com/tx/0x7718b35ab92fdf2896487ee0de3b2528e0e9d9f4e3842eb7aa56407d0ad55b2a), dispute [`0x0b0dc1940c`](https://explorer-bradbury.genlayer.com/tx/0x0b0dc1940cfaa875e78f90f206212d29a12ce32bd3f4ab4b196824ba6fa6785d) [`0xc5d0793eda`](https://explorer-bradbury.genlayer.com/tx/0xc5d0793eda04d85422d94f0ae4bd4cb362911651e1aa53ed63ae5af100867eec) | Outcome stands; the forfeited bond is added to the winner's payout |
| Overturn | the page's own correction line contradicts its YES line | resolve [`0x4597faa274`](https://explorer-bradbury.genlayer.com/tx/0x4597faa2741402c9ed8e8984adc21986efdb457356a0d00ec2231809c993256b), challenge [`0x5d7b2040af`](https://explorer-bradbury.genlayer.com/tx/0x5d7b2040afb3e3025156301bf4fb5bc61d3b8449e6a8fedf7acc451ff2a333f4), dispute [`0x81de5fd6cd`](https://explorer-bradbury.genlayer.com/tx/0x81de5fd6cdddbe7be9831e1269aeb397e2db9763e1bdf0c09ee0823b1273bdb5), claim_bond [`0x535ce0ecc7`](https://explorer-bradbury.genlayer.com/tx/0x535ce0ecc7896c345254c86e45f87a28f813420a6881efd442e71af13d9f310a) | Outcome flipped to NO and the dispute transaction moved no money; `claim_bond` then returned the bond (a repeat was refused), the new winner was paid the whole pool, the former winner's claim refused |
| Page changed after resolution | page edited to say no close is published, then a staker objects | resolve [`0xb574ecb7d7`](https://explorer-bradbury.genlayer.com/tx/0xb574ecb7d746befaee5fd6b60ef54e45d8a9e33d5d427c5db9b7d9fd7e34907e), challenge [`0xa611b1512d`](https://explorer-bradbury.genlayer.com/tx/0xa611b1512d3a8669e9492edba87f114852ab5fe28d72d059be4859f60c629c31), dispute [`0xe093920586`](https://explorer-bradbury.genlayer.com/tx/0xe0939205860134cfdb6ae30de96badb0f36190a0b6f94334fe7898a22e8e6b5a) | after the edit the dispute ended finalized with outcome YES (note: The committed evidence, which reflects the state of the page at resolution, shows that BTC closed above 90000 USD, supporting the original outcome of YES.) |
| Stale dispute | challenged, never adjudicated, `stale_after` = 2 hours | early/settle [`0xba6a43e1ba`](https://explorer-bradbury.genlayer.com/tx/0xba6a43e1baeadf4e9493661451311d1907023ee74a13c60927ea4aecc5c32329) [`0x9450342695`](https://explorer-bradbury.genlayer.com/tx/0x94503426959ea5b9d0421f7f8d744c43eefd725b98fd20e4ab7395bae412c253) | after the stale fallback the winner is paid 0.005250 = pool + bond |

### Finality and the challenge window

Transactions were `ACCEPTED` within seconds to a couple of minutes and `FINALIZED` about **29.0 to 30.0 minutes** after acceptance (10 measurements in this run). Payments are delivered on finalization, which is why the challenge window can never be shorter than one hour (twice the measured finality) and why the frontend does not treat `ACCEPTED` as done.

### Payments, checked against the contract's own accounting

Wallet balance deltas include the gas the same wallet paid on other transactions in that window, so the authoritative check is the contract's own ledger: each claim's payout record equals the expected amount (whole pool, pool plus forfeited bond, or the original stake). The script also logs that `resolve_dispute` moved no money and fails its own run if the final accounting shows anything in flight, anything short, or a balance that differs from what is still owed.

**Accounting check passed**: nothing in flight, nothing short, and the contract balance equals exactly what is still owed.

Final accounting snapshot: `{"balance": 5250000000000000, "in_flight": 0, "shortfall": 0, "total_in": "36000000000000000", "total_scheduled": "30750000000000000", "unscheduled": 5250000000000000}`

### Tested through the UI

The app itself was also driven end to end on localhost with separate wallets (a headless browser with a small wallet shim that signs with the test wallets). On the current contract (v4) market `tote-ui-3` was created, staked YES from one wallet and NO from another, resolved, challenged (the bond sent was exactly the 0.00025 GEN, 5% of the pool, that the dialog stated), and the verdict came back **overturned (Finalized: NO)** with the model's reason shown. The page then offered **Return Bond To Challenger**, which was sent as its own transaction and recorded (`bond_refunded` true), and the winner claimed 0.005 GEN. On the previous deployment (v3) a market was also run through create, stake, resolve, challenge, dispute and claim. Each write showed signed, sent, accepted and *state confirmed*, and fund-moving writes showed the wait for finality. A transaction that Bradbury dropped (one challenge, one stake that missed its window) was reported as a timeout, not a success, and was repeated. The contract's accounting was checked again after those transactions finalized and still passed.

### Tested on the live site with a real MetaMask

The harness fakes the wallet, so the app was also run on the **live site with a real MetaMask and two accounts**. MetaMask asked to connect both accounts and to add the Bradbury network (the GenLayer Snap was already installed from the Waypoint run). A test wallet staked the YES side by script, because the creator cannot stake and a two-sided market needs a third staker; everything else was real MetaMask. Market `tote-live-1` was created from account A, account B staked NO (0.003 GEN), then B resolved the market, challenged it with the exact 0.0003 GEN bond (5% of the 0.006 GEN pool), resolved the dispute (verdict **overturned**, outcome NO, with the model's reason shown and a note that no money had moved), sent **Return Bond To Challenger**, and claimed. When the bond refund and claim finalized the app showed "Finalized, funds delivered" and account B rose by exactly **0.0063 GEN** (the 0.006 pool plus the 0.0003 bond), `bond_refunded` read true, and the contract's accounting ended with nothing in flight or short.

One attempt failed in the wallet: the first Return Bond submission reported "Failed to submit the claim_bond transaction" at the send stage, before reaching the validators, and nothing changed on chain. The retry went through. This is the same occasional send-time failure seen in the scripted runs.

<!--LIVE_END-->

## Tests

| Test Type | Command | What it covers |
|-----------|---------|----------------|
| **Lint** | `genvm-lint check contracts/tote.py` | static checks |
| **Direct** | `python -m pytest tests/direct/ -v` | 53 in-memory tests with web and LLM mocks |
| **Frontend logic** | `cd frontend && npm test` | action rules, limits mirrored from the contract, decoding, GEN formatting |
| **Live** | `node scripts/e2e.mjs` | the Bradbury run described above, separate creator and staker wallets |

The direct tests cover whole-line matching (negated, historical, quoted, hedged,
split, substring and "and more words" lines all refused), both-or-neither
markers resolving nothing, hidden and hostile markup, unreadable pages recording
nothing, the exact bond and its minimum, the inclusive challenge window
boundary, every verdict path (uphold, overturn, inconclusive, malformed,
oversized page), the dispute prompt carrying the committed excerpt and the "page
changed" fact, prompt-block forgery, the stale-dispute fallback, stake recovery
including its boundaries, pro-rata claims across several winners (including the
rounding remainder), every payout path paying exactly once, and the accounting.

Every rule was mutation-checked: 96 deliberate breakages, 90 caught. The 6
survivors are not reachable from direct mode: validators in direct mode always
recompute exactly what the leader computed, so disagreement paths cannot be
exercised there, and a few guards (the open-status check on `stake`, the port
and credential checks, the verdict parser) sit behind a second check that
already stops the same input.

## Requirements
- Python >= 3.12
- [GenLayer CLI](https://github.com/genlayerlabs/genlayer-cli) globally installed: `npm install -g genlayer`

## Project Structure

```
contracts/tote.py         # the Intelligent Contract
tests/direct/             # fast in-memory tests (no Studio required)
scripts/e2e.mjs           # live Bradbury run + its log (e2e-log.json)
demo/evidence/            # the public pages the live run resolves against
frontend/                 # Next.js 16 app (TypeScript, TanStack Query, Radix UI)
```

## Quick Start

```shell
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
genvm-lint check contracts/tote.py
python -m pytest tests/direct/ -v      # use python -m, not bare pytest
genlayer deploy --contract contracts/tote.py
```

Then `cp frontend/.env.example frontend/.env`, set `NEXT_PUBLIC_CONTRACT_ADDRESS`,
and run `npm install && npm run dev` in `frontend/`.

## Frontend

- **Reads** use an account-free client. **Writes** use a second client built
  with the injected wallet provider and connected to Bradbury before signing,
  as the GenLayerJS docs prescribe for browser wallets.
- An `ACCEPTED` transaction is **not** treated as done. A write is complete only
  when the transaction was accepted, its execution returned (not a revert), and
  the contract read back as expected (the market status, or for stakes, claims
  and reclaims the wallet's own position). Fund-moving writes (`claim`,
  `claim_bond`, `reclaim_stake`) then keep watching until the transaction
  is `FINALIZED`, because the transfer lands then, and say so in the UI.
- The create form validates the URL and markers with the same rules as the
  contract (and a unit test fails if the limits drift apart) and offers only
  challenge windows above Bradbury finality. The challenge dialog states the
  exact bond.
- The list loads the newest 20 markets through the paged
  `get_market_ids(offset, limit)`, never the whole history.

## Methods

| Method | Access | Notes |
|---|---|---|
| `create_market` | anyone | whole-line markers, windows bounded on chain |
| `stake` | anyone but the creator (payable) | before `lock_time` |
| `resolve` | anyone | exactly one marker line, commits excerpt and digest |
| `challenge` | a staker (payable) | exact bond, inside the window |
| `resolve_dispute` | anyone | records uphold or overturn, moves no money; anything unclear changes nothing |
| `claim_bond` | anyone | returns the bond to the challenger after an overturn, once |
| `finalize` | anyone | after the window, no dispute |
| `resolve_stale_dispute` | anyone | after `stale_after`: committed outcome stands, bond to the winners |
| `claim` | a winning staker | pro-rata, once |
| `reclaim_stake` | a staker | market stuck open past `stale_after`, own stake only |
| `get_market` (includes `bond_refunded`), `get_market_count`, `get_market_ids`, `get_stake`, `get_claim_payout`, `get_reclaim_payout`, `get_accounting` | view | ids are paged, at most 50 |

## Community
- **[Discord](https://discord.gg/8Jm4v89VAu)**: Discussions, support, and announcements
- **[Telegram](https://t.me/genlayer)**: Informal chats and quick updates

## Documentation
For detailed information, see our [documentation](https://docs.genlayer.com/).

## License
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
