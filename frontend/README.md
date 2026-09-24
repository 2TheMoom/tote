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

- **Open a market**: `create_market(...)` locks in a question, a
  verification URL, two outcome markers, a staking deadline, and the
  earliest resolve time
- **Stake**: `stake(market_id, side)` - payable - backs either side of an
  open market with real GEN
- **Resolve**: permissionless, deterministic - validators independently
  confirm which marker is present at the verification URL, no LLM
- **Challenge / Resolve Dispute**: any staker can dispute a resolved
  outcome within a 10-minute window; validators weigh the dispute against
  the live content via reasoned judgment only when genuinely escalated
- **Finalize / Claim**: close the challenge window, then claim a real
  pari-mutuel share of the pool
- **Market board**: every market on the contract, with a live pool-split
  proportion bar for each
