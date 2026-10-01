"use client";

import { useCallback, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { checkpoint, explorerAddressUrl } from "@covenant/shared";
import {
  ShieldCheckIcon,
  ArrowSquareOutIcon,
  CopyIcon,
  CheckIcon,
} from "@phosphor-icons/react";
import { SiteNav } from "@/components/SiteNav";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { Badge, StateBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { AllowanceGauge } from "@/components/AllowanceGauge";
import { KpiTimeline, type IntervalCell } from "@/components/KpiTimeline";
import { EventFeed } from "@/components/EventFeed";
import { TradePanel } from "@/components/TradePanel";
import { TxProgress } from "@/components/TxProgress";
import { useCovenantTx } from "@/lib/useCovenantTx";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { useSSE } from "@/lib/hooks/useSSE";
import { fetchProof, fetchSummary, fetchVaultBook, fetchEvents } from "@/lib/api";
import { toBase, toQuote, fmtNum } from "@/lib/mandate";
import { truncateAddr } from "@/lib/format";

export default function ProofPage() {
  const params = useParams();
  const vault = (Array.isArray(params.id) ? params.id[0] : params.id) as `0x${string}`;
  const qc = useQueryClient();
  const [copied, setCopied] = useState(false);

  const proofQ = useQuery({ queryKey: ["proof", vault], queryFn: () => fetchProof(vault), refetchInterval: 15_000, enabled: !!vault });
  const summaryQ = useQuery({ queryKey: ["summary", vault], queryFn: () => fetchSummary(vault), refetchInterval: 15_000, enabled: !!vault });
  const eventsQ = useQuery({ queryKey: ["events", vault], queryFn: () => fetchEvents(vault, 8), refetchInterval: 15_000, enabled: !!vault });

  useSSE(vault, useCallback(() => {
    for (const k of ["proof", "summary", "events", "book"]) qc.invalidateQueries({ queryKey: [k, vault] });
  }, [qc, vault]));

  const proof = proofQ.data;
  const snap = summaryQ.data?.snapshot;
  const cells: IntervalCell[] = useMemo(
    () => (proof?.compliance.intervals ?? []).map((iv) => ({ interval: iv.interval, status: iv.paid ? "paid" : "failed", title: `Interval ${iv.interval}: ${iv.paid ? "paid" : "no fee"} · block ${iv.finalizedBlock}` })),
    [proof],
  );

  const cap = proof ? toBase(proof.cap) : 0;
  const netSold = proof ? Math.max(0, toBase(proof.netSoldInWindow)) : 0;
  const accrued = proof ? toQuote(proof.accruedFees) : 0;
  const band = proof ? Number(proof.terms.bandBps) / 100 : 0;
  const fee = proof ? toQuote(proof.terms.feePerInterval) : 0;
  const paid = proof?.compliance.paidIntervals ?? 0;
  const total = proof?.compliance.intervals.length ?? 0;
  const verifyUrl = explorerAddressUrl(vault);

  const shareUrl = typeof window !== "undefined" ? window.location.href : "";
  const embed = typeof window !== "undefined" ? `<a href="${window.location.origin}/proof/${vault}"><img src="${window.location.origin}/badge/${vault}" alt="Enforced by Covenant" height="44"/></a>` : "";

  return (
    <div className="min-h-[100dvh] bg-canvas">
      <SiteNav />
      <main id="main" className="mx-auto w-full max-w-[920px] px-5 py-8">
        {/* header */}
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="pass">
            <ShieldCheckIcon size={12} weight="bold" aria-hidden /> Enforced by Covenant
          </Badge>
          {proof && <StateBadge state={proof.stateName} />}
          <a href={verifyUrl} target="_blank" rel="noreferrer" className="num inline-flex items-center gap-1 text-[13px] text-ink-subtle hover:text-accent">
            {truncateAddr(vault, 10, 8)}
            <ArrowSquareOutIcon size={13} aria-hidden />
          </a>
        </div>
        <h1 className="mt-4 text-[24px] font-semibold tracking-[-0.01em] text-ink lg:text-[28px]">
          A market-making mandate, verifiable by anyone
        </h1>
        <p className="mt-2 max-w-[62ch] text-[14px] leading-relaxed text-ink-muted">
          Every figure below is read live from the contract on Monad. No wallet needed. Click any
          value to verify it on the explorer.
        </p>

        {/* key numbers */}
        <div className="mt-6 grid gap-px overflow-hidden rounded-md border border-hairline bg-hairline sm:grid-cols-2 lg:grid-cols-4">
          <VerifyStat label="Intervals paid" value={total ? `${paid}/${total}` : "—"} tone="pass" href={verifyUrl} />
          <VerifyStat label="Net sold this window" value={`${fmtNum(netSold)}/${fmtNum(cap)}`} href={verifyUrl} />
          <VerifyStat label="Price band" value={`±${band}%`} href={verifyUrl} />
          <VerifyStat label="Fee / interval" value={fmtNum(fee)} unit="USDC" tone="accent" href={verifyUrl} />
        </div>

        <div className="mt-6 grid gap-5 lg:grid-cols-[1.3fr_0.7fr]">
          <div className="flex flex-col gap-5">
            <Panel>
              <PanelHeader title="Net sold vs cap" />
              <div className="p-4">
                {proof ? <AllowanceGauge netSold={netSold} cap={cap} /> : <div className="skeleton h-2 w-full rounded-pill" />}
              </div>
            </Panel>
            <Panel>
              <PanelHeader title="Compliance history" hint="green paid · red failed" right={<span className="num text-[12px] text-ink-subtle">{cells.length} intervals</span>} />
              <div className="p-4">
                {cells.length ? <KpiTimeline cells={cells} /> : <div className="text-[13px] text-ink-subtle">No finalized intervals yet.</div>}
              </div>
            </Panel>
            <Panel className="overflow-hidden">
              <PanelHeader title="Recent activity" />
              <EventFeed events={eventsQ.data ?? []} />
            </Panel>
          </div>

          <div className="flex flex-col gap-5">
            {snap ? (
              <TradePanel
                market={snap.terms.market}
                base={snap.terms.baseToken}
                quote={snap.terms.quoteToken}
                onFill={() => qc.invalidateQueries({ queryKey: ["proof", vault] })}
              />
            ) : null}

            <Panel>
              <PanelHeader title="Embeddable badge" />
              <div className="flex flex-col gap-3 p-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/badge/${vault}`} alt="Enforced by Covenant" height={44} className="rounded-sm" />
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(embed);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1400);
                  }}
                  className="inline-flex items-center justify-center gap-2 rounded-sm border border-hairline bg-surface-2 px-3 py-2 text-[13px] text-ink hover:border-hairline-strong"
                >
                  {copied ? <CheckIcon size={14} className="text-pass" aria-hidden /> : <CopyIcon size={14} aria-hidden />}
                  {copied ? "Embed code copied" : "Copy embed code"}
                </button>
                <button
                  onClick={() => navigator.clipboard.writeText(shareUrl)}
                  className="inline-flex items-center justify-center gap-2 rounded-sm px-3 py-2 text-[13px] text-accent hover:text-accent-hover"
                >
                  Copy share link
                </button>
              </div>
            </Panel>

            <Panel>
              <PanelHeader title="Checkpoint it yourself" />
              <div className="p-4">
                <p className="mb-3 text-[12px] leading-relaxed text-ink-subtle">
                  Checkpoints are permissionless. Anyone can force the chain to score the market
                  maker right now (needs a wallet with a little MON).
                </p>
                <CheckpointButton vault={vault} />
              </div>
            </Panel>
          </div>
        </div>
      </main>
    </div>
  );
}

