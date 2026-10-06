"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  quote as quoteAction,
  cancel as cancelAction,
  claimFees,
  preflightQuote,
  MandateState,
  type PreflightResult,
} from "@covenant/shared";
import {
  CheckCircleIcon,
  ProhibitIcon,
  PaperPlaneRightIcon,
  ArrowsInLineHorizontalIcon,
  CrosshairIcon,
  ArrowsOutLineHorizontalIcon,
  CoinsIcon,
} from "@phosphor-icons/react";
import { SiteNav } from "@/components/SiteNav";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { Badge, StateBadge } from "@/components/ui/Badge";
import { Stat } from "@/components/ui/Stat";
import { Button } from "@/components/ui/Button";
import { TxProgress } from "@/components/TxProgress";
import { OrderBookMini } from "@/components/OrderBookMini";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { useCovenantTx } from "@/lib/useCovenantTx";
import { fetchSummary, fetchVaultBook } from "@/lib/api";
import { toBase, toQuote, fmtNum } from "@/lib/mandate";
import { truncateAddr } from "@/lib/format";
import { cn } from "@/lib/cn";

const PRICE_PRECISION = 100_000_000; // 1e8
const SIZE_PRECISION = 10_000_000_000; // 1e10
const toPriceU = (p: number) => BigInt(Math.round(p * PRICE_PRECISION));
const toSizeU = (s: number) => BigInt(Math.round(s * SIZE_PRECISION));

