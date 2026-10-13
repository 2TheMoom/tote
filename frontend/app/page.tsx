"use client";

import { useEffect, useMemo, useState } from "react";
import { Navbar } from "@/components/Navbar";
import { VesicaGlyph } from "@/components/VesicaGlyph";
import { useWallet } from "@/lib/genlayer/wallet";
import {
  useMarket,
  useMarketList,
  useMyPosition,
  useCreateMarket,
  useStake,
  useResolve,
  useChallenge,
  useResolveDispute,
  useFinalize,
  useClaim,
  useReclaimStake,
  useResolveStaleDispute,
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
import { availableActions, bondFor, challengeDeadline, challengeOpen as isChallengeOpen, disputeStaleAt, recoveryNote } from "@/lib/market-actions";
import { getTxExplorerUrl } from "@/lib/genlayer/chains";
import { MIN_STALE, MIN_WINDOW, markerProblem, normalizeLine, urlProblem } from "@/lib/limits";
import type { WriteProgress } from "@/lib/hooks/useTote";

const WINDOW_CHOICES = [
  { label: "1 hour", seconds: 3600 },
  { label: "6 hours", seconds: 6 * 3600 },
  { label: "24 hours", seconds: 86400 },
  { label: "3 days", seconds: 3 * 86400 },
  { label: "7 days", seconds: 7 * 86400 },
].filter((c) => c.seconds >= MIN_WINDOW);
const STALE_CHOICES = [
  { label: "2 hours", seconds: 7200 },
  { label: "12 hours", seconds: 12 * 3600 },
  { label: "24 hours", seconds: 86400 },
  { label: "3 days", seconds: 3 * 86400 },
  { label: "7 days", seconds: 7 * 86400 },
].filter((c) => c.seconds >= MIN_STALE);

function formatSpan(seconds: string): string {
  const n = Number(seconds);
  if (!n) return "—";
  if (n % 86400 === 0) return `${n / 86400} day${n === 86400 ? "" : "s"}`;
  if (n % 3600 === 0) return `${n / 3600} hour${n === 3600 ? "" : "s"}`;
  return `${Math.round(n / 60)} min`;
}

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
      return isChallengeOpen(m, now) ? `Resolved: ${m.outcome?.toUpperCase()} · Challenge window` : `Resolved: ${m.outcome?.toUpperCase()} · Ready to finalize`;
    }
    case "disputed": return "Disputed · Awaiting resolution";
    case "finalized": return `Finalized: ${m.outcome?.toUpperCase()}`;
    case "abandoned": return "Abandoned · Stakes returned to stakers";
    default: return m.status;
  }
}

function statusPillClass(status: string): string {
  if (status === "disputed") return "status-pill disputed";
  if (status === "finalized") return "status-pill finalized";
  return "status-pill";
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="font-mono text-xs text-ink-faint">{label}</Label>
      {children}
      {hint && <div className="font-mono text-[0.68rem] mt-1 text-ink-faint">{hint}</div>}
    </div>
  );
}

function SelectField({ id, value, onChange, choices }: { id: string; value: number; onChange: (n: number) => void; choices: { label: string; seconds: number }[] }) {
  return (
    <select
      id={id} value={value} onChange={(e) => onChange(Number(e.target.value))}
      className="mt-1 w-full h-9 px-2 text-sm bg-transparent border border-input rounded-lg outline-none focus-visible:border-ring font-mono"
      style={{ color: "var(--foreground)" }}
    >
      {choices.map((c) => <option key={c.seconds} value={c.seconds} style={{ background: "var(--card)" }}>{c.label}</option>)}
    </select>
  );
}

const STAGES: { key: WriteProgress["stage"]; label: string }[] = [
  { key: "signing", label: "Sign in wallet" },
  { key: "submitted", label: "Sent" },
  { key: "accepted", label: "Accepted by validators" },
  { key: "confirmed", label: "State confirmed" },
];