function VerifyStat({ label, value, unit, tone, href }: { label: string; value: string; unit?: string; tone?: "pass" | "accent"; href: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="group flex flex-col gap-1.5 bg-surface-1 p-4 transition-colors hover:bg-surface-2">
      <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-subtle">{label}</span>
      <span className={cnTone(tone)}>
        {value}
        {unit && <span className="ml-1 text-[12px] text-ink-subtle">{unit}</span>}
      </span>
      <span className="inline-flex items-center gap-1 text-[11px] text-ink-faint group-hover:text-accent">
        verify <ArrowSquareOutIcon size={11} aria-hidden />
      </span>
    </a>
  );
}
function cnTone(tone?: "pass" | "accent") {
  const base = "num text-[20px] font-medium leading-none ";
  return base + (tone === "pass" ? "text-pass" : tone === "accent" ? "text-accent" : "text-ink");
}

function CheckpointButton({ vault }: { vault: `0x${string}` }) {
  const tx = useCovenantTx();
  const { address } = useWallet();
  return (
    <>
      <Button variant="secondary" disabled={!address || tx.state.status === "running"} onClick={() => tx.runAction(checkpoint(vault), "Checkpoint now")}>
        Checkpoint now
      </Button>
      {tx.state.status !== "idle" && <TxProgress state={tx.state} className="mt-3" />}
    </>
  );
}
