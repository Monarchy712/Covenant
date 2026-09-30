"use client";

import {
  CheckCircleIcon,
  CircleNotchIcon,
  CircleIcon,
  XCircleIcon,
  ArrowUpRightIcon,
  ProhibitIcon,
} from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import type { TxRunState, TxStep } from "@/lib/useCovenantTx";

const ACTIVE: TxStep["status"][] = ["approving", "signing", "confirming"];

function StepIcon({ status }: { status: TxStep["status"] }) {
  if (status === "done") return <CheckCircleIcon size={18} weight="fill" className="text-pass" aria-hidden />;
  if (status === "error") return <XCircleIcon size={18} weight="fill" className="text-fail" aria-hidden />;
  if (ACTIVE.includes(status))
    return <CircleNotchIcon size={18} weight="bold" className="animate-spin text-accent" aria-hidden />;
  return <CircleIcon size={18} weight="regular" className="text-ink-faint" aria-hidden />;
}

function statusText(s: TxStep): string | null {
  switch (s.status) {
    case "signing":
      return "Awaiting signature";
    case "confirming":
      return "Confirming on Monad";
    case "done":
      return s.latencyMs ? `Confirmed in ${(s.latencyMs / 1000).toFixed(1)}s` : "Confirmed";
    default:
      return null;
  }
}

/** The shared transaction experience: a checklist with live per-step status,
 *  confirmation latency (the "why Monad" moment), explorer links, and a decoded
 *  "Blocked by contract" card on failure. */
export function TxProgress({ state, className }: { state: TxRunState; className?: string }) {
  if (state.status === "idle" || state.steps.length === 0) return null;

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <ol className="flex flex-col divide-y divide-hairline overflow-hidden rounded-md border border-hairline bg-surface-1">
        {state.steps.map((s) => {
          const detail = statusText(s);
          return (
            <li key={s.key} className="flex items-center gap-3 px-3.5 py-2.5">
              <StepIcon status={s.status} />
              <span
                className={cn(
                  "flex-1 text-[14px]",
                  s.status === "done" && "text-ink",
                  s.status === "error" && "text-fail",
                  s.status === "pending" && "text-ink-subtle",
                  ACTIVE.includes(s.status) && "text-ink",
                )}
              >
                {s.label}
              </span>
              {detail && (
                <span
                  className={cn(
                    "num text-[12px]",
                    s.status === "done" ? "text-pass" : "text-ink-subtle",
                  )}
                >
                  {detail}
                </span>
              )}
              {s.explorerUrl && (s.status === "done" || s.status === "error") && (
                <a
                  href={s.explorerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-ink-faint transition-colors hover:text-accent"
                  aria-label="View transaction on explorer"
                >
                  <ArrowUpRightIcon size={13} weight="bold" aria-hidden />
                </a>
              )}
            </li>
          );
        })}
      </ol>

      {state.status === "error" && state.error && (
        <div className="overflow-hidden rounded-md border border-fail-line bg-fail-soft/40">
          <div className="flex items-center gap-2 border-b border-fail-line px-4 py-2.5">
            <ProhibitIcon size={15} weight="bold" className="text-fail" aria-hidden />
            <span className="text-[12px] font-semibold uppercase tracking-[0.12em] text-fail">
              {state.error.name === "SellAllowanceExceeded" ||
              state.error.name === "OutsideBand" ||
              state.error.name === "TooManyOpenOrders"
                ? "Blocked by contract"
                : "Transaction failed"}
            </span>
            {state.error.name && (
              <span className="num ml-auto text-[11px] text-ink-subtle">{state.error.name}</span>
            )}
          </div>
          <div className="flex flex-col gap-2 p-4">
            <p className="text-[14px] leading-relaxed text-ink-muted">{state.error.message}</p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
              {state.error.latencyMs && (
                <span className="num text-ink-subtle">
                  Reverted in {(state.error.latencyMs / 1000).toFixed(1)}s
                </span>
              )}
              {state.error.explorerUrl && (
                <a
                  href={state.error.explorerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-accent transition-colors hover:text-accent-hover"
                >
                  View the reverted tx
                  <ArrowUpRightIcon size={12} weight="bold" aria-hidden />
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
