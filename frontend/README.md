# Tote Frontend

Next.js frontend for Tote - a verifiable pari-mutuel prediction market on
GenLayer. Reads and writes the deployed `Tote` contract on **GenLayer
Bradbury Testnet** (chain ID 4221).

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env` file:

```bash
cp .env.example .env
```

3. Configure environment variables in `.env`:
   - `NEXT_PUBLIC_CONTRACT_ADDRESS` - your deployed Tote contract address
   - `NEXT_PUBLIC_GENLAYER_RPC_URL` - Bradbury RPC (default: `https://rpc-bradbury.genlayer.com`)
   - `NEXT_PUBLIC_GENLAYER_CHAIN_ID` - must stay `4221` (Bradbury), consistent with the RPC URL above

## Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Build

```bash
npm run build
npm start
```

## Tech Stack

- **Next.js 16** - React framework with App Router
- **TypeScript** - Type safety
- **Tailwind CSS v4** - Styling
- **genlayer-js** - GenLayer blockchain SDK
- **TanStack Query (React Query)** - Data fetching and caching
- **Radix UI** - Accessible component primitives

## Wallet

Connects via MetaMask (or any injected EIP-1193 provider) and prompts the
user to add/switch to the GenLayer Bradbury Testnet if needed. No private
keys are ever generated, imported, or stored by this app. The connect flow
is a polished panel - wallet detected, network verified, signature
confirmed, account linked, each with its own status icon - rather than a
generic modal.

## Features

- **Open a market**: `create_market(...)` locks in a question, a public https
  verification URL, two **whole-line** outcome markers, a staking deadline, the
  earliest resolve time, a challenge window and a recovery time. The form
  checks the URL and markers with the contract's own rules.
- **Stake**: `stake(market_id, side)` is payable and backs either side of an
  open market with real GEN. The stake is confirmed by reading the wallet's own
  position back.
- **Resolve**: permissionless. Validators must agree that exactly one marker is
  a whole line of the page (both or neither resolves nothing) and on the lines
  around it. The excerpt and its sha256 are shown as the committed evidence.
- **Challenge / Resolve Dispute**: any staker can dispute a resolved outcome
  inside the challenge window (1 hour to 7 days) by posting a bond of exactly
  5% of all stakes. Anyone can resolve the dispute against the committed
  excerpt and the page as it reads now. Upheld: the outcome stands and the
  bond goes to the winners. Overturned: the outcome flips and the bond is
  returned. Unclear: nothing changes.
- **Finalize / Claim**: close the challenge window, then claim a pari-mutuel
  share of the pool. Claim shows only for a wallet with a winning stake that
  has not claimed, and Challenge only for a staker in that market.
- **Recover stuck markets**: after the market's recovery time, a staker can
  take back their own stake from a market stuck open, and any connected account
  can settle a stuck dispute (the committed outcome stands and the bond goes to
  the winners, so a frivolous challenge costs something).
- **Honest transaction status**: a write shows signed, sent, accepted, then
  *state confirmed* once the contract reads back changed. Fund-moving writes
  keep watching until the transaction is FINALIZED (about 30 minutes on
  Bradbury), because that is when the transfer lands.
- **Market board**: every market on the contract, with a live pool-split
  proportion bar for each
