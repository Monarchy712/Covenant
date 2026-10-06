"use client";

import { useQuery } from "@tanstack/react-query";
import { CompassIcon } from "@phosphor-icons/react";
import { SiteNav } from "@/components/SiteNav";
import { MandateRow } from "@/components/MandateRow";
import { Panel } from "@/components/ui/Panel";
import { fetchAllMandates } from "@/lib/api";

export default function ExplorePage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["mandates", "all"],
    queryFn: () => fetchAllMandates(),
    staleTime: 20_000,
  });

  return (
    <div className="min-h-[100dvh] bg-canvas">
      <SiteNav />
      <main id="main" className="mx-auto w-full max-w-[1000px] px-5 py-10">
        <h1 className="text-[26px] font-semibold tracking-[-0.01em] text-ink">Explore mandates</h1>
        <p className="mt-1 text-[15px] text-ink-subtle">
          Every Covenant mandate on Monad testnet, with its state and live compliance. No wallet needed.
        </p>

        <div className="mt-7">
          {isLoading ? (
            <Panel className="overflow-hidden">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center justify-between border-b border-hairline px-4 py-4 last:border-0">
                  <span className="skeleton h-5 w-44 rounded-sm" />
                  <span className="skeleton h-2 w-32 rounded-pill" />
                </div>
              ))}
            </Panel>
          ) : isError || !data || data.length === 0 ? (
            <Panel className="flex flex-col items-center gap-3 px-6 py-14 text-center">
              <span className="flex size-11 items-center justify-center rounded-md border border-hairline bg-surface-2 text-accent">
                <CompassIcon size={22} aria-hidden />
              </span>
              <h2 className="text-[17px] font-medium text-ink">No mandates indexed yet</h2>
              <p className="max-w-[42ch] text-[15px] text-ink-subtle">Create one to see it appear here with its live compliance.</p>
            </Panel>
          ) : (
            <Panel className="overflow-hidden">
              {data.map((m) => (
                <MandateRow key={m.vault} item={m} href={`/proof/${m.vault}`} />
              ))}
            </Panel>
          )}
        </div>
      </main>
    </div>
  );
}
