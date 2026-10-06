import { cn } from "@/lib/cn";

/**
 * Net sold vs cap this window. The MM may net-sell at most `cap` base per window;
 * buybacks (vault bids filling) restore allowance net. Fill turns amber past 75%,
 * red past 90% — a real signal, not decoration.
 */
export function AllowanceGauge({
  netSold,
  cap,
  unit = "base",
  className,
}: {
  netSold: number;
  cap: number;
  unit?: string;
  className?: string;
}) {
  const pct = cap > 0 ? Math.min(100, (netSold / cap) * 100) : 0;
  const tone = pct >= 90 ? "fail" : pct >= 75 ? "warn" : "accent";
  const barColor =
    tone === "fail" ? "bg-fail" : tone === "warn" ? "bg-warn" : "bg-accent";

  const fmt = (n: number) =>
    n.toLocaleString("en-US", { maximumFractionDigits: n < 10 ? 2 : 0 });

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-baseline justify-between">
        <span className="num text-[16px] font-medium text-ink">
          {fmt(netSold)}
          <span className="text-ink-faint"> / {fmt(cap)}</span>
          <span className="ml-1 text-[12px] text-ink-faint">{unit}</span>
        </span>
        <span className={cn("num text-[13px]", tone === "accent" ? "text-ink-subtle" : `text-${tone}`)}>
          {pct.toFixed(1)}%
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-pill bg-surface-3">
        <div
          className={cn("h-full rounded-pill transition-[width] duration-500 ease-out", barColor)}
          style={{ width: `${Math.max(pct, 1.5)}%` }}
        />
      </div>
    </div>
  );
}
