"use client";

import { useEffect, useMemo, useState } from "react";
import { formatUnits } from "viem";
import { getOrderBook, type OrderBookView } from "@covenant/shared";
import type { CovenantConfig, ProofResponse } from "@/lib/api";
import { fetchProof, timeAgo } from "@/lib/api";
import { publicClient } from "@/lib/chainClient";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { Badge, StateBadge } from "@/components/ui/Badge";
import { Stat } from "@/components/ui/Stat";
import { AllowanceGauge } from "@/components/AllowanceGauge";
import { KpiTimeline, type IntervalCell } from "@/components/KpiTimeline";
import { OrderBookMini, type BookLevel } from "@/components/OrderBookMini";
import { PulseIcon } from "@phosphor-icons/react/dist/ssr";

const PRICE_PRECISION = 100_000_000n; // 1e8 (DEMO_MARKET)
const SIZE_PRECISION = 10_000_000_000n; // 1e10

export function FlagshipPanel({
  config,
  initialProof,
}: {
  config: CovenantConfig;
  initialProof: ProofResponse | null;
}) {
  const [proof, setProof] = useState<ProofResponse | null>(initialProof);
  const [book, setBook] = useState<OrderBookView | null>(null);
  const botsOn = config.flagship.botsOn;

  // Refresh the compliance record periodically (SSE is wired in M2).
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const p = await fetchProof(config.flagship.vault);
        if (alive) setProof(p);
      } catch {
        /* keep last good */
      }
    };
    const id = setInterval(tick, 20_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [config.flagship.vault]);

  // Best-effort on-chain book read (the flagship keeps a seeded resting book).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const client = publicClient(config.rpcUrl);
        const b = await getOrderBook(client, config.flagshipMarket, config.flagship.vault);
        if (alive) setBook(b);
      } catch {
        /* fall back to the idle note */
      }
    })();
  }, [config.rpcUrl, config.flagshipMarket, config.flagship.vault]);

  const cells: IntervalCell[] = useMemo(() => {
    const ivs = proof?.compliance.intervals ?? [];
    return ivs.map((iv) => ({
      interval: iv.interval,
      status: iv.paid ? "paid" : "failed",
      title: `Interval ${iv.interval}: ${iv.paid ? "fee paid (50 USDC)" : "no fee — a failing observation voided it"}`,
    }));
  }, [proof]);

  const cap = proof ? Number(formatUnits(BigInt(proof.cap), 18)) : 1000;
  const netSold = proof ? Number(formatUnits(BigInt(proof.netSoldInWindow), 18)) : 0;
  const accrued = proof ? Number(formatUnits(BigInt(proof.accruedFees), 6)) : 0;
  const bandBps = proof ? Number(proof.terms.bandBps) : 200;
  const paidIntervals = proof?.compliance.paidIntervals ?? 0;
  const observed = proof?.compliance.observed ?? 0;
  const passed = proof?.compliance.passed ?? 0;

  const bookLevels = useMemo(() => {
    if (!book || book.mid === null) return null;
    const mid = Number(formatUnits(book.mid, 18));
    const vaultOrders = book.vaultOrders.map((o) => ({
      price: Number(o.price) / Number(PRICE_PRECISION),
      size: Number(o.remaining) / Number(SIZE_PRECISION),
      isVault: true as const,
      isBid: o.isBid,
    }));
    const asks: BookLevel[] = vaultOrders.filter((o) => !o.isBid).slice(0, 4);
    const bids: BookLevel[] = vaultOrders.filter((o) => o.isBid).slice(0, 4);
    if (asks.length === 0 && bids.length === 0) return null;
    return { mid, asks, bids };
  }, [book]);

  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        title="Flagship mandate · live"
        hint={`${config.flagship.vault.slice(0, 6)}…${config.flagship.vault.slice(-4)} · Kuru`}
        right={
          botsOn ? (
            <Badge tone="pass" dot>
              <PulseIcon size={12} weight="bold" /> Bots live
            </Badge>
          ) : (
            <Badge tone="idle" dot>
              Idle · active {timeAgo(config.flagship.lastActiveTs)}
            </Badge>
          )
        }
      />

      <div className="grid gap-px bg-hairline sm:grid-cols-[1.15fr_1fr]">
        {/* left: record + allowance + fees */}
        <div className="flex flex-col gap-5 bg-surface-1 p-4" aria-live="polite">
          <div className="flex items-center gap-2">
            {proof ? <StateBadge state={proof.stateName} /> : <span className="skeleton h-5 w-16 rounded-pill" />}
            <span className="text-[12px] text-ink-subtle">30-day mandate · 10-min intervals</span>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <Stat label="Intervals paid" value={paidIntervals} tone="pass" />
            <Stat
              label="Compliance"
              value={observed ? `${passed}/${observed}` : "—"}
              tone={passed === observed ? "pass" : "warn"}
              sub="passed / observed"
            />
            <Stat label="Fees accrued" value={accrued.toLocaleString("en-US")} unit="USDC" tone="accent" />
          </div>

          <div>
            <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-subtle">
              Net sold this window
            </div>
            <AllowanceGauge netSold={netSold} cap={cap} />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-subtle">
                Compliance history
              </span>
              <span className="num text-[11px] text-ink-faint">{cells.length} intervals</span>
            </div>
            {cells.length ? (
              <KpiTimeline cells={cells} />
            ) : (
              <div className="skeleton h-4 w-full rounded-sm" />
            )}
          </div>
        </div>

        {/* right: resting book, or an honest idle note */}
        <div className="flex flex-col bg-surface-1">
          <div className="border-b border-hairline px-3 py-2 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-subtle">
            Resting book · vault orders marked
          </div>
          {bookLevels ? (
            <OrderBookMini
              asks={bookLevels.asks}
              bids={bookLevels.bids}
              mid={bookLevels.mid}
              bandBps={bandBps}
              className="py-2"
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-1.5 p-6 text-center">
              <span className="text-[13px] text-ink-muted">Book idle</span>
              <span className="text-[12px] text-ink-faint">
                {botsOn ? "Loading resting orders…" : `Last active ${timeAgo(config.flagship.lastActiveTs)}`}
              </span>
              <span className="mt-1 num text-[11px] text-ink-faint">band ±{(bandBps / 100).toFixed(1)}%</span>
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}
