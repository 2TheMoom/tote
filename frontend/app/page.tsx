"use client";

import { useEffect, useMemo, useState } from "react";
import { Navbar } from "@/components/Navbar";
import { VesicaGlyph } from "@/components/VesicaGlyph";
import { useWallet } from "@/lib/genlayer/wallet";
import {
  useMarket,
  useMarketList,
  useHasClaimed,
  useCreateMarket,
  useStake,
  useResolve,
  useChallenge,
  useResolveDispute,
  useFinalize,
  useClaim,
} from "@/lib/hooks/useTote";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Market } from "@/lib/contracts/types";

function shortAddr(hex: string): string {
  if (!hex) return "—";
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  return `0x${clean.slice(0, 4)}…${clean.slice(-4)}`;
}

function sameAddr(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}

function formatGen(wei: string): string {
  const n = Number(wei) / 1e18;
  if (!Number.isFinite(n)) return "0.000";
  return n.toFixed(3);
}

function genToWei(input: string): bigint {
  const trimmed = input.trim();
  if (!trimmed) return BigInt(0);
  const [intPartRaw, fracPartRaw = ""] = trimmed.split(".");
  const intPart = intPartRaw || "0";
  const fracPart = (fracPartRaw + "0".repeat(18)).slice(0, 18);
  if (!/^\d+$/.test(intPart) || !/^\d*$/.test(fracPart)) return BigInt(0);
  return BigInt(intPart) * BigInt(10) ** BigInt(18) + BigInt(fracPart || "0");
}

function formatDate(ts: string): string {
  const n = Number(ts);
  if (!n) return "—";
  return new Date(n * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function useNow(tickMs = 1000): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), tickMs);
    return () => clearInterval(id);
  }, [tickMs]);
  return now;
}

function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function splitPercent(m: Market): number {
  const yes = Number(m.total_yes_pool);
  const no = Number(m.total_no_pool);
  const total = yes + no;
  if (total === 0) return 50;
  return Math.round((yes / total) * 100);
}

function statusLabel(m: Market, now: number): string {
  switch (m.status) {
    case "open": {
      if (now < Number(m.lock_time)) return "Open for staking";
      if (now < Number(m.resolve_after)) return "Locked · Awaiting resolution window";
      return "Ready to resolve";
    }
    case "resolved": {
      const closes = Number(m.challenge_deadline);
      return now < closes ? `Resolved: ${m.outcome?.toUpperCase()} · Challenge window` : `Resolved: ${m.outcome?.toUpperCase()} · Ready to finalize`;
    }
    case "disputed": return "Disputed · Awaiting resolution";
    case "finalized": return `Finalized: ${m.outcome?.toUpperCase()}`;
    default: return m.status;
  }
}

function statusPillClass(status: string): string {
  if (status === "disputed") return "status-pill disputed";
  if (status === "finalized") return "status-pill finalized";
  return "status-pill";
}

