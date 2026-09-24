"use client";

import { AccountPanel } from "./AccountPanel";
import { LogoFull } from "./Logo";
import { GENLAYER_CHAIN_ID, GENLAYER_NETWORK } from "@/lib/genlayer/client";

// "GenLayer Bradbury Testnet" -> "Bradbury" for the compact readout.
const NETWORK_SHORT_NAME = GENLAYER_NETWORK.chainName
  .replace(/^GenLayer\s+/i, "")
  .replace(/\s+Testnet$/i, "");

export function Navbar() {
  return (
    <header
      className="flex items-center justify-between gap-4 flex-wrap pb-6 mb-8"
      style={{ borderBottom: "1px solid var(--border)" }}
    >
      <LogoFull size="md" />
      <div className="flex items-center gap-4">
        <div className="network-chip">
          <span className="led" />
          {NETWORK_SHORT_NAME} &middot; {GENLAYER_CHAIN_ID}
        </div>
        <AccountPanel />
      </div>
    </header>
  );
}
