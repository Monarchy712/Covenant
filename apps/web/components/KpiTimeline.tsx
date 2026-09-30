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
  paused: "bg-warn",
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
            "h-4 w-[7px] rounded-[2px]",
            cellColor[c.status],
            c.status === "paused" &&
              "[background-image:repeating-linear-gradient(45deg,transparent,transparent_2px,rgba(0,0,0,0.35)_2px,rgba(0,0,0,0.35)_4px)]",
          )}
        />
      ))}
    </div>
  );
}