/** Shows how far a write has got. "Accepted" is not "done": done is the contract state read back, and money moves on finalization. */
function TxProgress({ progress, pending }: { progress: WriteProgress | null; pending: boolean }) {
  if (!progress) return null;
  const order = ["signing", "submitted", "accepted", "confirmed", "finalized"];
  const at = order.indexOf(progress.stage);
  return (
    <div className="mt-4 font-mono text-[0.7rem] text-ink-faint">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {STAGES.map((st) => {
          const i = order.indexOf(st.key);
          const done = at > i || (at === i && st.key === "confirmed");
          const current = at === i && !done;
          return (
            <span key={st.key} style={{ color: done ? "var(--emerald-bright)" : current && pending ? "var(--foreground)" : undefined }}>
              {done ? "✓" : current && pending ? "…" : "·"} {st.label}
            </span>
          );
        })}
        {progress.movesFunds && (
          <span style={{ color: progress.stage === "finalized" ? "var(--emerald-bright)" : "var(--foreground)" }}>
            {progress.stage === "finalized" ? "✓ Finalized, funds delivered" : "… Waiting for finality (funds move then, about 30 min)"}
          </span>
        )}
      </div>
      {progress.txHash && (
        <a className="break-all underline" style={{ color: "var(--emerald-bright)" }} href={getTxExplorerUrl(progress.txHash)} target="_blank" rel="noreferrer">
          {progress.txHash.slice(0, 14)}…
        </a>
      )}
    </div>
  );
}

