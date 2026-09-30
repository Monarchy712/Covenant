"use client";

import { useEffect, useRef, useState } from "react";
import {
  WalletIcon,
  CaretDownIcon,
  CopyIcon,
  CheckIcon,
  DropIcon,
  KeyIcon,
  ArrowsClockwiseIcon,
  SignOutIcon,
  FlaskIcon,
} from "@phosphor-icons/react";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { postFaucet, RateLimitError } from "@/lib/api";
import { truncateAddr } from "@/lib/format";
import { cn } from "@/lib/cn";

export function WalletButton({ className }: { className?: string }) {
  const { mode, address, ready, connecting, connectInjected, startDemo, resetDemoWallet, exportDemoKey, disconnect } =
    useWallet();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [faucetState, setFaucetState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [revealed, setRevealed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setRevealed(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  if (!ready) return <div className="skeleton h-8 w-24 rounded-sm" />;

  const copy = async () => {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  const faucet = async () => {
    if (!address) return;
    setFaucetState("loading");
    try {
      await postFaucet(address);
      setFaucetState("done");
    } catch (e) {
      setFaucetState(e instanceof RateLimitError ? "error" : "error");
    }
    setTimeout(() => setFaucetState("idle"), 2500);
  };

  const copyKey = async () => {
    const k = exportDemoKey();
    if (!k) return;
    await navigator.clipboard.writeText(k);
    setRevealed(true);
    setTimeout(() => setRevealed(false), 1600);
  };

  // --- not connected: connect menu ---
  if (mode === "none" || !address) {
    return (
      <div className={cn("relative", className)} ref={ref}>
        <button
          onClick={() => setOpen((o) => !o)}
          disabled={connecting}
          className="inline-flex h-8 items-center gap-2 rounded-sm bg-accent px-3 text-[13px] font-medium text-accent-ink transition-colors hover:bg-accent-hover disabled:opacity-60"
        >
          <WalletIcon size={15} weight="bold" aria-hidden />
          {connecting ? "Connecting…" : "Connect"}
          <CaretDownIcon size={12} weight="bold" aria-hidden />
        </button>
        {open && (
          <Menu>
            <MenuItem
              icon={<WalletIcon size={16} aria-hidden />}
              label="MetaMask"
              hint="Browser wallet"
              onClick={async () => {
                setOpen(false);
                try {
                  await connectInjected();
                } catch {
                  /* surfaced by the page if needed */
                }
              }}
            />
            <MenuItem
              icon={<FlaskIcon size={16} aria-hidden />}
              label="Demo wallet"
              hint="Funded testnet burner, no popups"
              onClick={async () => {
                setOpen(false);
                try {
                  await startDemo("issuer");
                } catch {
                  /* rate limit handled on /start */
                }
              }}
            />
          </Menu>
        )}
      </div>
    );
  }

  // --- connected: account menu ---
  const isBurner = mode === "burner";
  return (
    <div className={cn("relative", className)} ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-8 items-center gap-2 rounded-sm border border-hairline bg-surface-1 px-2.5 text-[13px] text-ink transition-colors hover:border-hairline-strong hover:bg-surface-2"
      >
        <span
          className={cn(
            "size-1.5 rounded-pill",
            isBurner ? "bg-warn" : "bg-pass",
          )}
          aria-hidden
        />
        <span className="num">{truncateAddr(address)}</span>
        <CaretDownIcon size={12} weight="bold" aria-hidden className="text-ink-faint" />
      </button>
      {open && (
        <Menu>
          <div className="border-b border-hairline px-3 py-2">
            <div className="text-[11px] uppercase tracking-[0.12em] text-ink-subtle">
              {isBurner ? "Demo wallet · testnet" : "MetaMask"}
            </div>
            <div className="num mt-0.5 text-[12px] text-ink-muted">{truncateAddr(address, 10, 8)}</div>
          </div>
          <MenuItem
            icon={copied ? <CheckIcon size={16} className="text-pass" aria-hidden /> : <CopyIcon size={16} aria-hidden />}
            label={copied ? "Copied" : "Copy address"}
            onClick={copy}
          />
          <MenuItem
            icon={<DropIcon size={16} aria-hidden />}
            label={
              faucetState === "loading"
                ? "Requesting funds…"
                : faucetState === "done"
                  ? "Funds sent"
                  : faucetState === "error"
                    ? "Try again shortly"
                    : "Get test funds"
            }
            onClick={faucet}
          />
          {isBurner && (
            <>
              <MenuItem
                icon={revealed ? <CheckIcon size={16} className="text-pass" aria-hidden /> : <KeyIcon size={16} aria-hidden />}
                label={revealed ? "Key copied (testnet)" : "Export key (testnet only)"}
                onClick={copyKey}
              />
              <MenuItem
                icon={<ArrowsClockwiseIcon size={16} aria-hidden />}
                label="Reset demo wallet"
                onClick={() => {
                  resetDemoWallet();
                  setOpen(false);
                }}
              />
            </>
          )}
          <MenuItem
            icon={<SignOutIcon size={16} aria-hidden />}
            label="Disconnect"
            onClick={() => {
              disconnect();
              setOpen(false);
            }}
          />
        </Menu>
      )}
    </div>
  );
}

function Menu({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-md border border-hairline bg-surface-1 shadow-[0_12px_40px_rgba(0,0,0,0.5)]">
      {children}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  hint,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[13px] text-ink transition-colors hover:bg-surface-2"
    >
      <span className="text-ink-subtle">{icon}</span>
      <span className="flex-1">
        {label}
        {hint && <span className="block text-[11px] text-ink-faint">{hint}</span>}
      </span>
    </button>
  );
}
