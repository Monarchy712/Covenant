"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { parseUnits, decodeEventLog, type TransactionReceipt } from "viem";
import {
  createMandate,
  depositInventory,
  fundFees,
  activate,
  plainEnglishTerms,
  covenantFactoryAbi,
  MandateState,
  type Terms,
  type Address,
} from "@covenant/shared";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  CopyIcon,
  RocketLaunchIcon,
} from "@phosphor-icons/react";
import { SiteNav } from "@/components/SiteNav";
import { Badge } from "@/components/ui/Badge";
import { OrderBookMini } from "@/components/OrderBookMini";
import { TxProgress } from "@/components/TxProgress";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { useConfig } from "@/lib/hooks/useConfig";
import { useCovenantTx } from "@/lib/useCovenantTx";
import { fetchSummary } from "@/lib/api";
import { truncateAddr } from "@/lib/format";
import { cn } from "@/lib/cn";

type Preset = "conservative" | "standard" | "aggressive";
interface Draft {
  step: number;
  tokenMode: "demo" | "custom";
  baseToken: string;
  quoteToken: string;
  market: string;
  preset: Preset;
  capBase: number;
  bandBps: number;
  feeUsdc: number;
  durationLabel: DurationKey;
  mmMode: "house" | "invite";
  mmAddress: string;
  depositBase: number;
  depositQuote: number;
  feeBudget: number;
}

type DurationKey = "demo" | "1d" | "7d" | "30d";
const DURATIONS: Record<DurationKey, { label: string; seconds: number; checkpoint: number }> = {
  demo: { label: "15 min (demo)", seconds: 900, checkpoint: 60 },
  "1d": { label: "1 day", seconds: 86_400, checkpoint: 600 },
  "7d": { label: "7 days", seconds: 604_800, checkpoint: 600 },
  "30d": { label: "30 days", seconds: 2_592_000, checkpoint: 600 },
};

const PRESETS: Record<Preset, { capBase: number; bandBps: number; feeUsdc: number; maxSpreadBps: number; maxOpen: number; maxFails: number }> = {
  conservative: { capBase: 500, bandBps: 100, feeUsdc: 25, maxSpreadBps: 50, maxOpen: 3, maxFails: 3 },
  standard: { capBase: 1000, bandBps: 200, feeUsdc: 50, maxSpreadBps: 100, maxOpen: 5, maxFails: 3 },
  aggressive: { capBase: 2500, bandBps: 400, feeUsdc: 100, maxSpreadBps: 200, maxOpen: 5, maxFails: 5 },
};

const DEFAULT: Draft = {
  step: 1,
  tokenMode: "demo",
  baseToken: "",
  quoteToken: "",
  market: "",
  preset: "standard",
  capBase: 1000,
  bandBps: 200,
  feeUsdc: 50,
  durationLabel: "demo",
  mmMode: "house",
  mmAddress: "",
  depositBase: 100,
  depositQuote: 200,
  feeBudget: 100,
};

const STORAGE = "covenant.wizard.v1";