function CreateMarketDialog() {
  const { address } = useWallet();
  const create = useCreateMarket();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ id: "", question: "", url: "", yesMarker: "", noMarker: "", lockTime: "", resolveAfter: "" });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = () => {
    if (!form.id || !form.question || !form.url || !form.yesMarker || !form.noMarker || !form.lockTime || !form.resolveAfter) return;
    const lockTs = Math.floor(new Date(form.lockTime).getTime() / 1000);
    const resolveTs = Math.floor(new Date(form.resolveAfter).getTime() / 1000);
    create.run(
      { id: form.id, question: form.question, url: form.url, yesMarker: form.yesMarker, noMarker: form.noMarker, lockTime: lockTs, resolveAfter: resolveTs },
      { onSuccess: () => { setOpen(false); setForm({ id: "", question: "", url: "", yesMarker: "", noMarker: "", lockTime: "", resolveAfter: "" }); } } as any
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="btn-tote primary" disabled={!address}>Open a Market</button>
      </DialogTrigger>
      <DialogContent className="!bg-card !border-border-hi sm:!max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display font-semibold">New Market</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3.5 mt-1">
          <div>
            <Label className="font-mono text-xs text-ink-faint">Market ID</Label>
            <Input value={form.id} onChange={set("id")} placeholder="tote-015" className="mt-1 font-mono" />
          </div>
          <div>
            <Label className="font-mono text-xs text-ink-faint">Question</Label>
            <Input value={form.question} onChange={set("question")} placeholder="Will BTC close above $90,000 on Sep 30?" className="mt-1" />
          </div>
          <div>
            <Label className="font-mono text-xs text-ink-faint">Verification URL</Label>
            <Input value={form.url} onChange={set("url")} placeholder="https://…" className="mt-1 font-mono" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="font-mono text-xs text-ink-faint">Yes marker</Label>
              <Input value={form.yesMarker} onChange={set("yesMarker")} placeholder="text proving YES" className="mt-1 font-mono" />
            </div>
            <div>
              <Label className="font-mono text-xs text-ink-faint">No marker</Label>
              <Input value={form.noMarker} onChange={set("noMarker")} placeholder="text proving NO" className="mt-1 font-mono" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="font-mono text-xs text-ink-faint">Staking closes</Label>
              <Input type="datetime-local" value={form.lockTime} onChange={set("lockTime")} className="mt-1 font-mono" />
            </div>
            <div>
              <Label className="font-mono text-xs text-ink-faint">Resolves after</Label>
              <Input type="datetime-local" value={form.resolveAfter} onChange={set("resolveAfter")} className="mt-1 font-mono" />
            </div>
          </div>
        </div>
        <DialogFooter className="mt-4">
          <button className="btn-tote primary block" onClick={handleSubmit} disabled={create.isPending}>
            {create.isPending ? "Opening…" : "Open Market"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StakeDialog({ marketId, side }: { marketId: string; side: "yes" | "no" }) {
  const stakeAction = useStake();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className={`btn-tote ${side}`}>Stake {side === "yes" ? "Yes" : "No"}</button>
      </DialogTrigger>
      <DialogContent className="!bg-card !border-border-hi sm:!max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-display font-semibold">Stake {side === "yes" ? "Yes" : "No"}</DialogTitle>
        </DialogHeader>
        <div className="mt-1">
          <Label className="font-mono text-xs text-ink-faint">Amount (GEN)</Label>
          <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1.0" className="mt-1 font-mono" />
        </div>
        <DialogFooter className="mt-4">
          <button
            className={`btn-tote ${side} block`}
            disabled={!amount || stakeAction.isPending}
            onClick={() => stakeAction.run({ id: marketId, side, amountWei: genToWei(amount) }, { onSuccess: () => { setOpen(false); setAmount(""); } } as any)}
          >
            {stakeAction.isPending ? "Staking…" : `Confirm Stake`}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChallengeDialog({ marketId }: { marketId: string }) {
  const challenge = useChallenge();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="btn-tote ghost danger">Challenge Outcome</button>
      </DialogTrigger>
      <DialogContent className="!bg-card !border-border-hi sm:!max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display font-semibold">Challenge This Outcome</DialogTitle>
        </DialogHeader>
        <div className="mt-1">
          <Label className="font-mono text-xs text-ink-faint">Why is the recorded outcome wrong?</Label>
          <textarea
            value={reason} onChange={(e) => setReason(e.target.value)}
            rows={4}
            className="mt-1 w-full px-3 py-2 text-sm bg-transparent border border-input rounded-lg outline-none focus-visible:border-ring"
            style={{ color: "var(--foreground)" }}
          />
        </div>
        <DialogFooter className="mt-4">
          <button
            className="btn-tote ghost danger block"
            disabled={!reason || challenge.isPending}
            onClick={() => challenge.run({ id: marketId, reason }, { onSuccess: () => { setOpen(false); setReason(""); } } as any)}
          >
            {challenge.isPending ? "Filing…" : "File Challenge"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MarketHero({ id }: { id: string }) {
  const { data: m, isLoading } = useMarket(id);
  const { address } = useWallet();
  const now = useNow();
  const resolveAction = useResolve();
  const resolveDisputeAction = useResolveDispute();
  const finalizeAction = useFinalize();
  const claimAction = useClaim();
  const { data: hasClaimed } = useHasClaimed(id, address);

  if (isLoading) {
    return <div className="p-8 text-center font-mono text-sm text-ink-faint">Loading market…</div>;
  }
  if (!m) {
    return <div className="p-8 text-center font-mono text-sm text-ink-faint">Market &quot;{id}&quot; not found.</div>;
  }

  const isCreator = sameAddr(address, m.creator);
  const yesPct = splitPercent(m);
  const lockTime = Number(m.lock_time);
  const resolveAfter = Number(m.resolve_after);
  const challengeDeadline = Number(m.challenge_deadline);
  const stakingOpen = m.status === "open" && now < lockTime;
  const readyToResolve = m.status === "open" && now >= resolveAfter && Number(m.total_yes_pool) > 0 && Number(m.total_no_pool) > 0;
  const challengeOpen = m.status === "resolved" && now < challengeDeadline;
  const readyToFinalize = m.status === "resolved" && now >= challengeDeadline;
  const canClaim = m.status === "finalized" && address && !hasClaimed;

  return (
    <div
      className="p-8 sm:p-9"
      style={{ background: "linear-gradient(180deg, var(--popover), var(--card))", border: "1px solid var(--border)", borderRadius: "20px", boxShadow: "0 20px 50px rgba(0,0,0,0.35)" }}
    >
      <div className="flex justify-between items-start gap-5 flex-wrap mb-6">
        <div>
          <div className="font-mono text-xs text-ink-faint">CREATED BY {shortAddr(m.creator)}</div>
          <h2 className="font-display font-medium mt-1.5 text-3xl max-w-[40ch]" style={{ textWrap: "balance" }}>{m.question}</h2>
        </div>
        <span className={statusPillClass(m.status)}><span className="dot" /> {statusLabel(m, now)}</span>
      </div>

      <div className="flex gap-10 flex-wrap my-6">
        <div className="flex-1 min-w-[200px]">
          <div className="font-ui font-bold text-xs tracking-wide uppercase mb-1.5" style={{ color: "var(--emerald-bright)" }}>Yes</div>
          <div className="font-display font-semibold text-4xl">{formatGen(m.total_yes_pool)}<span className="font-ui font-semibold text-base text-ink-faint ml-1.5">GEN</span></div>
          <div className="font-mono text-[0.68rem] text-ink-faint mt-2">{yesPct}% OF POOL</div>
        </div>
        <div className="flex-1 min-w-[200px]">
          <div className="font-ui font-bold text-xs tracking-wide uppercase mb-1.5" style={{ color: "var(--burgundy-bright)" }}>No</div>
          <div className="font-display font-semibold text-4xl">{formatGen(m.total_no_pool)}<span className="font-ui font-semibold text-base text-ink-faint ml-1.5">GEN</span></div>
          <div className="font-mono text-[0.68rem] text-ink-faint mt-2">{100 - yesPct}% OF POOL</div>
        </div>
      </div>

      <div className="split-bar my-5"><div className="fill" style={{ width: `${yesPct}%` }} /></div>

      <div className="grid grid-cols-1 sm:grid-cols-[1.2fr_1fr] gap-8 mt-1">
        <div>
          <div className="eyebrow mb-2">Resolution Criteria</div>
          <p className="field-note">
            Validators independently fetch <b>{m.verification_url}</b> and check which outcome the page confirms —
            a marker for <b style={{ color: "var(--emerald-bright)" }}>{m.yes_marker}</b> resolves Yes, a marker for{" "}
            <b style={{ color: "var(--burgundy-bright)" }}>{m.no_marker}</b> resolves No. Neither present yet reverts cleanly and can be retried.
            {m.dispute_reason && (<><br /><br /><span style={{ color: "var(--burgundy-bright)" }}>Dispute:</span> {m.dispute_reason}</>)}
            {m.resolution_note && (<><br /><br /><span style={{ color: "var(--emerald-bright)" }}>Resolution:</span> {m.resolution_note}</>)}
          </p>
        </div>
        <div>
          <div className="eyebrow mb-3">Timing</div>
          <div className="flex flex-col gap-3">
            {stakingOpen && <div className="kv-row"><span className="k">Staking closes</span><span className="v emerald tabular">T−{formatCountdown(lockTime - now)}</span></div>}
            <div className="kv-row"><span className="k">Resolves after</span><span className="v">{formatDate(m.resolve_after)}</span></div>
            {challengeOpen && <div className="kv-row"><span className="k">Challenge closes</span><span className="v emerald tabular">T−{formatCountdown(challengeDeadline - now)}</span></div>}
            <div className="kv-row"><span className="k">Total pool</span><span className="v emerald">{formatGen((BigInt(m.total_yes_pool) + BigInt(m.total_no_pool)).toString())} GEN</span></div>
          </div>
        </div>
      </div>

      <div className="flex gap-3 flex-wrap mt-7 pt-6" style={{ borderTop: "1px solid var(--border)" }}>
        {stakingOpen && !isCreator && (<><StakeDialog marketId={id} side="yes" /><StakeDialog marketId={id} side="no" /></>)}
        {stakingOpen && isCreator && <span className="font-mono text-xs self-center text-ink-faint">You created this market and can&apos;t stake on it.</span>}
        {readyToResolve && (
          <button className="btn-tote primary" disabled={resolveAction.isPending} onClick={() => resolveAction.run({ id })}>
            {resolveAction.isPending ? "Resolving…" : "Resolve Market"}
          </button>
        )}
        {challengeOpen && <ChallengeDialog marketId={id} />}
        {readyToFinalize && (
          <button className="btn-tote primary" disabled={finalizeAction.isPending} onClick={() => finalizeAction.run({ id })}>
            {finalizeAction.isPending ? "Finalizing…" : "Finalize Market"}
          </button>
        )}
        {m.status === "disputed" && (
          <button className="btn-tote ghost" disabled={resolveDisputeAction.isPending} onClick={() => resolveDisputeAction.run({ id })}>
            {resolveDisputeAction.isPending ? "Resolving…" : "Resolve Dispute"}
          </button>
        )}
        {canClaim && (
          <button className="btn-tote primary" disabled={claimAction.isPending} onClick={() => claimAction.run({ id })}>
            {claimAction.isPending ? "Claiming…" : "Claim Winnings"}
          </button>
        )}
        {!address && <span className="font-mono text-xs self-center text-ink-faint">Connect your wallet above to act on this market.</span>}
      </div>
    </div>
  );
}

function MarketRow({ id, m, onSelect, active }: { id: string; m: Market; onSelect: () => void; active: boolean }) {
  const yesPct = splitPercent(m);
  return (
    <button
      onClick={onSelect}
      className="w-full text-left grid gap-4 items-center py-4.5 px-2 rounded-xl"
      style={{ gridTemplateColumns: "74px 1fr auto auto", borderBottom: "1px solid var(--border)", background: active ? "var(--secondary)" : "transparent" }}
    >
      <div className="font-mono text-xs text-ink-faint">{id}</div>
      <div>
        <div className="font-ui font-semibold text-[0.92rem]">{m.question}</div>
        <div className="font-mono text-[0.66rem] text-ink-faint mt-1">
          {(Number(m.total_yes_pool) + Number(m.total_no_pool)) > 0 ? "staked" : "no stakes yet"}
        </div>
      </div>
      <div className="hidden sm:flex split-bar sm" style={{ width: 90 }}><div className="fill" style={{ width: `${yesPct}%` }} /></div>
      <div className="text-right font-ui font-bold text-[0.68rem] tracking-wide uppercase" style={{
        color: m.status === "disputed" ? "var(--burgundy-bright)" : m.status === "finalized" ? "var(--foreground)" : "var(--emerald-bright)",
      }}>
        {m.status}
      </div>
    </button>
  );
}

export default function HomePage() {
  const { data: list, isLoading } = useMarketList();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedId && list && list.length > 0) {
      setSelectedId(list[list.length - 1].id);
    }
  }, [list, selectedId]);

  const others = useMemo(() => (list ?? []).filter((r) => r.id !== selectedId).slice().reverse(), [list, selectedId]);

  return (
    <div className="max-w-[1040px] mx-auto px-5 pb-16 pt-7 overflow-x-hidden">
      <Navbar />

      <div className="flex justify-between items-end gap-4 flex-wrap mb-7">
        <div>
          <h1 className="font-display font-semibold text-3xl" style={{ textWrap: "balance" }}>
            {selectedId ? `Market ${selectedId}` : "No Markets Yet"}
          </h1>
          <div className="font-ui text-sm mt-2 max-w-[50ch] text-ink-faint">
            Every market settles on a fixed, checkable source — never on either side&apos;s word for it.
          </div>
        </div>
        <CreateMarketDialog />
      </div>

      <div className="mb-11">
        {isLoading && <div className="p-8 text-center font-mono text-sm text-ink-faint">Loading…</div>}
        {!isLoading && !selectedId && (
          <div className="p-10 flex flex-col items-center gap-3 text-center rounded-2xl" style={{ background: "var(--card)", border: "1px dashed var(--border-hi)" }}>
            <VesicaGlyph size={44} />
            <div className="font-mono text-sm text-ink-faint">No markets on this contract yet. Open the first one to see it here.</div>
          </div>
        )}
        {selectedId && <MarketHero id={selectedId} />}
      </div>

      {others.length > 0 && (
        <div>
          <div className="eyebrow mb-2">Markets</div>
          <div style={{ borderTop: "1px solid var(--border)" }}>
            {others.map(({ id, market }) => (
              <MarketRow key={id} id={id} m={market} active={id === selectedId} onSelect={() => setSelectedId(id)} />
            ))}
          </div>
        </div>
      )}

      <footer className="flex justify-between flex-wrap gap-2 mt-16 pt-6 font-ui text-sm text-ink-faint" style={{ borderTop: "1px solid var(--border)" }}>
        <div>Tote — every market settles on a fixed, checkable source. Anyone can re-fetch it and verify the board themselves.</div>
      </footer>
    </div>
  );
}
