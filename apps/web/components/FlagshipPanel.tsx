"use client";

import { useEffect, useMemo, useState } from "react";
import { formatUnits } from "viem";
import type { CovenantConfig, ProofResponse, EventRow, VaultBook } from "@/lib/api";
import { fetchProof, fetchEvents, fetchVaultBook, timeAgo } from "@/lib/api";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { Badge, StateBadge } from "@/components/ui/Badge";
import { Stat } from "@/components/ui/Stat";
import { AllowanceGauge } from "@/components/AllowanceGauge";
import { KpiTimeline, type IntervalCell } from "@/components/KpiTimeline";
import { OrderBookMini, type BookLevel } from "@/components/OrderBookMini";
import { EventFeed } from "@/components/EventFeed";
import { PulseIcon } from "@phosphor-icons/react/dist/ssr";

export function FlagshipPanel({
  config,
  initialProof,
  initialEvents = [],
  initialBook = null,
}: {
  config: CovenantConfig;
  initialProof: ProofResponse | null;
  initialEvents?: EventRow[];
  initialBook?: VaultBook | null;
}) {
  const [proof, setProof] = useState<ProofResponse | null>(initialProof);
  const [events, setEvents] = useState<EventRow[]>(initialEvents);
  const [book, setBook] = useState<VaultBook | null>(initialBook);
  const botsOn = config.flagship.botsOn;

  // Refresh record + event feed + book periodically, all via the API (reliable,
  // CORS-enabled) rather than a browser RPC read. SSE is wired in M2.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const [p, e, b] = await Promise.all([
          fetchProof(config.flagship.vault),
          fetchEvents(config.flagship.vault, 6),
          fetchVaultBook(config.flagship.vault),
        ]);
        if (alive) {
          setProof(p);
          setEvents(e);
          setBook(b);
        }
      } catch {
        /* keep last good */
      }
    };
    void tick(); // fill immediately on mount, don't wait for the first interval
    const id = setInterval(tick, 20_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [config.flagship.vault]);

  const cells: IntervalCell[] = useMemo(() => {
    const ivs = proof?.compliance.intervals ?? [];
    return ivs.map((iv) => ({
      interval: iv.interval,
      status: iv.paid ? "paid" : "failed",
      title: `Interval ${iv.interval}: ${iv.paid ? "fee paid (50 USDC)" : "no fee, a failing observation voided it"}`,
    }));
  }, [proof]);

  const cap = proof ? Number(formatUnits(BigInt(proof.cap), 18)) : 1000;
  const netSold = proof ? Number(formatUnits(BigInt(proof.netSoldInWindow), 18)) : 0;
  const accrued = proof ? Number(formatUnits(BigInt(proof.accruedFees), 6)) : 0;
  const bandBps = proof ? Number(proof.terms.bandBps) : 200;
  const finalized = proof?.compliance.intervals.length ?? 0;
  const paidIntervals = proof?.compliance.paidIntervals ?? 0;
  const observed = proof?.compliance.observed ?? 0;
  const passed = proof?.compliance.passed ?? 0;
  const failed = Math.max(0, observed - passed);

  const bookLevels = useMemo(() => {
    if (!book || book.mid === null || book.orders.length === 0) return null;
    const asks: BookLevel[] = book.orders
      .filter((o) => !o.isBid)
      .map((o) => ({ price: o.price, size: o.size, isVault: true as const }))
      .sort((a, b) => a.price - b.price)
      .slice(0, 3);
    const bids: BookLevel[] = book.orders
      .filter((o) => o.isBid)
      .map((o) => ({ price: o.price, size: o.size, isVault: true as const }))
      .sort((a, b) => b.price - a.price)
      .slice(0, 3);
    if (asks.length === 0 && bids.length === 0) return null;
    return { mid: book.mid, asks, bids };
  }, [book]);

  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        title={botsOn ? "Flagship mandate · live" : "Flagship mandate · on-chain"}
        hint={`${config.flagship.vault.slice(0, 6)}…${config.flagship.vault.slice(-4)} · Kuru`}
        right={
          botsOn ? (
            <Badge tone="pass" dot>
              <PulseIcon size={12} weight="bold" aria-hidden /> Live
            </Badge>
          ) : (
            <Badge tone="idle" dot>
              Idle · active {timeAgo(config.flagship.lastActiveTs)}
            </Badge>
          )
        }
      />

      <div className="grid gap-px bg-hairline lg:grid-cols-[1.25fr_0.95fr]">
        {/* main: record + allowance + history + book */}
        <div className="flex flex-col gap-5 bg-surface-1 p-4" aria-live="polite">
          <div className="flex flex-wrap items-center gap-2">
            {proof ? <StateBadge state={proof.stateName} /> : <span className="skeleton h-5 w-16 rounded-pill" />}
            <span className="text-[13px] text-ink-subtle">30-day mandate · 10-min intervals</span>
          </div>

          <div>
            <div className="grid grid-cols-2 gap-5">
              <Stat
                label="Intervals paid"
                value={proof ? `${paidIntervals}/${finalized}` : "—"}
                tone="pass"
              />
              <Stat
                label="Fees accrued"
                value={proof ? accrued.toLocaleString("en-US") : "—"}
                unit="USDC"
                tone="accent"
                className="pr-1"
              />
            </div>
            {proof && (
              <p className="mt-2.5 text-[13px] leading-snug text-ink-subtle">
                {observed} checkpoints observed, {failed} failed. 50 USDC per passing interval.
              </p>
            )}
          </div>

          <div>
            <div className="mb-2 text-[12px] font-medium uppercase tracking-[0.12em] text-ink-subtle">
              Net sold this window
            </div>
            <AllowanceGauge netSold={netSold} cap={cap} />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[12px] font-medium uppercase tracking-[0.12em] text-ink-subtle">
                Compliance history
              </span>
              <span className="num text-[12px] text-ink-subtle">{cells.length} intervals</span>
            </div>
            {cells.length ? <KpiTimeline cells={cells} /> : <div className="skeleton h-4 w-full rounded-sm" />}
          </div>

          {/* Resting book: shown only when the vault actually has resting orders. */}
          {bookLevels && (
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[12px] font-medium uppercase tracking-[0.12em] text-ink-subtle">
                  Resting book · vault orders marked
                </span>
                <span className="num text-[12px] text-ink-subtle">
                  band ±{(bandBps / 100).toFixed(1)}%
                </span>
              </div>
              <div className="overflow-hidden rounded-sm border border-hairline">
                <OrderBookMini
                  asks={bookLevels.asks}
                  bids={bookLevels.bids}
                  mid={bookLevels.mid}
                  bandBps={bandBps}
                  className="py-1"
                />
              </div>
            </div>
          )}
        </div>

        {/* side: recent on-chain events with tx links */}
        <div className="flex flex-col bg-surface-1">
          <div className="border-b border-hairline px-3 py-2 text-[12px] font-medium uppercase tracking-[0.12em] text-ink-subtle">
            Recent on-chain events
          </div>
          <EventFeed events={events} />
          <a
            href={`https://testnet.monadexplorer.com/address/${config.flagship.vault}`}
            target="_blank"
            rel="noreferrer"
            className="mt-auto border-t border-hairline px-3 py-2.5 text-[13px] text-ink-subtle transition-colors hover:text-accent"
          >
            View all on the explorer
          </a>
        </div>
      </div>
    </Panel>
  );
}