export default function CreateWizard() {
  const router = useRouter();
  const { address, mode } = useWallet();
  const { data: config } = useConfig();
  const tx = useCovenantTx();
  const [draft, setDraft] = useState<Draft>(DEFAULT);
  const [createdVault, setCreatedVault] = useState<Address | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // hydrate from localStorage — restore the user's field values, but ALWAYS open at step 1
  // (a fresh visit, e.g. a new demo wallet, should start at the beginning, not resume on the
  // last step a previous session reached).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE);
      if (raw) setDraft({ ...DEFAULT, ...(JSON.parse(raw) as Partial<Draft>), step: 1 });
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (hydrated) localStorage.setItem(STORAGE, JSON.stringify(draft));
  }, [draft, hydrated]);

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));
  const applyPreset = (preset: Preset) => {
    const p = PRESETS[preset];
    patch({ preset, capBase: p.capBase, bandBps: p.bandBps, feeUsdc: p.feeUsdc });
  };

  const baseToken = (draft.tokenMode === "demo" ? config?.base : (draft.baseToken as Address)) as Address | undefined;
  const quoteToken = (draft.tokenMode === "demo" ? config?.quote : (draft.quoteToken as Address)) as Address | undefined;
  const market = (draft.tokenMode === "demo" ? config?.flagshipMarket : (draft.market as Address)) as Address | undefined;
  const mmAddress = (draft.mmMode === "house" ? config?.houseMM : (draft.mmAddress as Address)) as Address | undefined;

  const dur = DURATIONS[draft.durationLabel];
  const preset = PRESETS[draft.preset];

  const terms: Terms | null = useMemo(() => {
    if (!baseToken || !quoteToken || !market || !mmAddress || !address) return null;
    return {
      market,
      baseToken,
      quoteToken,
      issuer: address,
      mm: mmAddress,
      netSellCapPerWindow: parseUnits(String(draft.capBase), 18),
      windowLength: 3600n,
      bandBps: BigInt(draft.bandBps),
      maxOpenPerSide: BigInt(preset.maxOpen),
      maxSpreadBps: BigInt(preset.maxSpreadBps),
      minDepthPerSide: parseUnits("1", 18),
      checkpointInterval: BigInt(dur.checkpoint),
      feePerInterval: parseUnits(String(draft.feeUsdc), 6),
      duration: BigInt(dur.seconds),
      maxConsecutiveFails: BigInt(preset.maxFails),
    };
  }, [baseToken, quoteToken, market, mmAddress, address, draft.capBase, draft.bandBps, draft.feeUsdc, dur, preset]);

  const intervals = Math.floor(dur.seconds / dur.checkpoint);
  const fullFeeBudget = intervals * draft.feeUsdc;

  const launch = async () => {
    if (!terms || !config || !baseToken || !quoteToken) return;
    const t = terms;
    const cfg = config;
    const base = baseToken;
    const quote = quoteToken;
    let vault: Address | null = null;
    await tx.run(
      [
        {
          key: "create",
          label: "Create the mandate",
          getAction: () => createMandate(cfg.factory, t),
          onReceipt: (r: TransactionReceipt) => {
            for (const log of r.logs) {
              try {
                const d = decodeEventLog({ abi: covenantFactoryAbi, data: log.data, topics: log.topics });
                if (d.eventName === "MandateCreated") {
                  vault = (d.args as unknown as { vault: Address }).vault;
                  setCreatedVault(vault);
                  break;
                }
              } catch {
                /* not this log */
              }
            }
          },
        },
        {
          // The contract requires ACCEPTED state before deposit/fund, so wait for the
          // MM to accept first (the house MM auto-accepts within seconds of creation).
          key: "accept",
          label: draft.mmMode === "house" ? "Wait for the market maker to accept" : "Wait for the invited MM to accept",
          poll: async () => {
            if (!vault) return false;
            try {
              const s = await fetchSummary(vault);
              return s.state >= MandateState.ACCEPTED;
            } catch {
              return false;
            }
          },
          timeoutMs: 60_000,
        },
        {
          key: "deposit",
          label: "Approve & deposit base inventory",
          getAction: () => depositInventory(vault!, base, parseUnits(String(draft.depositBase), 18)),
        },
        {
          // Quote inventory lets the maker place bids (two-sided quoting needs both sides).
          key: "depositQuote",
          label: "Approve & deposit quote inventory",
          getAction: () => depositInventory(vault!, quote, parseUnits(String(draft.depositQuote), 6)),
        },
        {
          key: "fund",
          label: "Approve & fund the fee escrow",
          getAction: () => fundFees(vault!, quote, parseUnits(String(draft.feeBudget), 6)),
        },
        {
          key: "activate",
          label: "Activate the mandate",
          getAction: () => activate(vault!),
        },
      ],
      {
        onSuccess: () => {
          if (vault) setTimeout(() => router.push(`/mandate/${vault}`), 900);
        },
      },
    );
  };

  const stepValid = (): boolean => {
    if (draft.step === 1) return draft.tokenMode === "demo" ? !!config : !!draft.baseToken && !!draft.quoteToken && !!draft.market;
    if (draft.step === 3) return draft.mmMode === "house" ? !!config?.houseMM : /^0x[a-fA-F0-9]{40}$/.test(draft.mmAddress);
    return true;
  };

  return (
    <div className="min-h-[100dvh] bg-canvas">
      <SiteNav />
      <main id="main" className="mx-auto w-full max-w-[880px] px-5 py-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-[24px] font-semibold tracking-[-0.01em] text-ink">Create a mandate</h1>
          <Link href="/app" className="text-[14px] text-ink-subtle hover:text-ink">
            My mandates
          </Link>
        </div>

        <Stepper step={draft.step} />

        {!address && (
          <div className="mt-6 rounded-md border border-warn-line bg-warn-soft/40 px-4 py-3 text-[14px] text-ink-muted">
            Connect a wallet to launch.{" "}
            <Link href="/start?role=issuer" className="font-medium text-accent hover:text-accent-hover">
              Get started
            </Link>
            .
          </div>
        )}

        <div className="mt-6">
          {draft.step === 1 && <StepToken draft={draft} patch={patch} config={config} />}
          {draft.step === 2 && (
            <StepTerms
              draft={draft}
              patch={patch}
              applyPreset={applyPreset}
              terms={terms}
              intervals={intervals}
              fullFeeBudget={fullFeeBudget}
              durationLabel={dur.label}
            />
          )}
          {draft.step === 3 && <StepMM draft={draft} patch={patch} config={config} />}
          {draft.step === 4 && (
            <StepLaunch
              draft={draft}
              patch={patch}
              terms={terms}
              tx={tx}
              onLaunch={launch}
              fullFeeBudget={fullFeeBudget}
              canLaunch={!!address && !!terms}
            />
          )}
        </div>

        {draft.step < 4 && (
          <div className="mt-8 flex items-center justify-between">
            <button
              onClick={() => patch({ step: Math.max(1, draft.step - 1) })}
              disabled={draft.step === 1}
              className="inline-flex items-center gap-2 rounded-sm border border-hairline bg-surface-1 px-4 py-2 text-[15px] text-ink transition-colors hover:border-hairline-strong hover:bg-surface-2 disabled:opacity-40"
            >
              <ArrowLeftIcon size={15} weight="bold" aria-hidden />
              Back
            </button>
            <button
              onClick={() => stepValid() && patch({ step: draft.step + 1 })}
              disabled={!stepValid()}
              className="inline-flex items-center gap-2 rounded-sm bg-accent-btn px-5 py-2 text-[15px] font-medium text-accent-ink transition-colors hover:bg-accent-btn-hover disabled:opacity-40"
            >
              Continue
              <ArrowRightIcon size={15} weight="bold" aria-hidden />
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

/* ---- step chrome ---- */
function Stepper({ step }: { step: number }) {
  const labels = ["Token & market", "Terms", "Market maker", "Fund & launch"];
  return (
    <div className="flex items-center gap-2">
      {labels.map((l, i) => {
        const n = i + 1;
        const active = n === step;
        const done = n < step;
        return (
          <div key={l} className="flex flex-1 items-center gap-2">
            <div
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-pill text-[13px] font-medium",
                done && "bg-pass text-black",
                active && "bg-accent-btn text-accent-ink",
                !done && !active && "border border-hairline bg-surface-1 text-ink-subtle",
              )}
            >
              {done ? <CheckIcon size={13} weight="bold" aria-hidden /> : n}
            </div>
            <span className={cn("hidden text-[13px] sm:block", active ? "text-ink" : "text-ink-subtle")}>{l}</span>
            {n < 4 && <div className="h-px flex-1 bg-hairline" />}
          </div>
        );
      })}
    </div>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("rounded-md border border-hairline bg-surface-1 p-5", className)}>{children}</div>;
}
function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="mb-1.5 block text-[13px] font-medium text-ink-muted">{children}</label>;
}
function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "h-9 w-full rounded-sm border border-hairline bg-surface-2 px-3 text-[15px] text-ink outline-none placeholder:text-ink-faint focus:border-accent",
        props.className,
      )}
    />
  );
}