function CreateMarketDialog() {
  const { address } = useWallet();
  const create = useCreateMarket();
  const [open, setOpen] = useState(false);
  const blank = { id: "", question: "", url: "", yesMarker: "", noMarker: "", lockTime: "", resolveAfter: "" };
  const [form, setForm] = useState(blank);
  const [windowSeconds, setWindowSeconds] = useState(WINDOW_CHOICES[0].seconds);
  const [staleSeconds, setStaleSeconds] = useState(STALE_CHOICES[0].seconds);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const problems = [
    form.url ? urlProblem(form.url) : null,
    form.yesMarker ? markerProblem(form.yesMarker, "Yes marker") : null,
    form.noMarker ? markerProblem(form.noMarker, "No marker") : null,
    form.yesMarker && form.noMarker && normalizeLine(form.yesMarker) === normalizeLine(form.noMarker) ? "The yes and no markers must differ." : null,
  ].filter(Boolean) as string[];
  const complete = !!(form.id && form.question && form.url && form.yesMarker && form.noMarker && form.lockTime && form.resolveAfter);

  const handleSubmit = () => {
    if (!complete || problems.length > 0) return;
    const lockTs = Math.floor(new Date(form.lockTime).getTime() / 1000);
    const resolveTs = Math.floor(new Date(form.resolveAfter).getTime() / 1000);
    create.run(
      {
        id: form.id, question: form.question, url: form.url, yesMarker: form.yesMarker, noMarker: form.noMarker,
        lockTime: lockTs, resolveAfter: resolveTs, challengeWindow: windowSeconds, staleAfter: staleSeconds,
      },
      { onSuccess: () => { setOpen(false); setForm(blank); } } as any
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="btn-tote primary" disabled={!address}>Open a Market</button>
      </DialogTrigger>
      <DialogContent className="!bg-card !border-border-hi sm:!max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display font-semibold">New Market</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3.5 mt-1">
          <Field label="Market ID">
            <Input id="tote-id" value={form.id} onChange={set("id")} placeholder="tote-015" className="mt-1 font-mono" />
          </Field>
          <Field label="Question" hint="Disputes judge against exactly this text.">
            <Input id="tote-question" value={form.question} onChange={set("question")} placeholder="Will BTC close above $90,000 on Sep 30?" className="mt-1" />
          </Field>
          <Field label="Verification URL" hint="A public https page everyone can see. Validators fetch it themselves.">
            <Input id="tote-url" value={form.url} onChange={set("url")} placeholder="https://…" className="mt-1 font-mono" />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Yes line (a whole line)">
              <Input id="tote-yes" value={form.yesMarker} onChange={set("yesMarker")} placeholder="BTC daily close was above 90000 USD" className="mt-1 font-mono" />
            </Field>
            <Field label="No line (a whole line)">
              <Input id="tote-no" value={form.noMarker} onChange={set("noMarker")} placeholder="BTC daily close was at or below 90000 USD" className="mt-1 font-mono" />
            </Field>
          </div>
          <div className="font-mono text-[0.68rem] text-ink-faint">
            Each must be an entire line of the page, not a phrase inside one. Negated, quoted or partial text never counts.
            If the page shows both lines, or neither, the market does not resolve. Include something specific such as a date or figure.
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Staking closes">
              <Input id="tote-lock" type="datetime-local" value={form.lockTime} onChange={set("lockTime")} className="mt-1 font-mono" />
            </Field>
            <Field label="Resolves after">
              <Input id="tote-resolve" type="datetime-local" value={form.resolveAfter} onChange={set("resolveAfter")} className="mt-1 font-mono" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Challenge Window" hint="Kept above Bradbury's ~30 min finality.">
              <SelectField id="tote-window" value={windowSeconds} onChange={setWindowSeconds} choices={WINDOW_CHOICES} />
            </Field>
            <Field label="Recover After" hint="How long a stuck market or dispute waits before recovery.">
              <SelectField id="tote-stale" value={staleSeconds} onChange={setStaleSeconds} choices={STALE_CHOICES} />
            </Field>
          </div>
          {problems.map((p) => (
            <div key={p} className="font-mono text-xs" style={{ color: "var(--burgundy-bright)" }}>{p}</div>
          ))}
        </div>
        <DialogFooter className="mt-4">
          <button className="btn-tote primary block" onClick={handleSubmit} disabled={create.isPending || !complete || problems.length > 0}>
            {create.isPending ? "Opening…" : "Open Market"}
          </button>
        </DialogFooter>
        <TxProgress progress={create.progress} pending={create.isPending} />
      </DialogContent>
    </Dialog>
  );
}

function StakeDialog({ marketId, side }: { marketId: string; side: "yes" | "no" }) {
  const stakeAction = useStake();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const wei = genToWei(amount);

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
          <Input id="tote-stake-amount" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1.0" className="mt-1 font-mono" />
        </div>
        <DialogFooter className="mt-4">
          <button
            className={`btn-tote ${side} block`}
            disabled={wei <= BigInt(0) || stakeAction.isPending}
            onClick={() => stakeAction.run({ id: marketId, side, amountWei: wei }, { onSuccess: () => { setOpen(false); setAmount(""); } } as any)}
          >
            {stakeAction.isPending ? "Staking…" : `Confirm Stake`}
          </button>
        </DialogFooter>
        <TxProgress progress={stakeAction.progress} pending={stakeAction.isPending} />
      </DialogContent>
    </Dialog>
  );
}

