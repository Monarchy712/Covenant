"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  BuildingsIcon,
  ChartBarIcon,
  MagnifyingGlassIcon,
  WalletIcon,
  FlaskIcon,
  ArrowRightIcon,
  CircleNotchIcon,
  ArrowUpRightIcon,
} from "@phosphor-icons/react";
import { SiteNav } from "@/components/SiteNav";
import { Badge } from "@/components/ui/Badge";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { postDemoSession, RateLimitError, type DemoRole } from "@/lib/api";

const ROLE_META: Record<DemoRole, { label: string; blurb: string; icon: React.ReactNode }> = {
  issuer: {
    label: "token team",
    blurb: "Create a mandate, set terms in plain language, fund it, and launch a market maker who cannot dump your tokens.",
    icon: <BuildingsIcon size={20} weight="bold" aria-hidden />,
  },
  mm: {
    label: "market maker",
    blurb: "Review an invitation, see exactly where the lines are, quote inside the rails, and get paid for proven liquidity.",
    icon: <ChartBarIcon size={20} weight="bold" aria-hidden />,
  },
  trader: {
    label: "trader",
    blurb: "Trade against a live, enforced market and watch your fill land in the vault's gauge and feed within seconds.",
    icon: <MagnifyingGlassIcon size={20} weight="bold" aria-hidden />,
  },
};

function StartInner() {
  const params = useSearchParams();
  const router = useRouter();
  const roleParam = (params.get("role") as DemoRole) ?? "issuer";
  const role: DemoRole = ["issuer", "mm", "trader"].includes(roleParam) ? roleParam : "issuer";
  const meta = ROLE_META[role];

  const { connectInjected, startDemo, address, mode } = useWallet();
  const [status, setStatus] = useState<"choose" | "working" | "ratelimit" | "error">("choose");
  const [detail, setDetail] = useState<string>("");

  const routeForRole = (vault?: string) => {
    if (role === "issuer") return "/create";
    if (role === "mm") return vault ? `/invite/${vault}` : "/mm";
    return vault ? `/proof/${vault}` : "/explore";
  };

  const proceedDemo = async () => {
    setStatus("working");
    setDetail("Funding your demo wallet from the faucet…");
    try {
      const session = await startDemo(role);
      router.push(routeForRole(session.vault as string | undefined));
    } catch (e) {
      if (e instanceof RateLimitError) setStatus("ratelimit");
      else {
        setStatus("error");
        setDetail("Could not reach the faucet. Try again, or explore the live mandate.");
      }
    }
  };

  const proceedInjected = async () => {
    setStatus("working");
    setDetail("Connecting your wallet and switching to Monad testnet…");
    try {
      await connectInjected();
      if (role === "issuer") {
        router.push("/create");
        return;
      }
      // mm / trader need a provisioned mandate for this address
      setDetail("Provisioning a live mandate…");
      const acct = address;
      if (!acct) throw new Error("No account");
      const session = await postDemoSession(acct, role);
      router.push(routeForRole(session.vault as string | undefined));
    } catch (e) {
      if (e instanceof RateLimitError) setStatus("ratelimit");
      else {
        setStatus("error");
        setDetail("Wallet connection failed. Install MetaMask, or continue with the demo wallet.");
      }
    }
  };

  return (
    <div className="flex min-h-[100dvh] flex-col bg-canvas">
      <SiteNav />
      <main id="main" className="mx-auto flex w-full max-w-[560px] flex-1 flex-col justify-center px-5 py-16">
        <Badge tone="accent" className="w-fit">
          <span className="mr-1">{meta.icon}</span> {meta.label}
        </Badge>
        <h1 className="mt-4 text-[28px] font-semibold tracking-[-0.02em] text-ink lg:text-[32px]">
          Start as a {meta.label}
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-muted">{meta.blurb}</p>

        {status === "choose" && (
          <div className="mt-8 flex flex-col gap-3">
            <ChoiceButton
              primary
              icon={<FlaskIcon size={20} weight="bold" aria-hidden />}
              title="Continue with a demo wallet"
              sub="A funded testnet burner in your browser. Signs without popups. Best for a quick look."
              onClick={proceedDemo}
            />
            <ChoiceButton
              icon={<WalletIcon size={20} weight="bold" aria-hidden />}
              title="Connect a wallet"
              sub="MetaMask on Monad testnet. You approve each transaction."
              onClick={proceedInjected}
            />
            <p className="mt-1 text-[12px] leading-relaxed text-ink-subtle">
              This is a testnet demo. The demo wallet is a throwaway key kept only in your browser;
              the backend never sees it. Funds have no value.
            </p>
            {mode !== "none" && address && (
              <Link
                href={routeForRole()}
                className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-accent hover:text-accent-hover"
              >
                Already connected, continue
                <ArrowRightIcon size={14} weight="bold" aria-hidden />
              </Link>
            )}
          </div>
        )}

        {status === "working" && (
          <div className="mt-8 flex items-center gap-3 rounded-md border border-hairline bg-surface-1 px-4 py-4">
            <CircleNotchIcon size={18} weight="bold" className="animate-spin text-accent" aria-hidden />
            <span className="text-[14px] text-ink-muted">{detail}</span>
          </div>
        )}

        {status === "ratelimit" && (
          <Fallback
            title="The demo faucet is at its daily cap"
            body="Demo sessions are rate-limited so the testnet wallets last. You can still explore the live flagship mandate with no wallet, or connect your own wallet and use the faucet."
            onRetry={() => setStatus("choose")}
          />
        )}
        {status === "error" && (
          <Fallback title="Something went wrong" body={detail} onRetry={() => setStatus("choose")} />
        )}
      </main>
    </div>
  );
}

