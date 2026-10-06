"use client";

import { useCallback, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatUnits } from "viem";
import {
  pause,
  unpause,
  terminate,
  cancelAllAfterEnd,
  withdraw,
  claimFees,
  explorerAddressUrl,
  MandateState,
} from "@covenant/shared";
import {
  ShieldCheckIcon,
  PauseIcon,
  PlayIcon,
  StopCircleIcon,
  DownloadSimpleIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { SiteNav } from "@/components/SiteNav";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { Badge, StateBadge } from "@/components/ui/Badge";
import { Stat } from "@/components/ui/Stat";
import { AllowanceGauge } from "@/components/AllowanceGauge";
import { KpiTimeline, type IntervalCell } from "@/components/KpiTimeline";
import { OrderBookMini } from "@/components/OrderBookMini";
import { EventFeed } from "@/components/EventFeed";
import { FlowStrip } from "@/components/FlowStrip";
import { TxProgress } from "@/components/TxProgress";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { useCovenantTx } from "@/lib/useCovenantTx";
import { useSSE } from "@/lib/hooks/useSSE";
import { fetchSummary, fetchProof, fetchEvents, fetchVaultBook } from "@/lib/api";
import { truncateAddr } from "@/lib/format";
import { timeLeft, toBase, toQuote, fmtNum } from "@/lib/mandate";

const SOURCIFY_IMPL = "https://repo.sourcify.dev/contracts/full_match/10143/0x987922C61bD2941D593ED145A4D894f62838b18d/";
const REFRESH = 15_000;

export default function MandateDashboard() {
  const params = useParams();
  const vault = (Array.isArray(params.id) ? params.id[0] : params.id) as `0x${string}`;
  const qc = useQueryClient();
  const { address } = useWallet();
  const tx = useCovenantTx();

  const [pulseKey, setPulseKey] = useState(0);
  const [lastLabel, setLastLabel] = useState<string>();
  const [confirmTerminate, setConfirmTerminate] = useState(false);

  const summaryQ = useQuery({ queryKey: ["summary", vault], queryFn: () => fetchSummary(vault), refetchInterval: REFRESH, enabled: !!vault });
  const proofQ = useQuery({ queryKey: ["proof", vault], queryFn: () => fetchProof(vault), refetchInterval: REFRESH, enabled: !!vault });
  const eventsQ = useQuery({ queryKey: ["events", vault], queryFn: () => fetchEvents(vault, 12), refetchInterval: REFRESH, enabled: !!vault });
  const bookQ = useQuery({ queryKey: ["book", vault], queryFn: () => fetchVaultBook(vault), refetchInterval: REFRESH, enabled: !!vault });

  useSSE(vault, useCallback((ev) => {
    setPulseKey((k) => k + 1);
    setLastLabel(ev.name ?? ev.type);
    for (const k of ["summary", "proof", "events", "book"]) qc.invalidateQueries({ queryKey: [k, vault] });
  }, [qc, vault]));

  const snap = summaryQ.data?.snapshot;
  const stateName = summaryQ.data?.stateName ?? "…";
  const state = summaryQ.data?.state ?? -1;
  const isIssuer = !!address && !!snap && address.toLowerCase() === snap.terms.issuer.toLowerCase();
  const openOrders = snap?.openOrders?.length ?? 0;

  const cells: IntervalCell[] = useMemo(() => {
    const ivs = proofQ.data?.compliance.intervals ?? [];
    return ivs.map((iv) => ({
      interval: iv.interval,
      status: iv.paid ? "paid" : "failed",
      title: `Interval ${iv.interval}: ${iv.paid ? `paid ${fmtNum(Number(iv.amount) / 1e6)} USDC` : "no fee (a failing observation voided it)"} · block ${iv.finalizedBlock}`,
    }));
  }, [proofQ.data]);

  const book = useMemo(() => {
    const b = bookQ.data;
    if (!b || b.mid === null || b.orders.length === 0) return null;
    const asks = b.orders.filter((o) => !o.isBid).map((o) => ({ price: o.price, size: o.size, isVault: true as const })).sort((a, b) => a.price - b.price);
    const bids = b.orders.filter((o) => o.isBid).map((o) => ({ price: o.price, size: o.size, isVault: true as const })).sort((a, b) => b.price - a.price);
    const bestAsk = asks[0]?.price;
    const bestBid = bids[0]?.price;
    const spread = bestAsk && bestBid ? (((bestAsk - bestBid) / b.mid) * 100).toFixed(2) : null;
    return { mid: b.mid, asks: asks.slice(0, 4), bids: bids.slice(0, 4), spread };
  }, [bookQ.data]);

  const bandBps = snap ? Number(snap.terms.bandBps) : 200;
  const cap = snap ? toBase(snap.terms.netSellCapPerWindow) : 0;
  const netSold = snap ? Math.max(0, toBase(snap.netSoldInWindow)) : 0;
  const windowH = snap ? Number(snap.terms.windowLength) / 3600 : 1;
  const feeEscrow = snap ? toQuote(snap.feeEscrow) : 0;
  const accrued = snap ? toQuote(snap.accruedFees) : 0;
  const claimed = snap ? toQuote(snap.claimedFees) : 0;
  const frozen = !!snap?.currentFailed;
  const ended = state === MandateState.ENDED || state === MandateState.SETTLED;
  const settled = state === MandateState.SETTLED;

  // Pre-withdraw snapshot captured at the moment the issuer clicks Withdraw — the only source that
  // is correct IMMEDIATELY (before the indexer records the Withdrawn events), so the receipt shows
  // real returned amounts instead of the post-withdraw zeros.
  const [preWithdraw, setPreWithdraw] = useState<{
    baseMargin: number;
    quoteMargin: number;
    unusedEscrow: number;
    netSold: number;
  } | null>(null);

  // Fallback for an already-SETTLED mandate loaded fresh: reconstruct the returned amounts from the
  // Withdrawn(token, amount) events (always recent, so in the feed once the indexer is at head).
  const fromEvents = useMemo(() => {
    const baseTok = snap?.terms.baseToken?.toLowerCase();
    let returnedBase = 0;
    let returnedQuote = 0;
    let has = false;
    for (const e of eventsQ.data ?? []) {
      if (e.name !== "Withdrawn") continue;
      try {
        const a = JSON.parse(e.args) as { token: string; amount: string };
        has = true;
        if (a.token?.toLowerCase() === baseTok) returnedBase += Number(a.amount) / 1e18;
        else returnedQuote += Number(a.amount) / 1e6;
      } catch {
        /* skip */
      }
    }
    return has ? { returnedBase, returnedQuote } : null;
  }, [eventsQ.data, snap]);

  // Returned-to-issuer figures for the receipt (prefer the instant pre-withdraw capture).
  const returnedBase = preWithdraw?.baseMargin ?? fromEvents?.returnedBase ?? null;
  const returnedQuote =
    preWithdraw != null ? preWithdraw.quoteMargin + preWithdraw.unusedEscrow : (fromEvents?.returnedQuote ?? null);

  // Real net-sold: live value while ACTIVE/ENDED is accurate; once SETTLED (inventory withdrawn)
  // soldBase == depositedCumulative (an artifact), so show deposited − returned instead.
  const displayNetSold = settled
    ? preWithdraw?.netSold ??
      (returnedBase != null && snap ? Math.max(0, toBase(snap.soldBase) - returnedBase) : null)
    : netSold;

  const invalidate = () => {
    for (const k of ["summary", "proof", "events", "book"]) qc.invalidateQueries({ queryKey: [k, vault] });
  };

  const doTerminate = () => {
    setConfirmTerminate(false);
    void tx.run(
      [
        { key: "terminate", label: "Terminate the mandate", getAction: () => terminate(vault) },
        { key: "cancel", label: "Cancel all resting orders", getAction: () => cancelAllAfterEnd(vault) },
      ],
      { onSuccess: invalidate },
    );
  };

  if (summaryQ.isError) {
    return (
      <Shell>
        <Panel className="mx-auto mt-16 max-w-md p-8 text-center">
          <h1 className="text-[18px] font-medium text-ink">Mandate not found</h1>
          <p className="mt-2 text-[15px] text-ink-subtle">
            No vault at {truncateAddr(vault, 8, 6)} on this indexer yet.
          </p>
        </Panel>
      </Shell>
    );
  }

  return (
    <Shell>
      {/* status bar */}
      <div className="flex flex-col gap-4 border-b border-hairline pb-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          {summaryQ.isLoading ? <span className="skeleton h-6 w-20 rounded-pill" /> : <StateBadge state={stateName} />}
          <span className="num text-[16px] text-ink">{truncateAddr(vault, 10, 8)}</span>
          <a href={SOURCIFY_IMPL} target="_blank" rel="noreferrer">
            <Badge tone="accent" className="hover:brightness-110">
              <ShieldCheckIcon size={12} weight="bold" aria-hidden /> Enforced by contract
            </Badge>
          </a>
          {snap && !ended && <span className="num text-[14px] text-ink-subtle">{timeLeft(snap.endsAt)}</span>}
          {snap && (
            <a href={explorerAddressUrl(snap.terms.mm)} target="_blank" rel="noreferrer" className="num text-[13px] text-ink-subtle hover:text-accent">
              MM {truncateAddr(snap.terms.mm, 5, 4)}
            </a>
          )}
        </div>
        {isIssuer && !ended && (
          <div className="flex items-center gap-2">
            {state === MandateState.PAUSED ? (
              <Button variant="secondary" size="sm" onClick={() => tx.runAction(unpause(vault), "Unpause", { onSuccess: invalidate })}>
                <PlayIcon size={14} weight="bold" aria-hidden /> Unpause
              </Button>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => tx.runAction(pause(vault), "Pause", { onSuccess: invalidate })}>
                <PauseIcon size={14} weight="bold" aria-hidden /> Pause
              </Button>
            )}
            <Button variant="danger" size="sm" onClick={() => setConfirmTerminate(true)}>
              <StopCircleIcon size={14} weight="bold" aria-hidden /> Terminate
            </Button>
          </div>
        )}
        {isIssuer && ended && state === MandateState.ENDED && (
          <Button
            variant="primary"
            size="sm"
            disabled={openOrders > 0}
            onClick={() => {
              if (snap)
                setPreWithdraw({
                  baseMargin: toBase(snap.baseMargin),
                  quoteMargin: toQuote(snap.quoteMargin),
                  unusedEscrow: Math.max(0, feeEscrow - (accrued - claimed)),
                  netSold,
                });
              tx.runAction(withdraw(vault), "Withdraw", { onSuccess: invalidate });
            }}
          >
            <DownloadSimpleIcon size={14} weight="bold" aria-hidden />
            {openOrders > 0 ? `Cancel ${openOrders} orders first` : "Withdraw & settle"}
          </Button>
        )}
      </div>

      {/* live tx progress (controls) */}
      {tx.state.status !== "idle" && <TxProgress state={tx.state} className="mt-5" />}

      {/* flow strip */}
      <div className="mt-6">
        <FlowStrip pulseKey={pulseKey} lastLabel={lastLabel} />
      </div>

      {/* main grid */}
      <div className="mt-6 grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        {/* left: book + allowance */}
        <div className="flex flex-col gap-5">
          <Panel className="overflow-hidden">
            <PanelHeader
              title="Order book · vault orders marked"
              right={book?.spread ? <span className="num text-[13px] text-ink-subtle">spread {book.spread}%</span> : undefined}
            />
            {book ? (
              <OrderBookMini asks={book.asks} bids={book.bids} mid={book.mid} bandBps={bandBps} className="py-2" />
            ) : (
              <div className="p-6 text-center text-[14px] text-ink-subtle">
                {bookQ.isLoading ? "Loading book…" : "No resting orders right now."}
              </div>
            )}
          </Panel>

          <Panel>
            <PanelHeader title={settled ? "Net sold (final)" : `Net sold this window (${windowH}h)`} />
            <div className="flex flex-col gap-3 p-4">
              {!snap ? (
                <div className="skeleton h-2 w-full rounded-pill" />
              ) : settled ? (
                displayNetSold != null ? (
                  <>
                    <span className="num text-[20px] font-medium text-ink">
                      {fmtNum(displayNetSold)}
                      <span className="ml-1 text-[13px] text-ink-subtle">/ {fmtNum(cap)} base</span>
                    </span>
                    <p className="text-[13px] leading-relaxed text-ink-subtle">
                      Final net base sold over the mandate. Inventory has been returned to the issuer.
                    </p>
                  </>
                ) : (
                  <p className="text-[14px] text-ink-subtle">Settled — inventory returned to the issuer.</p>
                )
              ) : (
                <>
                  <AllowanceGauge netSold={displayNetSold ?? netSold} cap={cap} />
                  <p className="text-[13px] leading-relaxed text-ink-subtle">
                    The cap is on <span className="text-ink-muted">net</span> selling. Buybacks through the vault&rsquo;s
                    bids restore allowance. Resets every {windowH}h.
                  </p>
                </>
              )}
            </div>
          </Panel>
        </div>

        {/* right: KPI + fees */}
        <div className="flex flex-col gap-5">
          <Panel>
            <PanelHeader
              title="KPI timeline"
              hint="green paid · red failed · grey unobserved · striped paused"
              right={<span className="num text-[13px] text-ink-subtle">{cells.length} intervals</span>}
            />
            <div className="p-4">
              {cells.length ? <KpiTimeline cells={cells} /> : <div className="text-[14px] text-ink-subtle">No finalized intervals yet.</div>}
            </div>
          </Panel>

          <Panel>
            <PanelHeader
              title="Fees"
              right={frozen ? <Badge tone="fail" dot>Frozen this interval</Badge> : undefined}
            />
            <div className="grid grid-cols-3 gap-4 p-4">
              <Stat label="Escrow" value={fmtNum(feeEscrow)} unit="USDC" />
              <Stat label="Accrued" value={fmtNum(accrued)} unit="USDC" tone="accent" />
              <Stat label="Claimed" value={fmtNum(claimed)} unit="USDC" tone="pass" />
            </div>
            {frozen && (
              <p className="flex items-center gap-1.5 border-t border-hairline px-4 py-2.5 text-[13px] text-fail">
                <WarningIcon size={13} weight="fill" aria-hidden />
                A failing observation this interval has frozen the fee. It resumes next passing interval.
              </p>
            )}
          </Panel>
        </div>
      </div>

      {/* settlement receipt */}
      {ended && snap && (
        <SettlementReceipt
          returnedBase={returnedBase}
          returnedQuote={returnedQuote}
          accrued={accrued}
          claimed={claimed}
          paid={proofQ.data?.compliance.paidIntervals ?? 0}
          settled={settled}
        />
      )}

      {/* activity */}
      <Panel className="mt-6 overflow-hidden">
        <PanelHeader title="Activity" hint="live, each with a tx link" />
        <EventFeed events={eventsQ.data ?? []} />
      </Panel>

      <ConfirmDialog
        open={confirmTerminate}
        title="Terminate this mandate?"
        body="Terminating moves the mandate to ENDED and then cancels all of the vault's open orders on Kuru (two transactions). This cannot be undone. After settlement you can withdraw your inventory, proceeds, and unused fee escrow."
        confirmLabel="Terminate & cancel orders"
        tone="danger"
        onConfirm={doTerminate}
        onCancel={() => setConfirmTerminate(false)}
      />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-canvas">
      <SiteNav />
      <main id="main" className="mx-auto w-full max-w-[1100px] px-5 py-8">
        {children}
      </main>
    </div>
  );
}