function ChallengeDialog({ market, marketId }: { market: Market; marketId: string }) {
  const challenge = useChallenge();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const bond = bondFor(market);
  const short = reason.length > 0 && reason.length < 20;

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
            id="tote-challenge-reason" value={reason} onChange={(e) => setReason(e.target.value)}
            rows={4}
            className="mt-1 w-full px-3 py-2 text-sm bg-transparent border border-input rounded-lg outline-none focus-visible:border-ring"
            style={{ color: "var(--foreground)" }}
          />
          {short && <div className="font-mono text-xs mt-1" style={{ color: "var(--burgundy-bright)" }}>At least 20 characters, so the reviewers have something to weigh.</div>}
          <div className="font-mono text-xs mt-3 text-ink-faint">
            Filing posts a bond of exactly <b style={{ color: "var(--emerald-bright)" }}>{formatGen(bond.toString())} GEN</b> (5% of all stakes).
            If the objection is upheld the outcome flips and your bond is returned. If it fails, the bond goes to the winners.
            If nobody can adjudicate it in time the recorded outcome stands and the bond goes to the winners too.
          </div>
        </div>
        <DialogFooter className="mt-4">
          <button
            className="btn-tote ghost danger block"
            disabled={reason.length < 20 || challenge.isPending}
            onClick={() => challenge.run({ id: marketId, reason, bondWei: bond }, { onSuccess: () => { setOpen(false); setReason(""); } } as any)}
          >
            {challenge.isPending ? "Filing…" : `File Challenge (bond ${formatGen(bond.toString())} GEN)`}
          </button>
        </DialogFooter>
        <TxProgress progress={challenge.progress} pending={challenge.isPending} />
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
  const staleDisputeAction = useResolveStaleDispute();
  const finalizeAction = useFinalize();
  const claimAction = useClaim();
  const reclaimAction = useReclaimStake();
  const { data: position } = useMyPosition(id, address ?? null);

  if (isLoading) {
    return <div className="p-8 text-center font-mono text-sm text-ink-faint">Loading market…</div>;
  }
  if (!m) {
    return <div className="p-8 text-center font-mono text-sm text-ink-faint">Market &quot;{id}&quot; not found.</div>;
  }

  const isCreator = sameAddr(address, m.creator);
  const yesPct = splitPercent(m);
  const lockTime = Number(m.lock_time);
  const deadline = challengeDeadline(m);
  const stakingOpen = m.status === "open" && now < lockTime;
  const challengeOpen = isChallengeOpen(m, now);
  const actions = availableActions(m, { address, now, position });
  const note = recoveryNote(m, now);
  const all = [resolveAction, resolveDisputeAction, staleDisputeAction, finalizeAction, claimAction, reclaimAction];
  const active = all.find((a) => a.progress);
  const staleAt = disputeStaleAt(m);

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
          <p className="field-note break-words">
            Validators independently fetch <b className="break-all">{m.verification_url}</b> and need exactly one of these as a whole line:{" "}
            <b style={{ color: "var(--emerald-bright)" }}>&quot;{m.yes_marker}&quot;</b> resolves Yes,{" "}
            <b style={{ color: "var(--burgundy-bright)" }}>&quot;{m.no_marker}&quot;</b> resolves No. A line that only contains,
            negates or quotes one does not count, and a page with both or neither does not resolve the market.
            {m.evidence_excerpt && (
              <>
                <br /><br />
                <span style={{ color: "var(--emerald-bright)" }}>Committed evidence:</span> &quot;{m.evidence_excerpt}&quot;
                <br />
                <span className="break-all text-ink-faint">sha256 {m.evidence_digest}</span>
                <br />A dispute is judged against this recorded excerpt and the page as it reads now, not the page alone.
              </>
            )}
            {m.dispute_reason && (<><br /><br /><span style={{ color: "var(--burgundy-bright)" }}>Dispute:</span> {m.dispute_reason}</>)}
            {m.resolution_note && (<><br /><br /><span style={{ color: "var(--emerald-bright)" }}>Resolution:</span> {m.resolution_note}</>)}
          </p>
        </div>
        <div>
          <div className="eyebrow mb-3">Timing</div>
          <div className="flex flex-col gap-3">
            {stakingOpen && <div className="kv-row"><span className="k">Staking closes</span><span className="v emerald tabular">T−{formatCountdown(lockTime - now)}</span></div>}
            <div className="kv-row"><span className="k">Resolves after</span><span className="v">{formatDate(m.resolve_after)}</span></div>
            <div className="kv-row"><span className="k">Challenge window</span><span className="v">{formatSpan(m.challenge_window)}</span></div>
            <div className="kv-row"><span className="k">Recover after</span><span className="v">{formatSpan(m.stale_after)}</span></div>
            {challengeOpen && <div className="kv-row"><span className="k">Challenge closes</span><span className="v emerald tabular">T−{formatCountdown(deadline - now)}</span></div>}
            {staleAt > 0 && now < staleAt && <div className="kv-row"><span className="k">Dispute recoverable</span><span className="v">{formatDate(String(staleAt))}</span></div>}
            <div className="kv-row"><span className="k">Total pool</span><span className="v emerald">{formatGen((BigInt(m.total_yes_pool) + BigInt(m.total_no_pool)).toString())} GEN</span></div>
            <div className="kv-row"><span className="k">Challenge bond</span><span className="v">{formatGen((Number(m.bond) > 0 ? BigInt(m.bond) : bondFor(m)).toString())} GEN</span></div>
          </div>
        </div>
      </div>

      <div className="flex gap-3 flex-wrap mt-7 pt-6" style={{ borderTop: "1px solid var(--border)" }}>
        {actions.includes("stake") && (<><StakeDialog marketId={id} side="yes" /><StakeDialog marketId={id} side="no" /></>)}
        {stakingOpen && isCreator && <span className="font-mono text-xs self-center text-ink-faint">You created this market and can&apos;t stake on it.</span>}
        {actions.includes("resolve") && (
          <button className="btn-tote primary" disabled={resolveAction.isPending} onClick={() => resolveAction.run({ id })}>
            {resolveAction.isPending ? "Resolving…" : "Resolve Market"}
          </button>
        )}
        {actions.includes("challenge") && <ChallengeDialog market={m} marketId={id} />}
        {actions.includes("finalize") && (
          <button className="btn-tote primary" disabled={finalizeAction.isPending} onClick={() => finalizeAction.run({ id })}>
            {finalizeAction.isPending ? "Finalizing…" : "Finalize Market"}
          </button>
        )}
        {actions.includes("resolve_dispute") && (
          <button className="btn-tote ghost" disabled={resolveDisputeAction.isPending} onClick={() => resolveDisputeAction.run({ id })}>
            {resolveDisputeAction.isPending ? "Resolving…" : "Resolve Dispute"}
          </button>
        )}
        {actions.includes("resolve_stale_dispute") && (
          <button className="btn-tote ghost danger" disabled={staleDisputeAction.isPending} onClick={() => staleDisputeAction.run({ id })}>
            {staleDisputeAction.isPending ? "Settling…" : "Settle Stuck Dispute"}
          </button>
        )}
        {actions.includes("claim") && (
          <button className="btn-tote primary" disabled={claimAction.isPending} onClick={() => claimAction.run({ id })}>
            {claimAction.isPending ? "Claiming…" : "Claim Winnings"}
          </button>
        )}
        {actions.includes("reclaim_yes") && (
          <button className="btn-tote ghost danger" disabled={reclaimAction.isPending} onClick={() => reclaimAction.run({ id, side: "yes" })}>
            {reclaimAction.isPending ? "Reclaiming…" : "Take Back Yes Stake"}
          </button>
        )}
        {actions.includes("reclaim_no") && (
          <button className="btn-tote ghost danger" disabled={reclaimAction.isPending} onClick={() => reclaimAction.run({ id, side: "no" })}>
            {reclaimAction.isPending ? "Reclaiming…" : "Take Back No Stake"}
          </button>
        )}
        {!address && <span className="font-mono text-xs self-center text-ink-faint">Connect your wallet above to act on this market.</span>}
      </div>

      {active && <TxProgress progress={active.progress} pending={active.isPending} />}

      {m.status === "disputed" && !note && (
        <div className="mt-4 font-mono text-xs text-ink-faint">
          Anyone can resolve this dispute. If the reviewers cannot reach a clear verdict nothing changes and it can be retried.
        </div>
      )}

      {note && (
        <div className="mt-4 flex items-start gap-2 font-mono text-xs" style={{ color: "var(--burgundy-bright)" }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--burgundy-bright)", marginTop: 5 }} />
          {note}
        </div>
      )}
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
