"use client";

import { useState } from "react";
import { useWallet } from "@/lib/genlayer/wallet";
import { GENLAYER_NETWORK } from "@/lib/genlayer/client";
import { error, userRejected } from "@/lib/utils/toast";
import { VesicaGlyph } from "./VesicaGlyph";

const METAMASK_INSTALL_URL = "https://metamask.io/download/";

function StepIcon({ path }: { path: string }) {
  return (
    <div className="seq-icon">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9a988f" strokeWidth="1.8">
        <path d={path} />
      </svg>
    </div>
  );
}

function CheckMark({ done }: { done: boolean }) {
  return (
    <svg className="seq-check" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="10" fill={done ? "#1fa37a" : "#34343f"} opacity={done ? 0.15 : 0.4} />
      {done && <path d="M6 10.5l2.5 2.5L14 7.5" stroke="#35c794" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}

function SeqRow({ iconPath, k, v, done }: { iconPath: string; k: string; v: string; done: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <StepIcon path={iconPath} />
      <div className="flex-1">
        <div className="font-semibold text-[0.78rem] text-foreground">{k}</div>
        <div className="font-mono text-[0.66rem] mt-0.5" style={{ color: done ? "var(--emerald-bright)" : "var(--ink-faint)" }}>{v}</div>
      </div>
      <CheckMark done={done} />
    </div>
  );
}

const ICONS = {
  wallet: "M3 6h18v13H3zM3 10h18",
  network: "M12 21a9 9 0 100-18 9 9 0 000 18zM3 12h18M12 3c2.5 2.5 4 5.5 4 9s-1.5 6.5-4 9c-2.5-2.5-4-5.5-4-9s1.5-6.5 4-9z",
  sparkle: "M12 3l2.5 5.5L20 9l-4.5 4 1.2 6.5L12 16.5 7.3 19.5 8.5 13 4 9l5.5-.5z",
  person: "M12 8a4 4 0 100 8 4 4 0 000-8zM4 20c0-4.4 3.6-8 8-8s8 3.6 8 8",
};

export function AccountPanel() {
  const {
    address, isConnected, isMetaMaskInstalled, isOnCorrectNetwork, isLoading,
    connectWallet, disconnectWallet, switchWalletAccount,
  } = useWallet();

  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);

  const handleConnect = async () => {
    if (!isMetaMaskInstalled) return;
    try {
      setIsConnecting(true);
      await connectWallet();
    } catch (err: any) {
      if (err.message?.includes("rejected")) {
        userRejected("Connection cancelled");
      } else {
        error("Failed to connect wallet", { description: err.message || "Check your MetaMask and try again." });
      }
    } finally {
      setIsConnecting(false);
    }
  };

  const handleSwitchAccount = async () => {
    try {
      setIsSwitching(true);
      await switchWalletAccount();
    } catch (err: any) {
      if (!err.message?.includes("rejected")) {
        error("Failed to switch account", { description: err.message || "Please try again." });
      } else {
        userRejected("Account switch cancelled");
      }
    } finally {
      setIsSwitching(false);
    }
  };

  const networkLabel = !isConnected ? "Pending" : isOnCorrectNetwork ? GENLAYER_NETWORK.chainName : "Wrong network";
  const shortAddr = address ? `0x${address.slice(2, 6)}…${address.slice(-4)}` : "—";

  return (
    <div className="relative">
      <button type="button" onClick={() => setIsPanelOpen((v) => !v)} disabled={isLoading} className="wallet-chip">
        <span className="avatar" />
        {isConnected ? shortAddr : "Connect Wallet"}
      </button>

      {isPanelOpen && (
        <>
          <div className="fixed inset-0 z-40" style={{ background: "rgba(4,4,6,0.65)", backdropFilter: "blur(2px)" }} onClick={() => setIsPanelOpen(false)} />
          <div
            className="fixed left-4 right-4 sm:left-auto sm:right-5 top-[76px] z-50 sm:w-[320px] p-6"
            style={{
              background: "linear-gradient(180deg, var(--popover), var(--card))",
              border: "1px solid var(--border-hi)",
              borderRadius: "18px",
              boxShadow: "0 30px 70px rgba(0,0,0,0.5), 0 0 0 1px rgba(31,163,122,0.06)",
            }}
          >
            <div className="flex justify-center mb-5">
              <div style={{ filter: isConnected ? "drop-shadow(0 0 14px rgba(31,163,122,0.35))" : "none" }}>
                <VesicaGlyph size={56} tone={isConnected ? "#1fa37a" : "#3a3a44"} ringTone="#3a3a44" ringOpacity={1} />
              </div>
            </div>
            <div className="font-display font-semibold text-xl text-center mb-1">
              {isConnected ? "Wallet Connected" : "Connect Your Wallet"}
            </div>
            <div className="font-ui text-[0.76rem] text-center mb-6" style={{ color: "var(--ink-faint)" }}>
              {isConnected ? "Signed in with MetaMask on Bradbury" : "Link MetaMask to stake, resolve, and claim"}
            </div>

            <div className="flex flex-col gap-3.5 mb-6">
              <SeqRow iconPath={ICONS.wallet} k="Wallet detected" v={isMetaMaskInstalled ? "MetaMask" : "Not found"} done={isMetaMaskInstalled} />
              <SeqRow iconPath={ICONS.network} k="Network verified" v={networkLabel} done={isConnected && isOnCorrectNetwork} />
              <SeqRow iconPath={ICONS.sparkle} k="Signature confirmed" v={isConnected ? "Session authorized" : isConnecting ? "Awaiting signature…" : "Not started"} done={isConnected} />
              <SeqRow iconPath={ICONS.person} k="Account linked" v={shortAddr} done={isConnected} />
            </div>

            <div className="flex flex-col gap-2.5">
              {!isMetaMaskInstalled && (
                <button type="button" onClick={() => window.open(METAMASK_INSTALL_URL, "_blank")} className="btn-tote primary block">
                  Install MetaMask
                </button>
              )}
              {isMetaMaskInstalled && !isConnected && (
                <button type="button" onClick={handleConnect} disabled={isConnecting} className="btn-tote primary block">
                  {isConnecting ? "Connecting…" : "Connect MetaMask"}
                </button>
              )}
              {isConnected && (
                <>
                  <button type="button" onClick={handleSwitchAccount} disabled={isSwitching} className="btn-tote ghost block">
                    {isSwitching ? "Switching…" : "Switch Account"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { disconnectWallet(); setIsPanelOpen(false); }}
                    className="btn-tote ghost danger block"
                  >
                    Disconnect
                  </button>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