function SettlementReceipt({
  returnedBase,
  returnedQuote,
  accrued,
  claimed,
  paid,
  settled,
}: {
  returnedBase: number | null;
  returnedQuote: number | null;
  accrued: number;
  claimed: number;
  paid: number;
  settled: boolean;
}) {
  const haveReturns = returnedBase != null && returnedQuote != null;
  return (
    <Panel className="mt-6">
      <PanelHeader title="Settlement receipt" hint={settled ? "SETTLED" : "withdraw to settle"} />
      <div className="grid gap-4 p-5 sm:grid-cols-4">
        <Stat
          label="Returned to issuer"
          value={haveReturns ? fmtNum(returnedBase!) : "—"}
          unit="base"
          tone="pass"
          sub={haveReturns ? `+ ${fmtNum(returnedQuote!)} USDC (proceeds + unused escrow)` : undefined}
        />
        <Stat label="Intervals paid" value={paid} tone="pass" />
        <Stat label="MM earned" value={fmtNum(accrued)} unit="USDC" tone="accent" />
        <Stat label="MM claimed" value={fmtNum(claimed)} unit="USDC" />
      </div>
      <p className="border-t border-hairline px-5 py-3 text-[13px] text-ink-subtle">
        {settled
          ? "Inventory, proceeds, and unused fee escrow were returned to the issuer on withdraw. The MM kept only fees earned on passing intervals."
          : "On withdraw, your inventory, proceeds, and unused fee escrow return to you. The MM keeps only fees earned on passing intervals."}
      </p>
    </Panel>
  );
}