/* ---- step 1 ---- */
function StepToken({ draft, patch, config }: { draft: Draft; patch: (p: Partial<Draft>) => void; config: ReturnType<typeof useConfig>["data"] }) {
  return (
    <Card>
      <h2 className="text-[17px] font-medium text-ink">Token & market</h2>
      <p className="mt-1 text-[14px] text-ink-subtle">Pick the token and Kuru market this mandate will make a market for.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Choice
          selected={draft.tokenMode === "demo"}
          title="Use a demo token"
          sub="A pre-deployed test token and Kuru market. Best for a quick launch."
          onClick={() => patch({ tokenMode: "demo" })}
        />
        <Choice
          selected={draft.tokenMode === "custom"}
          title="My token"
          sub="Provide your ERC-20 and an existing Kuru market address."
          onClick={() => patch({ tokenMode: "custom" })}
        />
      </div>
      {draft.tokenMode === "demo" ? (
        <div className="mt-4 grid gap-2 rounded-sm border border-hairline bg-surface-2 p-3 text-[13px]">
          <Row k="Base token" v={config ? truncateAddr(config.base, 8, 6) : "…"} />
          <Row k="Quote (USDC)" v={config ? truncateAddr(config.quote, 8, 6) : "…"} />
          <Row k="Kuru market" v={config ? truncateAddr(config.flagshipMarket, 8, 6) : "…"} />
        </div>
      ) : (
        <div className="mt-4 grid gap-3">
          <div>
            <FieldLabel>Base token address</FieldLabel>
            <TextInput placeholder="0x…" value={draft.baseToken} onChange={(e) => patch({ baseToken: e.target.value })} />
          </div>
          <div>
            <FieldLabel>Quote token address (USDC)</FieldLabel>
            <TextInput placeholder="0x…" value={draft.quoteToken} onChange={(e) => patch({ quoteToken: e.target.value })} />
          </div>
          <div>
            <FieldLabel>Kuru market address</FieldLabel>
            <TextInput placeholder="0x…" value={draft.market} onChange={(e) => patch({ market: e.target.value })} />
          </div>
        </div>
      )}
    </Card>
  );
}