function ChoiceButton({
  icon,
  title,
  sub,
  onClick,
  primary,
}: {
  icon: React.ReactNode;
  title: string;
  sub: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "group flex items-start gap-3.5 rounded-md border p-4 text-left transition-colors " +
        (primary
          ? "border-accent-line bg-accent-soft/50 hover:bg-accent-soft"
          : "border-hairline bg-surface-1 hover:border-hairline-strong hover:bg-surface-2")
      }
    >
      <span className={primary ? "mt-0.5 text-accent" : "mt-0.5 text-ink-subtle"}>{icon}</span>
      <span className="flex-1">
        <span className="flex items-center gap-2 text-[15px] font-medium text-ink">
          {title}
          <ArrowRightIcon
            size={15}
            weight="bold"
            aria-hidden
            className="opacity-50 transition-transform group-hover:translate-x-0.5"
          />
        </span>
        <span className="mt-1 block text-[13px] leading-relaxed text-ink-subtle">{sub}</span>
      </span>
    </button>
  );
}

function Fallback({ title, body, onRetry }: { title: string; body: string; onRetry: () => void }) {
  return (
    <div className="mt-8 flex flex-col gap-4 rounded-md border border-hairline bg-surface-1 p-5">
      <div>
        <h2 className="text-[16px] font-medium text-ink">{title}</h2>
        <p className="mt-1.5 text-[14px] leading-relaxed text-ink-muted">{body}</p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Link
          href="/proof"
          className="inline-flex items-center gap-2 rounded-sm bg-accent px-4 py-2 text-[14px] font-medium text-accent-ink transition-colors hover:bg-accent-hover"
        >
          Explore the live flagship
          <ArrowUpRightIcon size={14} weight="bold" aria-hidden />
        </Link>
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-2 rounded-sm border border-hairline bg-surface-1 px-4 py-2 text-[14px] font-medium text-ink transition-colors hover:border-hairline-strong hover:bg-surface-2"
        >
          Back to options
        </button>
      </div>
    </div>
  );
}

export default function StartPage() {
  return (
    <Suspense fallback={<div className="min-h-[100dvh] bg-canvas" />}>
      <StartInner />
    </Suspense>
  );
}
