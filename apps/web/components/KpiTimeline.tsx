import { cn } from "@/lib/cn";

export type IntervalCell = {
  interval: number;
  /** paid=green · failed=red · unobserved=grey · paused=striped amber */
  status: "paid" | "failed" | "unobserved" | "paused";
  title?: string;
};

const cellColor: Record<IntervalCell["status"], string> = {
  paid: "bg-pass",
  failed: "bg-fail",
  unobserved: "bg-idle/45",
  paused: "cell-paused",
};

/**
 * Intervals as a dense row of cells. Green = fee paid, red = a failing observation
 * voided the fee, grey = unobserved (neutral), striped amber = paused (no scoring).
 * The honest, plainest representation of compliance history.
 */
export function KpiTimeline({
  cells,
  className,
}: {
  cells: IntervalCell[];
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap gap-[3px]", className)}>
      {cells.map((c) => (
        <span
          key={c.interval}
          title={c.title ?? `Interval ${c.interval}: ${c.status}`}
          className={cn(
            "h-4 w-[7px] rounded-[2px] transition-transform duration-150 hover:scale-y-125",
            cellColor[c.status],
          )}
        />
      ))}
    </div>
  );
}
