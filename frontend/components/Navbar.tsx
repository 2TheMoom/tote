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
    <header className="pb-5 mb-6 sm:pb-6 sm:mb-8" style={{ borderBottom: "1px solid var(--border)" }}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <LogoFull size="md" />
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <div className="network-chip hidden sm:flex">
            <span className="led" />
            {NETWORK_SHORT_NAME} &middot; {GENLAYER_CHAIN_ID}
          </div>
          <AccountPanel />
        </div>
      </div>
      <div className="network-chip mt-3 sm:hidden">
        <span className="led" />
        {NETWORK_SHORT_NAME} &middot; {GENLAYER_CHAIN_ID}
      </div>
    </header>
  );
}
