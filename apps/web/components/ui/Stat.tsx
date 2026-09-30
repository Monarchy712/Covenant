import { cn } from "@/lib/cn";
import type { Tone } from "./Badge";

const valueTone: Record<Tone, string> = {
  accent: "text-accent",
  pass: "text-pass",
  fail: "text-fail",
  warn: "text-warn",
  idle: "text-idle",
  neutral: "text-ink",
};

/** A labelled numeric readout. Numbers are always tabular/mono (.num). */
export function Stat({
  label,
  value,
  unit,
  sub,
  tone = "neutral",
  className,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  sub?: React.ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-subtle">
        {label}
      </span>
      <span className={cn("num text-[19px] font-medium leading-none", valueTone[tone])}>
        {value}
        {unit && <span className="ml-1 text-[12px] text-ink-faint">{unit}</span>}
      </span>
      {sub && <span className="text-[12px] text-ink-faint">{sub}</span>}
    </div>
  );
}
