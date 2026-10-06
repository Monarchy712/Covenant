"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { CaretRightIcon } from "@phosphor-icons/react";
import { fetchSummary, type MandateListItem } from "@/lib/api";
import { StateBadge, Badge } from "@/components/ui/Badge";
import { AllowanceGauge } from "@/components/AllowanceGauge";
import { truncateAddr } from "@/lib/format";
import { timeLeft, toBase, toQuote, fmtNum } from "@/lib/mandate";

/** One mandate as a dense row (issuer home / MM home / explore). */
export function MandateRow({ item, href }: { item: MandateListItem; href: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["summary", item.vault],
    queryFn: () => fetchSummary(item.vault),
    staleTime: 15_000,
  });

  const snap = data?.snapshot;
  const stateName = data?.stateName ?? "…";
  const cap = snap ? toBase(snap.terms.netSellCapPerWindow) : 0;
  const netSold = snap ? Math.max(0, toBase(snap.netSoldInWindow)) : 0;
  const accrued = snap ? toQuote(snap.accruedFees) : 0;
  const ended = stateName === "ENDED" || stateName === "SETTLED";

  return (
    <Link
      href={href}
      className="group grid grid-cols-[1fr_auto] items-center gap-4 border-b border-hairline px-4 py-3.5 transition-colors last:border-b-0 hover:bg-surface-2 sm:grid-cols-[1.4fr_1fr_1.1fr_0.9fr_auto]"
    >
      {/* identity */}
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {isLoading ? <span className="skeleton h-5 w-16 rounded-pill" /> : <StateBadge state={stateName} />}
          <span className="num truncate text-[14px] text-ink">{truncateAddr(item.vault, 8, 6)}</span>
        </div>
        <div className="mt-1 num text-[12px] text-ink-subtle">
          MM {truncateAddr(item.mm, 5, 4)} · Kuru
        </div>
      </div>

      {/* net sold */}
      <div className="hidden sm:block">
        <div className="mb-1 text-[11px] uppercase tracking-[0.12em] text-ink-subtle">Net sold</div>
        {snap ? (
          <AllowanceGauge netSold={netSold} cap={cap} />
        ) : (
          <div className="skeleton h-2 w-full rounded-pill" />
        )}
      </div>

      {/* fees */}
      <div className="hidden sm:block">
        <div className="mb-1 text-[11px] uppercase tracking-[0.12em] text-ink-subtle">Fees accrued</div>
        <div className="num text-[15px] text-ink">
          {fmtNum(accrued)} <span className="text-[12px] text-ink-subtle">USDC</span>
        </div>
      </div>

      {/* time / status */}
      <div className="hidden items-center sm:flex">
        {snap ? (
          ended ? (
            <Badge tone="idle">{stateName === "SETTLED" ? "settled" : "withdraw"}</Badge>
          ) : (
            <span className="num text-[14px] text-ink-muted">{timeLeft(snap.endsAt)}</span>
          )
        ) : (
          <span className="skeleton h-4 w-14 rounded-sm" />
        )}
      </div>

      <CaretRightIcon
        size={16}
        weight="bold"
        aria-hidden
        className="text-ink-faint transition-transform group-hover:translate-x-0.5"
      />
    </Link>
  );
}
