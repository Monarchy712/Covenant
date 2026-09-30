import { cn } from "@/lib/cn";

export type Tone = "accent" | "pass" | "fail" | "warn" | "idle" | "neutral";

const toneClasses: Record<Tone, string> = {
  accent: "text-accent bg-accent-soft border-accent-line",
  pass: "text-pass bg-pass-soft border-pass-line",
  fail: "text-fail bg-fail-soft border-fail-line",
  warn: "text-warn bg-warn-soft border-warn-line",
  idle: "text-idle bg-idle-soft border-idle-line",
  neutral: "text-ink-muted bg-surface-2 border-hairline",
};

/** Small pill chip. Dot optional; use a dot only when it conveys real state. */
export function Badge({
  tone = "neutral",
  dot = false,
  className,
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-0.5 text-[12px] font-medium leading-none",
        toneClasses[tone],
        className,
      )}
    >
      {dot && <span className="size-1.5 rounded-pill bg-current" />}
      {children}
    </span>
  );
}

/** Mandate lifecycle → tone + label. Encodes the semantic color contract. */
const STATE_TONE: Record<string, Tone> = {
  CREATED: "neutral",
  ACCEPTED: "accent",
  ACTIVE: "pass",
  PAUSED: "warn",
  ENDED: "idle",
  SETTLED: "idle",
};

export function StateBadge({ state, className }: { state: string; className?: string }) {
  const tone = STATE_TONE[state] ?? "neutral";
  return (
    <Badge tone={tone} dot className={cn("uppercase tracking-wide", className)}>
      {state}
    </Badge>
  );
}
