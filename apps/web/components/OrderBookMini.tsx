import { cn } from "@/lib/cn";

export type BookLevel = {
  price: number;
  size: number;
  isVault?: boolean; // the vault's own resting order
};

/**
 * Compact order book: asks above, bids below, mid in the middle with the allowed
 * band shaded. The vault's own orders are marked (accent tick) so you can see
 * exactly which liquidity the mandate is responsible for.
 */
export function OrderBookMini({
  asks,
  bids,
  mid,
  bandBps,
  className,
}: {
  asks: BookLevel[];
  bids: BookLevel[];
  mid: number;
  bandBps: number;
  className?: string;
}) {
  const maxSize = Math.max(1, ...asks.map((a) => a.size), ...bids.map((b) => b.size));
  const bandLo = mid * (1 - bandBps / 10000);
  const bandHi = mid * (1 + bandBps / 10000);

  const row = (lvl: BookLevel, side: "ask" | "bid") => {
    const w = (lvl.size / maxSize) * 100;
    const inBand = lvl.price >= bandLo && lvl.price <= bandHi;
    return (
      <div
        key={`${side}-${lvl.price}`}
        className="relative grid grid-cols-[1fr_auto] items-center gap-2 px-3 py-[3px]"
      >
        <div
          className={cn(
            "absolute inset-y-0 right-0 opacity-[0.14]",
            side === "ask" ? "bg-fail" : "bg-pass",
          )}
          style={{ width: `${w}%` }}
          aria-hidden
        />
        <span
          className={cn(
            "num relative z-10 text-[13px]",
            side === "ask" ? "text-fail" : "text-pass",
            !inBand && "opacity-45",
          )}
        >
          {lvl.price.toFixed(3)}
          {lvl.isVault && (
            <span className="ml-1.5 inline-block size-1.5 translate-y-[-1px] rounded-pill bg-accent align-middle" />
          )}
        </span>
        <span className="num relative z-10 text-[13px] text-ink-subtle">{lvl.size.toFixed(0)}</span>
      </div>
    );
  };

  return (
    <div className={cn("relative font-mono", className)}>
      {/* band shading behind the mid */}
      <div className="flex flex-col-reverse">{asks.map((a) => row(a, "ask"))}</div>
      <div className="my-1 flex items-center gap-3 border-y border-hairline bg-surface-2 px-3 py-1.5">
        <span className="text-[11px] uppercase tracking-[0.14em] text-ink-faint">mid</span>
        <span className="num text-[14px] font-medium text-ink">{mid.toFixed(3)}</span>
        <span className="num ml-auto text-[12px] text-ink-faint">
          band ±{(bandBps / 100).toFixed(1)}%
        </span>
      </div>
      <div className="flex flex-col">{bids.map((b) => row(b, "bid"))}</div>
    </div>
  );
}
