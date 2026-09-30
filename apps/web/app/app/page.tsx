"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { PlusIcon, StackIcon, WalletIcon } from "@phosphor-icons/react";
import { SiteNav } from "@/components/SiteNav";
import { MandateRow } from "@/components/MandateRow";
import { Panel } from "@/components/ui/Panel";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { fetchMandates } from "@/lib/api";

export default function IssuerHome() {
  const { address, ready } = useWallet();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["mandates", "issuer", address],
    queryFn: () => fetchMandates(address ?? undefined),
    enabled: !!address,
    staleTime: 15_000,
  });

  return (
    <div className="min-h-[100dvh] bg-canvas">
      <SiteNav />
      <main id="main" className="mx-auto w-full max-w-[1000px] px-5 py-10">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-[24px] font-semibold tracking-[-0.01em] text-ink">My mandates</h1>
            <p className="mt-1 text-[14px] text-ink-subtle">
              Market-making mandates you have created, with live compliance.
            </p>
          </div>
          <Link
            href="/create"
            className="inline-flex items-center gap-2 rounded-sm bg-accent px-4 py-2 text-[14px] font-medium text-accent-ink transition-colors hover:bg-accent-hover"
          >
            <PlusIcon size={16} weight="bold" aria-hidden />
            Create mandate
          </Link>
        </div>

        <div className="mt-7">
          {!ready ? (
            <SkeletonList />
          ) : !address ? (
            <ConnectPrompt />
          ) : isLoading ? (
            <SkeletonList />
          ) : isError ? (
            <ErrorState onRetry={() => refetch()} />
          ) : !data || data.length === 0 ? (
            <EmptyState />
          ) : (
            <Panel className="overflow-hidden">
              {data.map((m) => (
                <MandateRow key={m.vault} item={m} href={`/mandate/${m.vault}`} />
              ))}
            </Panel>
          )}
        </div>
      </main>
    </div>
  );
}

function SkeletonList() {
  return (
    <Panel className="overflow-hidden">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center justify-between border-b border-hairline px-4 py-4 last:border-0">
          <div className="flex flex-col gap-2">
            <span className="skeleton h-5 w-40 rounded-sm" />
            <span className="skeleton h-3 w-24 rounded-sm" />
          </div>
          <span className="skeleton h-2 w-40 rounded-pill" />
        </div>
      ))}
    </Panel>
  );
}

function ConnectPrompt() {
  return (
    <Panel className="flex flex-col items-center gap-4 px-6 py-14 text-center">
      <span className="flex size-11 items-center justify-center rounded-md border border-hairline bg-surface-2 text-ink-subtle">
        <WalletIcon size={22} aria-hidden />
      </span>
      <div>
        <h2 className="text-[17px] font-medium text-ink">Connect to see your mandates</h2>
        <p className="mx-auto mt-1.5 max-w-[42ch] text-[14px] text-ink-subtle">
          Connect a wallet or spin up a funded demo wallet to view and manage the mandates you have created.
        </p>
      </div>
      <Link
        href="/start?role=issuer"
        className="inline-flex items-center gap-2 rounded-sm bg-accent px-4 py-2 text-[14px] font-medium text-accent-ink transition-colors hover:bg-accent-hover"
      >
        Get started
      </Link>
    </Panel>
  );
}

function EmptyState() {
  return (
    <Panel className="flex flex-col items-center gap-4 px-6 py-14 text-center">
      <span className="flex size-11 items-center justify-center rounded-md border border-hairline bg-surface-2 text-accent">
        <StackIcon size={22} aria-hidden />
      </span>
      <div>
        <h2 className="text-[17px] font-medium text-ink">Create your first mandate</h2>
        <p className="mx-auto mt-1.5 max-w-[46ch] text-[14px] text-ink-subtle">
          A mandate deposits your inventory into a vault that owns every order, enforces your terms on
          every quote, and pays the market maker only for proven liquidity.
        </p>
      </div>
      <Link
        href="/create"
        className="inline-flex items-center gap-2 rounded-sm bg-accent px-4 py-2 text-[14px] font-medium text-accent-ink transition-colors hover:bg-accent-hover"
      >
        <PlusIcon size={16} weight="bold" aria-hidden />
        Create mandate
      </Link>
    </Panel>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <Panel className="flex flex-col items-center gap-4 px-6 py-14 text-center">
      <h2 className="text-[16px] font-medium text-ink">Could not load your mandates</h2>
      <button
        onClick={onRetry}
        className="rounded-sm border border-hairline bg-surface-1 px-4 py-2 text-[14px] text-ink hover:border-hairline-strong hover:bg-surface-2"
      >
        Retry
      </button>
    </Panel>
  );
}