export default function MMConsole() {
  const params = useParams();
  const vault = (Array.isArray(params.id) ? params.id[0] : params.id) as `0x${string}`;
  const qc = useQueryClient();
  const { address, publicClient } = useWallet();
  const tx = useCovenantTx();

  const summaryQ = useQuery({ queryKey: ["summary", vault], queryFn: () => fetchSummary(vault), refetchInterval: 12_000, enabled: !!vault });
  const bookQ = useQuery({ queryKey: ["book", vault], queryFn: () => fetchVaultBook(vault), refetchInterval: 12_000, enabled: !!vault });

  const snap = summaryQ.data?.snapshot;
  const mid = bookQ.data?.mid ?? 2.0;
  const bandBps = snap ? Number(snap.terms.bandBps) : 200;
  const maxSpreadBps = snap ? Number(snap.terms.maxSpreadBps) : 100;
  const minDepth = snap ? toBase(snap.terms.minDepthPerSide) : 1;

  // quote ticket (human units)
  const [bidPrice, setBidPrice] = useState(1.99);
  const [bidSize, setBidSize] = useState(100);
  const [askPrice, setAskPrice] = useState(2.01);
  const [askSize, setAskSize] = useState(100);
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [checking, setChecking] = useState(false);

  // seed ticket from mid once loaded
  const seeded = useRef(false);
  useEffect(() => {
    if (!seeded.current && bookQ.data?.mid) {
      seeded.current = true;
      setBidPrice(+(mid * 0.997).toFixed(3));
      setAskPrice(+(mid * 1.003).toFixed(3));
    }
  }, [bookQ.data, mid]);

  const cancelIds = useMemo(() => (snap?.openOrders ?? []).map((o) => BigInt(o.id)), [snap]);

  // live preflight (debounced)
  useEffect(() => {
    if (!vault) return;
    let alive = true;
    setChecking(true);
    const t = setTimeout(async () => {
      try {
        const r = await preflightQuote(
          publicClient,
          vault,
          [toPriceU(bidPrice)],
          [toSizeU(bidSize)],
          [toPriceU(askPrice)],
          [toSizeU(askSize)],
          cancelIds,
        );
        if (alive) setPreflight(r);
      } catch {
        if (alive) setPreflight(null);
      } finally {
        if (alive) setChecking(false);
      }
    }, 400);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [vault, bidPrice, bidSize, askPrice, askSize, cancelIds, publicClient]);

  const invalidate = () => {
    for (const k of ["summary", "book"]) qc.invalidateQueries({ queryKey: [k, vault] });
  };

  const sendQuote = (sendAnyway: boolean) => {
    void tx.run(
      [
        {
          key: "quote",
          label: sendAnyway ? "Send the quote anyway" : "Place quote",
          sendAnyway,
          getAction: () =>
            quoteAction(vault, [toPriceU(bidPrice)], [toSizeU(bidSize)], [toPriceU(askPrice)], [toSizeU(askSize)], cancelIds),
        },
      ],
      { onSuccess: invalidate },
    );
  };

  // nudges
  const matchMid = () => {
    setBidPrice(+(mid * 0.999).toFixed(3));
    setAskPrice(+(mid * 1.001).toFixed(3));
  };
  const tighten = () => {
    setBidPrice(+((bidPrice + mid) / 2).toFixed(3));
    setAskPrice(+((askPrice + mid) / 2).toFixed(3));
  };
  const widen = () => {
    setBidPrice(+(mid * (1 - (bandBps / 10000) * 0.9)).toFixed(3));
    setAskPrice(+(mid * (1 + (bandBps / 10000) * 0.9)).toFixed(3));
  };

  // if a checkpoint ran now (from current resting orders)
  const kpi = useMemo(() => {
    const orders = snap?.openOrders ?? [];
    const bids = orders.filter((o) => o.isBid).map((o) => ({ p: Number(o.price) / PRICE_PRECISION, s: Number(o.remaining) / SIZE_PRECISION }));
    const asks = orders.filter((o) => !o.isBid).map((o) => ({ p: Number(o.price) / PRICE_PRECISION, s: Number(o.remaining) / SIZE_PRECISION }));
    const bestBid = bids.length ? Math.max(...bids.map((b) => b.p)) : null;
    const bestAsk = asks.length ? Math.min(...asks.map((a) => a.p)) : null;
    const twoSided = bestBid !== null && bestAsk !== null;
    const spreadBps = twoSided ? ((bestAsk - bestBid) / mid) * 10000 : Infinity;
    const minSide = Math.min(bids.reduce((a, b) => a + b.s, 0), asks.reduce((a, b) => a + b.s, 0));
    return {
      twoSided,
      spreadOk: spreadBps <= maxSpreadBps,
      spreadBps,
      depthOk: minSide >= minDepth,
      minSide,
      wouldPass: twoSided && spreadBps <= maxSpreadBps && minSide >= minDepth,
    };
  }, [snap, mid, maxSpreadBps, minDepth]);

  const accrued = snap ? toQuote(snap.accruedFees) : 0;
  const claimable = snap ? toQuote(snap.accruedFees) - toQuote(snap.claimedFees) : 0;
  const isMM = !!address && !!snap && address.toLowerCase() === snap.terms.mm.toLowerCase();
  const active = summaryQ.data?.state === MandateState.ACTIVE;

  const book = useMemo(() => {
    const b = bookQ.data;
    if (!b || b.mid === null || !b.orders.length) return null;
    const asks = b.orders.filter((o) => !o.isBid).map((o) => ({ price: o.price, size: o.size, isVault: true as const })).sort((a, b) => a.price - b.price).slice(0, 4);
    const bids = b.orders.filter((o) => o.isBid).map((o) => ({ price: o.price, size: o.size, isVault: true as const })).sort((a, b) => b.price - a.price).slice(0, 4);
    return { mid: b.mid, asks, bids };
  }, [bookQ.data]);

  const red = preflight && !preflight.ok;

  return (
    <div className="min-h-[100dvh] bg-canvas">
      <SiteNav />
      <main id="main" className="mx-auto w-full max-w-[1000px] px-5 py-8">
        <div className="flex flex-wrap items-center gap-3 border-b border-hairline pb-5">
          {summaryQ.data ? <StateBadge state={summaryQ.data.stateName} /> : <span className="skeleton h-6 w-20 rounded-pill" />}
          <span className="num text-[16px] text-ink">{truncateAddr(vault, 10, 8)}</span>
          <Badge tone="neutral">Market-maker console</Badge>
          {!isMM && address && <Badge tone="warn">You are not this mandate&rsquo;s MM (read-only)</Badge>}
        </div>

        <div className="mt-6 grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
          {/* quote ticket */}
          <div className="flex flex-col gap-5">
            <Panel>
              <PanelHeader
                title="Quote ticket"
                right={
                  <div className="flex gap-1.5">
                    <Nudge onClick={matchMid} icon={<CrosshairIcon size={13} aria-hidden />} label="Match mid" />
                    <Nudge onClick={tighten} icon={<ArrowsInLineHorizontalIcon size={13} aria-hidden />} label="Tighten" />
                    <Nudge onClick={widen} icon={<ArrowsOutLineHorizontalIcon size={13} aria-hidden />} label="Widen" />
                  </div>
                }
              />
              <div className="grid grid-cols-2 gap-4 p-4">
                <TicketSide tone="pass" label="Bid (buy)" price={bidPrice} size={bidSize} onPrice={setBidPrice} onSize={setBidSize} />
                <TicketSide tone="fail" label="Ask (sell)" price={askPrice} size={askSize} onPrice={setAskPrice} onSize={setAskSize} />
              </div>

              {/* preflight badge */}
              <div className="border-t border-hairline px-4 py-3">
                {checking ? (
                  <span className="text-[14px] text-ink-subtle">Checking against the contract…</span>
                ) : preflight?.ok ? (
                  <span className="inline-flex items-center gap-2 text-[14px] text-pass">
                    <CheckCircleIcon size={15} weight="fill" aria-hidden />
                    Preflight OK. This quote is inside every rail.
                  </span>
                ) : preflight ? (
                  <span className="inline-flex items-start gap-2 text-[14px] text-fail">
                    <ProhibitIcon size={15} weight="bold" className="mt-0.5 shrink-0" aria-hidden />
                    {preflight.message}
                  </span>
                ) : (
                  <span className="text-[14px] text-ink-subtle">Enter a quote to preflight it.</span>
                )}
              </div>

              <div className="flex flex-wrap gap-2 border-t border-hairline p-4">
                <Button onClick={() => sendQuote(false)} disabled={!isMM || !active || tx.state.status === "running" || !!red}>
                  <PaperPlaneRightIcon size={14} weight="bold" aria-hidden /> Place quote
                </Button>
                {red && (
                  <Button variant="danger" onClick={() => sendQuote(true)} disabled={!isMM || !active || tx.state.status === "running"}>
                    Send anyway
                  </Button>
                )}
                {!isMM && (
                  <span className="self-center text-[13px] text-ink-subtle">
                    Preflight is live for anyone; sending requires the MM wallet.
                  </span>
                )}
              </div>
            </Panel>

            {tx.state.status !== "idle" && <TxProgress state={tx.state} />}
          </div>

          {/* right: checkpoint + earnings + book */}
          <div className="flex flex-col gap-5">
            <Panel>
              <PanelHeader title="If a checkpoint ran now" right={<Badge tone={kpi.wouldPass ? "pass" : "fail"} dot>{kpi.wouldPass ? "PASS" : "FAIL"}</Badge>} />
              <div className="flex flex-col divide-y divide-hairline">
                <KpiRow label="Two-sided presence" ok={kpi.twoSided} detail={kpi.twoSided ? "bid + ask resting" : "missing a side"} />
                <KpiRow label="Spread" ok={kpi.spreadOk} detail={`${isFinite(kpi.spreadBps) ? (kpi.spreadBps / 100).toFixed(2) : "—"}% vs ${(maxSpreadBps / 100).toFixed(2)}% max`} />
                <KpiRow label="Depth per side" ok={kpi.depthOk} detail={`${fmtNum(kpi.minSide)} vs ${fmtNum(minDepth)} min base`} />
              </div>
            </Panel>

            <Panel>
              <PanelHeader title="Earnings" />
              <div className="grid grid-cols-2 gap-4 p-4">
                <Stat label="Accrued" value={fmtNum(accrued)} unit="USDC" tone="accent" />
                <Stat label="Claimable" value={fmtNum(claimable)} unit="USDC" tone="pass" />
              </div>
              <div className="border-t border-hairline p-4">
                <Button
                  variant="secondary"
                  onClick={() => tx.runAction(claimFees(vault), "Claim fees", { onSuccess: invalidate })}
                  disabled={!isMM || claimable <= 0 || tx.state.status === "running"}
                >
                  <CoinsIcon size={14} weight="bold" aria-hidden /> Claim fees
                </Button>
              </div>
            </Panel>

            {book && (
              <Panel className="overflow-hidden">
                <PanelHeader title="Your resting book" />
                <OrderBookMini asks={book.asks} bids={book.bids} mid={book.mid} bandBps={bandBps} className="py-1" />
              </Panel>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function TicketSide({ tone, label, price, size, onPrice, onSize }: { tone: "pass" | "fail"; label: string; price: number; size: number; onPrice: (n: number) => void; onSize: (n: number) => void }) {
  return (
    <div>
      <div className={cn("mb-2 text-[13px] font-medium", tone === "pass" ? "text-pass" : "text-fail")}>{label}</div>
      <label className="mb-1 block text-[12px] text-ink-subtle">Price</label>
      <input type="number" step="0.001" value={price} onChange={(e) => onPrice(Number(e.target.value))} className="mb-2 h-9 w-full rounded-sm border border-hairline bg-surface-2 px-3 text-[15px] text-ink outline-none focus:border-accent" />
      <label className="mb-1 block text-[12px] text-ink-subtle">Size (base)</label>
      <input type="number" step="1" value={size} onChange={(e) => onSize(Number(e.target.value))} className="h-9 w-full rounded-sm border border-hairline bg-surface-2 px-3 text-[15px] text-ink outline-none focus:border-accent" />
    </div>
  );
}
function Nudge({ onClick, icon, label }: { onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1 rounded-sm border border-hairline bg-surface-2 px-2 py-1 text-[12px] text-ink-subtle transition-colors hover:text-ink">
      {icon}
      {label}
    </button>
  );
}
function KpiRow({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <span className="flex items-center gap-2 text-[14px] text-ink">
        {ok ? <CheckCircleIcon size={15} weight="fill" className="text-pass" aria-hidden /> : <ProhibitIcon size={15} weight="bold" className="text-fail" aria-hidden />}
        {label}
      </span>
      <span className={cn("num text-[13px]", ok ? "text-ink-subtle" : "text-fail")}>{detail}</span>
    </div>
  );
}
