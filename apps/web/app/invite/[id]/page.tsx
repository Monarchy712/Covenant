"use client";

import { useEffect, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { accept, plainEnglishTerms, MandateState } from "@covenant/shared";
import {
  CheckCircleIcon,
  ProhibitIcon,
  CoinsIcon,
  ShieldCheckIcon,
  ArrowRightIcon,
} from "@phosphor-icons/react";
import { SiteNav } from "@/components/SiteNav";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { Badge, StateBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { TxProgress } from "@/components/TxProgress";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { useCovenantTx } from "@/lib/useCovenantTx";
import { fetchSummary } from "@/lib/api";
import { termsFromJSON, toBase, toQuote, fmtNum } from "@/lib/mandate";
import { truncateAddr } from "@/lib/format";

export default function InvitePage() {
  const params = useParams();
  const router = useRouter();
  const vault = (Array.isArray(params.id) ? params.id[0] : params.id) as `0x${string}`;
  const { address } = useWallet();
  const tx = useCovenantTx();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["summary", vault],
    queryFn: () => fetchSummary(vault),
    enabled: !!vault,
    refetchInterval: 10_000,
  });

  const snap = data?.snapshot;
  const terms = useMemo(() => (snap ? termsFromJSON(snap.terms) : null), [snap]);
  const state = data?.state ?? -1;
  const accepted = state >= MandateState.ACCEPTED;

  // State-aware: if this MM already accepted, go straight to the console.
  const isThisMM = !!address && !!snap && address.toLowerCase() === snap.terms.mm.toLowerCase();
  useEffect(() => {
    if (accepted && isThisMM) router.replace(`/mm/${vault}`);
  }, [accepted, isThisMM, router, vault]);

  const doAccept = () => {
    if (!terms) return;
    void tx.run([{ key: "accept", label: "Accept the mandate", getAction: () => accept(vault, terms) }], {
      onSuccess: () => setTimeout(() => router.push(`/mm/${vault}`), 1000),
    });
  };

  const cap = snap ? toBase(snap.terms.netSellCapPerWindow) : 0;
  const fee = snap ? toQuote(snap.terms.feePerInterval) : 0;
  const band = snap ? Number(snap.terms.bandBps) / 100 : 0;
  const maxOpen = snap ? Number(snap.terms.maxOpenPerSide) : 0;
  const windowH = snap ? Number(snap.terms.windowLength) / 3600 : 0;

  return (
    <div className="min-h-[100dvh] bg-canvas">
      <SiteNav />
      <main id="main" className="mx-auto w-full max-w-[720px] px-5 py-10">
        {isError ? (
          <Panel className="p-8 text-center">
            <h1 className="text-[18px] font-medium text-ink">Invitation not found</h1>
            <p className="mt-2 text-[15px] text-ink-subtle">No mandate at {truncateAddr(vault, 8, 6)}.</p>
          </Panel>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Badge tone="accent">
                <ShieldCheckIcon size={12} weight="bold" aria-hidden /> Market-making invitation
              </Badge>
              {data && <StateBadge state={data.stateName} />}
            </div>
            <h1 className="mt-4 text-[28px] font-semibold tracking-[-0.02em] text-ink lg:text-[33px]">
              You&rsquo;re invited to make a market
            </h1>
            <p className="mt-3 text-[16px] leading-relaxed text-ink-muted">
              {isLoading || !terms ? "Loading terms…" : plainEnglishTerms(terms)}
            </p>

            <div className="mt-7 grid gap-4 sm:grid-cols-2">
              <Panel>
                <PanelHeader title="What you can do" />
                <ul className="flex flex-col gap-2.5 p-4 text-[14px] text-ink-muted">
                  <Can>Quote both sides freely inside the ±{band}% price band.</Can>
                  <Can>Requote as often as you like; cancel and replace in one transaction.</Can>
                  <Can>Earn {fmtNum(fee)} USDC for every interval the chain proves you passed.</Can>
                  <Can>Claim your earned fees at any time. Inventory stays with the issuer.</Can>
                </ul>
              </Panel>
              <Panel>
                <PanelHeader title="What the contract will block" />
                <ul className="flex flex-col gap-2.5 p-4 text-[14px] text-ink-muted">
                  <Cant>Net-selling more than {fmtNum(cap)} base per {windowH}h window.</Cant>
                  <Cant>Any order priced outside the ±{band}% band around mid.</Cant>
                  <Cant>More than {maxOpen} resting orders on a side.</Cant>
                  <Cant>Withdrawing inventory or proceeds. You only ever touch earned fees.</Cant>
                </ul>
              </Panel>
            </div>

            <Panel className="mt-4">
              <div className="flex items-start gap-3 p-4">
                <CoinsIcon size={20} weight="bold" className="mt-0.5 text-accent" aria-hidden />
                <div>
                  <div className="text-[15px] font-medium text-ink">How you get paid</div>
                  <p className="mt-1 text-[14px] leading-relaxed text-ink-subtle">
                    A permissionless checkpoint scores your quoting from on-chain state. An interval pays{" "}
                    {fmtNum(fee)} USDC only if it was observed passing with no failing observation. A single failing
                    observation voids that interval&rsquo;s fee. Covenant proves your on-chain work; it does not control
                    any hedging you do elsewhere.
                  </p>
                </div>
              </div>
            </Panel>

            {tx.state.status !== "idle" && <TxProgress state={tx.state} className="mt-5" />}

            <div className="mt-6 flex items-center gap-3">
              {accepted ? (
                <Link
                  href={`/mm/${vault}`}
                  className="inline-flex items-center gap-2 rounded-sm bg-accent-btn px-5 py-2.5 text-[15px] font-medium text-accent-ink hover:bg-accent-btn-hover"
                >
                  Open the market-maker console
                  <ArrowRightIcon size={15} weight="bold" aria-hidden />
                </Link>
              ) : (
                <>
                  <Button onClick={doAccept} disabled={!address || !terms || tx.state.status === "running"}>
                    {tx.state.status === "running" ? "Accepting…" : "Accept mandate"}
                  </Button>
                  {!address && (
                    <Link href="/start?role=mm" className="text-[14px] text-accent hover:text-accent-hover">
                      Connect a wallet first
                    </Link>
                  )}
                </>
              )}
            </div>
            {!accepted && (
              <p className="mt-3 text-[13px] text-ink-subtle">
                Accepting pins the exact terms hash you reviewed. If the issuer changes any term, your acceptance is
                invalidated and you review again.
              </p>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function Can({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <CheckCircleIcon size={15} weight="fill" className="mt-0.5 shrink-0 text-pass" aria-hidden />
      <span>{children}</span>
    </li>
  );
}
function Cant({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <ProhibitIcon size={15} weight="bold" className="mt-0.5 shrink-0 text-fail" aria-hidden />
      <span>{children}</span>
    </li>
  );
}
