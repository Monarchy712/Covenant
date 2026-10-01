"use client";

import { useEffect, useRef, useState } from "react";
import { BuildingsIcon, VaultIcon, BookOpenIcon, UsersThreeIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";

/**
 * Issuer → Vault → Kuru book → Takers, with fees flowing to the MM.
 * A pulse travels the strip ONLY when `pulseKey` changes (a real SSE event).
 */
export function FlowStrip({ pulseKey, lastLabel }: { pulseKey: number; lastLabel?: string }) {
  const [pulsing, setPulsing] = useState(false);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setPulsing(true);
    const t = setTimeout(() => setPulsing(false), 1100);
    return () => clearTimeout(t);
  }, [pulseKey]);

  const nodes = [
    { icon: <BuildingsIcon size={18} aria-hidden />, label: "Issuer" },
    { icon: <VaultIcon size={18} aria-hidden />, label: "Vault" },
    { icon: <BookOpenIcon size={18} aria-hidden />, label: "Kuru book" },
    { icon: <UsersThreeIcon size={18} aria-hidden />, label: "Takers" },
  ];

  return (
    <div className="relative overflow-hidden rounded-md border border-hairline bg-surface-1 px-4 py-4">
      <div className="flex items-center justify-between gap-2">
        {nodes.map((n, i) => (
          <div key={n.label} className="flex flex-1 items-center gap-2">
            <div
              className={cn(
                "flex items-center gap-2 rounded-sm border border-hairline bg-surface-2 px-3 py-2",
                i === 1 && pulsing && "pulse-once border-accent-line",
              )}
            >
              <span className={cn("text-ink-subtle", i === 1 && pulsing && "text-accent")}>{n.icon}</span>
              <span className="whitespace-nowrap text-[12px] font-medium text-ink-muted">{n.label}</span>
            </div>
            {i < nodes.length - 1 && (
              <div className="relative h-px flex-1 bg-hairline">
                <span
                  className={cn(
                    "absolute top-1/2 size-1.5 -translate-y-1/2 rounded-pill bg-accent transition-all duration-700 ease-out",
                    pulsing ? "left-full opacity-100" : "left-0 opacity-0",
                  )}
                  aria-hidden
                />
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-2.5 flex items-center justify-between text-[11px] text-ink-subtle">
        <span>USDC proceeds return to the vault. Fees accrue to the market maker on passing intervals.</span>
        {pulsing && lastLabel && <span className="num text-accent">{lastLabel}</span>}
      </div>
    </div>
  );
}
