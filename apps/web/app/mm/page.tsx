"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChartBarIcon, WalletIcon } from "@phosphor-icons/react";
import { SiteNav } from "@/components/SiteNav";
import { MandateRow } from "@/components/MandateRow";
import { Panel } from "@/components/ui/Panel";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { fetchMandatesByMM } from "@/lib/api";

export default function MMHome() {
  const { address, ready } = useWallet();
  const { data, isLoading } = useQuery({
    queryKey: ["mandates", "mm", address],
    queryFn: () => fetchMandatesByMM(address!),
    enabled: !!address,
    staleTime: 15_000,
  });

  return (
    <div className="min-h-[100dvh] bg-canvas">
      <SiteNav />
      <main id="main" className="mx-auto w-full max-w-[1000px] px-5 py-10">
        <h1 className="text-[26px] font-semibold tracking-[-0.01em] text-ink">Market-maker desk</h1>
        <p className="mt-1 text-[15px] text-ink-subtle">Invitations and active mandates where you make the market.</p>

        <div className="mt-7">
          {!ready || isLoading ? (
            <Panel className="overflow-hidden">
              {[0, 1].map((i) => (
                <div key={i} className="flex items-center justify-between border-b border-hairline px-4 py-4 last:border-0">
                  <span className="skeleton h-5 w-40 rounded-sm" />
                  <span className="skeleton h-2 w-32 rounded-pill" />
                </div>
              ))}
            </Panel>
          ) : !address ? (
            <Panel className="flex flex-col items-center gap-4 px-6 py-14 text-center">
              <span className="flex size-11 items-center justify-center rounded-md border border-hairline bg-surface-2 text-ink-subtle">
                <WalletIcon size={22} aria-hidden />
              </span>
              <div>
                <h2 className="text-[18px] font-medium text-ink">Connect to see your mandates</h2>
                <p className="mx-auto mt-1.5 max-w-[42ch] text-[15px] text-ink-subtle">
                  Connect a wallet or a demo wallet to review invitations and manage active mandates.
                </p>
              </div>
              <Link href="/start?role=mm" className="inline-flex items-center gap-2 rounded-sm bg-accent-btn px-4 py-2 text-[15px] font-medium text-accent-ink hover:bg-accent-btn-hover">
                Get started as a market maker
              </Link>
            </Panel>
          ) : !data || data.length === 0 ? (
            <Panel className="flex flex-col items-center gap-4 px-6 py-14 text-center">
              <span className="flex size-11 items-center justify-center rounded-md border border-hairline bg-surface-2 text-accent">
                <ChartBarIcon size={22} aria-hidden />
              </span>
              <div>
                <h2 className="text-[18px] font-medium text-ink">No invitations yet</h2>
                <p className="mx-auto mt-1.5 max-w-[46ch] text-[15px] text-ink-subtle">
                  When an issuer invites your address to make a market, it shows up here to review and accept.
                </p>
              </div>
            </Panel>
          ) : (
            <Panel className="overflow-hidden">
              {data.map((m) => (
                <MandateRow key={m.vault} item={m} href={`/invite/${m.vault}`} />
              ))}
            </Panel>
          )}
        </div>
      </main>
    </div>
  );
}