/* ---- step 2 ---- */
function StepTerms({
  draft,
  patch,
  applyPreset,
  terms,
  intervals,
  fullFeeBudget,
  durationLabel,
}: {
  draft: Draft;
  patch: (p: Partial<Draft>) => void;
  applyPreset: (p: Preset) => void;
  terms: Terms | null;
  intervals: number;
  fullFeeBudget: number;
  durationLabel: string;
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
      <Card>
        <h2 className="text-[17px] font-medium text-ink">Terms</h2>
        <p className="mt-1 text-[14px] text-ink-subtle">Start from a preset, then fine-tune.</p>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {(["conservative", "standard", "aggressive"] as Preset[]).map((p) => (
            <button
              key={p}
              onClick={() => applyPreset(p)}
              className={cn(
                "rounded-sm border px-3 py-2 text-[14px] capitalize transition-colors",
                draft.preset === p
                  ? "border-accent-line bg-accent-soft text-accent"
                  : "border-hairline bg-surface-2 text-ink-subtle hover:text-ink",
              )}
            >
              {p}
            </button>
          ))}
        </div>

        <div className="mt-5 grid gap-4">
          <Slider label="Net-sell cap per window" value={draft.capBase} min={100} max={5000} step={100} unit="base" onChange={(v) => patch({ capBase: v, preset: "standard" })} />
          <Slider label="Price band (± around mid)" value={draft.bandBps} min={50} max={1000} step={25} unit="bps" fmt={(v) => `${v / 100}%`} onChange={(v) => patch({ bandBps: v })} />
          <Slider label="Fee per passing interval" value={draft.feeUsdc} min={5} max={250} step={5} unit="USDC" onChange={(v) => patch({ feeUsdc: v })} />
          <div>
            <FieldLabel>Duration</FieldLabel>
            <div className="grid grid-cols-4 gap-2">
              {(Object.keys(DURATIONS) as DurationKey[]).map((k) => (
                <button
                  key={k}
                  onClick={() => patch({ durationLabel: k })}
                  className={cn(
                    "rounded-sm border px-2 py-1.5 text-[13px] transition-colors",
                    draft.durationLabel === k
                      ? "border-accent-line bg-accent-soft text-accent"
                      : "border-hairline bg-surface-2 text-ink-subtle hover:text-ink",
                  )}
                >
                  {DURATIONS[k].label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Card>

      <div className="flex flex-col gap-4">
        <Card>
          <div className="text-[12px] font-medium uppercase tracking-[0.12em] text-ink-subtle">The contract, in plain English</div>
          <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">
            {terms ? plainEnglishTerms(terms) : "Complete step 1 to preview the terms."}
          </p>
        </Card>
        <Card className="p-0">
          <div className="border-b border-hairline px-4 py-2.5 text-[12px] font-medium uppercase tracking-[0.12em] text-ink-subtle">
            Allowed band around mid
          </div>
          <OrderBookMini
            className="py-1"
            mid={2.0}
            bandBps={draft.bandBps}
            asks={[
              { price: 2 * (1 + draft.bandBps / 10000), size: 90 },
              { price: 2.01, size: 60, isVault: true },
            ]}
            bids={[
              { price: 1.99, size: 60, isVault: true },
              { price: 2 * (1 - draft.bandBps / 10000), size: 90 },
            ]}
          />
        </Card>
        <Card>
          <div className="text-[12px] font-medium uppercase tracking-[0.12em] text-ink-subtle">Fee budget estimate</div>
          <div className="mt-2 num text-[24px] font-medium text-ink">
            {fullFeeBudget.toLocaleString("en-US")} <span className="text-[13px] text-ink-subtle">USDC max</span>
          </div>
          <p className="mt-1 text-[13px] text-ink-subtle">
            {draft.feeUsdc} USDC × up to {intervals.toLocaleString("en-US")} intervals over {durationLabel}. You only pay for
            passing intervals; unused escrow is returned.
          </p>
        </Card>
      </div>
    </div>
  );
}

/* ---- step 3 ---- */
function StepMM({ draft, patch, config }: { draft: Draft; patch: (p: Partial<Draft>) => void; config: ReturnType<typeof useConfig>["data"] }) {
  const [copied, setCopied] = useState(false);
  const inviteUrl = typeof window !== "undefined" ? `${window.location.origin}/invite/` : "";
  return (
    <Card>
      <h2 className="text-[17px] font-medium text-ink">Market maker</h2>
      <p className="mt-1 text-[14px] text-ink-subtle">Choose who makes the market inside your rails.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Choice
          selected={draft.mmMode === "house"}
          title="Covenant's demo market maker"
          sub="Accepts within seconds and quotes honestly. Best for a live demo."
          onClick={() => patch({ mmMode: "house" })}
        />
        <Choice
          selected={draft.mmMode === "invite"}
          title="Invite by address"
          sub="Send an invite link to your own market maker."
          onClick={() => patch({ mmMode: "invite" })}
        />
      </div>
      {draft.mmMode === "house" ? (
        <div className="mt-4 rounded-sm border border-hairline bg-surface-2 p-3 text-[13px]">
          <Row k="House MM" v={config ? truncateAddr(config.houseMM, 8, 6) : "…"} />
        </div>
      ) : (
        <div className="mt-4 grid gap-3">
          <div>
            <FieldLabel>Market maker address</FieldLabel>
            <TextInput placeholder="0x…" value={draft.mmAddress} onChange={(e) => patch({ mmAddress: e.target.value })} />
          </div>
          <div className="flex items-center gap-2 rounded-sm border border-hairline bg-surface-2 px-3 py-2 text-[13px] text-ink-subtle">
            <span className="truncate">Invite link generated after launch: {inviteUrl}[vault]</span>
            <button
              onClick={() => {
                navigator.clipboard.writeText(inviteUrl);
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              }}
              className="ml-auto shrink-0 text-accent hover:text-accent-hover"
              aria-label="Copy invite base URL"
            >
              {copied ? <CheckIcon size={14} aria-hidden /> : <CopyIcon size={14} aria-hidden />}
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

/* ---- step 4 ---- */
function StepLaunch({
  draft,
  patch,
  terms,
  tx,
  onLaunch,
  fullFeeBudget,
  canLaunch,
}: {
  draft: Draft;
  patch: (p: Partial<Draft>) => void;
  terms: Terms | null;
  tx: ReturnType<typeof useCovenantTx>;
  onLaunch: () => void;
  fullFeeBudget: number;
  canLaunch: boolean;
}) {
  const running = tx.state.status === "running";
  const done = tx.state.status === "success";
  return (
    <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
      <Card>
        <h2 className="text-[17px] font-medium text-ink">Fund & launch</h2>
        <p className="mt-1 text-[14px] text-ink-subtle">Deposit inventory and a fee budget, then launch.</p>
        <div className="mt-4 grid gap-3">
          <div>
            <FieldLabel>Base inventory to deposit</FieldLabel>
            <TextInput
              type="number"
              value={draft.depositBase}
              onChange={(e) => patch({ depositBase: Number(e.target.value) })}
            />
          </div>
          <div>
            <FieldLabel>Quote inventory to deposit (USDC)</FieldLabel>
            <TextInput
              type="number"
              value={draft.depositQuote}
              onChange={(e) => patch({ depositQuote: Number(e.target.value) })}
            />
            <p className="mt-1 text-[12px] text-ink-subtle">Lets the market maker place bids. Two-sided quoting needs both base and quote.</p>
          </div>
          <div>
            <FieldLabel>Fee budget to escrow (USDC)</FieldLabel>
            <TextInput
              type="number"
              value={draft.feeBudget}
              onChange={(e) => patch({ feeBudget: Number(e.target.value) })}
            />
            <p className="mt-1 text-[12px] text-ink-subtle">Full duration would need up to {fullFeeBudget.toLocaleString("en-US")} USDC. Any unused escrow is returned.</p>
          </div>
        </div>
        <button
          onClick={onLaunch}
          disabled={!canLaunch || running || done}
          className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-sm bg-accent-btn px-5 py-2.5 text-[15px] font-medium text-accent-ink transition-colors hover:bg-accent-btn-hover disabled:opacity-50"
        >
          <RocketLaunchIcon size={16} weight="bold" aria-hidden />
          {done ? "Launched" : running ? "Launching…" : "Launch mandate"}
        </button>
      </Card>

      <Card>
        <div className="text-[12px] font-medium uppercase tracking-[0.12em] text-ink-subtle">Launch checklist</div>
        {tx.state.status === "idle" ? (
          <div className="mt-3 flex flex-col gap-2 text-[14px] text-ink-subtle">
            {["Create the mandate", "Approve & deposit base inventory", "Approve & fund the fee escrow", "Wait for the market maker to accept", "Activate the mandate"].map(
              (l) => (
                <div key={l} className="flex items-center gap-2">
                  <span className="size-1.5 rounded-pill bg-ink-faint" aria-hidden />
                  {l}
                </div>
              ),
            )}
          </div>
        ) : (
          <TxProgress state={tx.state} className="mt-3" />
        )}
        {done && <p className="mt-3 text-[14px] text-pass">Mandate is live. Taking you to the dashboard…</p>}
      </Card>
    </div>
  );
}

/* ---- small pieces ---- */
function Choice({ selected, title, sub, onClick }: { selected: boolean; title: string; sub: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-sm border p-3.5 text-left transition-colors",
        selected ? "border-accent-line bg-accent-soft/50" : "border-hairline bg-surface-2 hover:border-hairline-strong",
      )}
    >
      <div className="flex items-center gap-2 text-[15px] font-medium text-ink">
        <span className={cn("size-3.5 rounded-pill border", selected ? "border-accent bg-accent" : "border-hairline-strong")} aria-hidden />
        {title}
      </div>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-subtle">{sub}</p>
    </button>
  );
}
function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-ink-subtle">{k}</span>
      <span className="num text-ink">{v}</span>
    </div>
  );
}
function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  fmt,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  fmt?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[13px] font-medium text-ink-muted">{label}</span>
        <span className="num text-[14px] text-ink">
          {fmt ? fmt(value) : value.toLocaleString("en-US")} <span className="text-[12px] text-ink-subtle">{unit}</span>
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--color-accent)]"
      />
    </div>
  );
}
