import { explorerTxUrl } from "@covenant/shared";
import type { EventRow } from "@/lib/api";
import { timeAgo } from "@/lib/api";
import { formatEvent } from "@/lib/events";
import { cn } from "@/lib/cn";
import { ArrowUpRightIcon } from "@phosphor-icons/react/dist/ssr";
import type { Tone } from "@/components/ui/Badge";

const dotColor: Record<Tone, string> = {
  accent: "bg-accent",
  pass: "bg-pass",
  fail: "bg-fail",
  warn: "bg-warn",
  idle: "bg-idle",
  neutral: "bg-ink-faint",
};

/** Recent on-chain events as human sentences, each linking to its tx on the explorer. */
export function EventFeed({ events, className }: { events: EventRow[]; className?: string }) {
  if (!events.length) {
    return (
      <div className={cn("flex flex-1 items-center justify-center p-6 text-center", className)}>
        <span className="text-[12px] text-ink-subtle">No indexed events yet.</span>
      </div>
    );
  }
  return (
    <ul className={cn("flex flex-col divide-y divide-hairline", className)}>
      {events.map((ev) => {
        const f = formatEvent(ev);
        return (
          <li key={`${ev.txHash}-${ev.logIndex}`}>
            <a
              href={explorerTxUrl(ev.txHash)}
              target="_blank"
              rel="noreferrer"
              className="group flex items-start gap-2.5 px-3 py-2.5 transition-colors hover:bg-surface-2"
            >
              <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-pill", dotColor[f.tone])} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-ink-muted">{f.text}</span>
                <span className="num text-[11px] text-ink-faint">{timeAgo(ev.ts)}</span>
              </span>
              <ArrowUpRightIcon
                size={13}
                aria-hidden
                className="mt-1 shrink-0 text-ink-faint transition-colors group-hover:text-accent"
              />
            </a>
          </li>
        );
      })}
    </ul>
  );
}
