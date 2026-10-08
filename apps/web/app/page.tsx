import Link from "next/link";
import {
  BuildingsIcon,
  ChartBarIcon,
  ArrowRightIcon,
  ArrowUpRightIcon,
  LockKeyIcon,
  SealCheckIcon,
  LightningIcon,
  StackIcon,
  ProhibitIcon,
} from "@phosphor-icons/react/dist/ssr";
import { SiteNav } from "@/components/SiteNav";
import { SiteFooter } from "@/components/SiteFooter";
import { FlagshipPanel } from "@/components/FlagshipPanel";
import { Highlighter } from "@/components/Highlighter";
import {
  fetchConfig,
  fetchProof,
  fetchEvents,
  fetchVaultBook,
  type CovenantConfig,
  type ProofResponse,
  type EventRow,
  type VaultBook,
} from "@/lib/api";

export const revalidate = 30;

export default async function LandingPage() {
  let config: CovenantConfig | null = null;
  let proof: ProofResponse | null = null;
  let events: EventRow[] = [];
  let book: VaultBook | null = null;
  try {
    config = await fetchConfig({ next: { revalidate: 30 } });
    [proof, events, book] = await Promise.all([
      fetchProof(config.flagship.vault, { next: { revalidate: 15 } }),
      fetchEvents(config.flagship.vault, 6, { next: { revalidate: 15 } }).catch(() => []),
      fetchVaultBook(config.flagship.vault, { next: { revalidate: 15 } }).catch(() => null),
    ]);
  } catch {
    /* render the static story even if the API is briefly unreachable */
  }

  return (
    <div className="min-h-[100dvh] bg-canvas">
      <SiteNav />
      <main id="main">
        <Hero config={config} proof={proof} events={events} book={book} />
        <ProblemSection />
        <HowItWorks />
        <WhyMonad />
        <ClosingCta />
      </main>
      <SiteFooter config={config} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Hero — asymmetric split: the claim on the left, the live proof on the right */
/* -------------------------------------------------------------------------- */
function Hero({
  config,
  proof,
  events,
  book,
}: {
  config: CovenantConfig | null;
  proof: ProofResponse | null;
  events: EventRow[];
  book: VaultBook | null;
}) {
  return (
    <section className="relative overflow-hidden border-b border-hairline">
      <div className="grid-backdrop pointer-events-none absolute inset-0 opacity-40" aria-hidden />
      <div className="relative mx-auto grid max-w-[1200px] items-center gap-12 px-5 pb-16 pt-16 lg:grid-cols-[1.02fr_0.98fr] lg:gap-10 lg:pb-24 lg:pt-20">
        <div className="flex flex-col">
          <span className="mb-5 inline-flex w-fit items-center gap-2 rounded-pill border border-hairline bg-surface-1 px-3 py-1 text-[13px] text-ink-subtle">
            <span className="live-dot size-1.5 rounded-pill bg-pass" />
            Live on Monad testnet · settled on Kuru
          </span>

          <h1 className="max-w-[26ch] text-balance text-[36px] font-semibold leading-[1.08] tracking-[-0.02em] text-ink sm:text-[44px] lg:text-[49px]">
            Hire a <Highlighter variant="underline" delayMs={300}>market maker</Highlighter> who{" "}
            <Highlighter delayMs={650}>can&rsquo;t dump your tokens</Highlighter>.
          </h1>

          <p className="mt-5 max-w-[52ch] text-[17px] leading-relaxed text-ink-muted lg:text-[18px]">
            Your inventory sits in a contract that owns every order on the book and pays the market
            maker only for liquidity the chain can prove.
          </p>

          <div className="mt-8 flex flex-col gap-3">
            <div className="flex flex-col gap-3 sm:flex-row">
              <RoleCta
                href="/start?role=issuer"
                icon={<BuildingsIcon size={18} weight="bold" />}
                label="I'm a token team"
                primary
              />
              <RoleCta
                href="/start?role=mm"
                icon={<ChartBarIcon size={18} weight="bold" />}
                label="I'm a market maker"
              />
            </div>
            <Link
              href="/proof"
              className="group inline-flex w-fit items-center gap-1.5 text-[15px] font-medium text-accent transition-colors hover:text-accent-hover"
            >
              Verify a mandate
              <ArrowRightIcon
                size={14}
                weight="bold"
                aria-hidden
                className="transition-transform group-hover:translate-x-0.5"
              />
            </Link>
          </div>
        </div>

        {/* right: the live flagship terminal, or a graceful placeholder */}
        <div className="lg:pl-2">
          {config ? (
            <FlagshipPanel config={config} initialProof={proof} initialEvents={events} initialBook={book} />
          ) : (
            <div className="skeleton h-[340px] w-full rounded-md border border-hairline" />
          )}
        </div>
      </div>
    </section>
  );
}

function RoleCta({
  href,
  icon,
  label,
  primary,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      className={
        "group inline-flex w-full items-center justify-center gap-2.5 rounded-sm px-4 py-2.5 text-[15px] font-medium transition-colors sm:w-auto sm:justify-start " +
        (primary
          ? "bg-accent-btn text-accent-ink hover:bg-accent-btn-hover"
          : "border border-hairline bg-surface-1 text-ink hover:border-hairline-strong hover:bg-surface-2")
      }
    >
      <span className={primary ? "text-accent-ink" : "text-ink-subtle"} aria-hidden>
        {icon}
      </span>
      {label}
      <ArrowRightIcon
        size={15}
        weight="bold"
        aria-hidden
        className="translate-x-0 opacity-50 transition-transform group-hover:translate-x-0.5"
      />
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/* Problem — the Movement case, one tight section                             */
/* -------------------------------------------------------------------------- */
function ProblemSection() {
  return (
    <section className="border-b border-hairline">
      <div className="mx-auto max-w-[1200px] px-5 py-16 lg:py-20">
        <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
          <div>
            <h2 className="text-[28px] font-semibold tracking-[-0.01em] text-ink lg:text-[33px]">
              The classic market-maker deal is built to be broken.
            </h2>
            <p className="mt-4 max-w-[46ch] text-[16px] leading-relaxed text-ink-muted">
              Projects lend a market maker a pile of tokens and grant a call option. The terms are
              secret, the incentives point the wrong way, and nothing on-chain stops the maker from
              quietly selling the loaned inventory into retail demand.
            </p>
            <p className="mt-4 max-w-[46ch] text-[16px] leading-relaxed text-ink-subtle">
              Coinwatch watches by API key. Disclosure frameworks are paperwork. None of them can
              refuse an order.
            </p>
          </div>

          <div className="flex flex-col justify-center rounded-md border border-fail-line bg-fail-soft/40 p-6 lg:p-8">
            <div className="flex items-baseline gap-3">
              <span className="num text-[48px] font-semibold leading-none text-fail lg:text-[60px]">
                66M
              </span>
              <span className="text-[15px] text-ink-muted">tokens</span>
            </div>
            <p className="mt-3 max-w-[42ch] text-[15px] leading-relaxed text-ink-muted">
              hit the market the day after Movement Labs listed. It triggered investigations, a
              buyback, and later a Chapter 11 filing. The inventory was never the maker&rsquo;s to
              sell.
            </p>
            <p className="mt-4 text-[14px] text-ink-subtle">
              Covenant makes that specific failure impossible: the tokens never touch the maker.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* How it works — three steps                                                 */
/* -------------------------------------------------------------------------- */
function HowItWorks() {
  const steps = [
    {
      icon: <LockKeyIcon size={20} weight="bold" />,
      title: "Deposit into a vault, not a wallet",
      body: "Your base tokens and fee budget go into a CovenantVault. It holds the Kuru margin account and is the only thing allowed to place orders.",
    },
    {
      icon: <StackIcon size={20} weight="bold" />,
      title: "The maker quotes inside rails it can't bend",
      body: "Every order runs a net-sell cap, a price band, and an open-order limit in the same transaction. An order that breaks a rule simply reverts.",
    },
    {
      icon: <SealCheckIcon size={20} weight="bold" />,
      title: "Pay only for proven liquidity",
      body: "A permissionless checkpoint scores two-sided presence, spread, and depth from on-chain state. A single failing observation voids that interval's fee.",
    },
  ];
  return (
    <section className="border-b border-hairline">
      <div className="mx-auto max-w-[1200px] px-5 py-16 lg:py-20">
        <h2 className="max-w-[24ch] text-[28px] font-semibold tracking-[-0.01em] text-ink lg:text-[33px]">
          One mechanism: the tokens can only move inside the mandate.
        </h2>
        <div className="mt-10 grid gap-px overflow-hidden rounded-md border border-hairline bg-hairline md:grid-cols-3">
          {steps.map((s, i) => (
            <div key={s.title} className="flex flex-col gap-3 bg-surface-1 p-6 lg:p-7">
              <div className="flex items-center gap-3">
                <span
                  className="flex size-9 items-center justify-center rounded-sm border border-hairline bg-surface-2 text-accent"
                  aria-hidden
                >
                  {s.icon}
                </span>
                <span className="num text-[13px] text-ink-faint">0{i + 1}</span>
              </div>
              <h3 className="mt-1 text-[17px] font-medium text-ink">{s.title}</h3>
              <p className="text-[15px] leading-relaxed text-ink-subtle">{s.body}</p>
            </div>
          ))}
        </div>
        <div className="mt-8 grid items-start gap-6 lg:grid-cols-[0.85fr_1.15fr]">
          <div className="flex flex-col gap-3 lg:pt-1">
            <span className="text-[12px] font-medium uppercase tracking-[0.14em] text-accent">
              It refuses, it doesn&rsquo;t warn
            </span>
            <p className="max-w-[46ch] text-[16px] leading-relaxed text-ink-muted">
              This is not a dashboard that watches and warns. When a market maker tries to place an
              order that breaks the mandate, the transaction reverts on-chain with a decoded reason.
              Here is a real one from our end-to-end run on testnet.
            </p>
          </div>
          <BlockedByContractCard />
        </div>

        <p className="mt-8 max-w-[64ch] text-[15px] leading-relaxed text-ink-subtle">
          Honest limit: Covenant governs the on-chain inventory on Kuru. It cannot stop a maker from
          hedging elsewhere. It protects your tokens and proves the maker&rsquo;s work.
        </p>
      </div>
    </section>
  );
}

/* The real decoded revert from docs/E2E_RUN.md. Same visual as the MM-console
   blocked card (M5). The oversized sell reverts pre-trade, so the honest link is
   the vault the governor protected, not a mined tx. */
function BlockedByContractCard() {
  const vault = "0x1f260263B010D293b7268cAC9e6E575Ec3d192DB";
  return (
    <div className="overflow-hidden rounded-md border border-fail-line bg-fail-soft/40">
      <div className="flex items-center gap-2 border-b border-fail-line px-4 py-2.5">
        <ProhibitIcon size={15} weight="bold" className="text-fail" aria-hidden />
        <span className="text-[13px] font-semibold uppercase tracking-[0.12em] text-fail">
          Blocked by contract
        </span>
        <span className="num ml-auto text-[12px] text-ink-subtle">SellAllowanceExceeded</span>
      </div>
      <div className="p-4">
        <p className="text-[15px] leading-relaxed text-ink-muted">
          A market maker tried to add a{" "}
          <span className="num text-ink">5,000</span> base ask. With{" "}
          <span className="num text-ink">39.96</span> already net-sold and{" "}
          <span className="num text-ink">60</span> resting, that would push net-sold plus resting
          to <span className="num text-ink">5,099.96</span>, far past the{" "}
          <span className="num text-ink">1,000</span> cap for the window, so the order never
          reached the book.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
          <span className="num text-ink-subtle">
            39.96 net-sold + 60 resting + 5,000 requested &gt; 1,000 cap
          </span>
          <a
            href={`https://testnet.monadexplorer.com/address/${vault}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-accent transition-colors hover:text-accent-hover"
          >
            Verify the vault on the explorer
            <ArrowUpRightIcon size={12} weight="bold" aria-hidden />
          </a>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Why Monad — real measured numbers                                          */
/* -------------------------------------------------------------------------- */
function WhyMonad() {
  const metrics = [
    {
      value: "~0.3s",
      label: "Confirmation",
      sub: "A submitted quote lands in the next block, and testnet blocks are 0.308s and constant. M2 replaces this with the live median measured by TxProgress.",
    },
    {
      value: "102 gwei",
      label: "Gas price",
      sub: "Measured constant on testnet, charged on the gas limit, so Covenant buffers every write by 15%.",
    },
    {
      value: "0.056 MON",
      label: "Cost per two-sided quote",
      sub: "One governed cancel-and-replace of both sides, about 550k gas at 102 gwei.",
    },
    {
      value: "1 tx",
      label: "Per requote",
      sub: "Cancel and replace both sides in a single Kuru batch update.",
    },
  ];
  return (
    <section className="border-b border-hairline bg-canvas-raised">
      <div className="mx-auto max-w-[1200px] px-5 py-16 lg:py-20">
        <div className="flex items-center gap-3">
          <LightningIcon size={20} weight="fill" className="text-accent" aria-hidden />
          <h2 className="text-[28px] font-semibold tracking-[-0.01em] text-ink lg:text-[33px]">
            Why Monad
          </h2>
        </div>
        <p className="mt-4 max-w-[64ch] text-[16px] leading-relaxed text-ink-muted">
          A contract that owns its orders and re-checks the mandate on every quote needs a fast,
          cheap, fully on-chain order book. Kuru provides the book, and Monad is the best home for
          running it in EVM today: sub-second blocks and a fixed, predictable gas price. The idea is
          portable; this is where it runs best.
        </p>
        <div className="mt-10 grid gap-px overflow-hidden rounded-md border border-hairline bg-hairline sm:grid-cols-2 lg:grid-cols-4">
          {metrics.map((m) => (
            <div key={m.label} className="flex flex-col gap-2 bg-surface-1 p-6">
              <span className="num text-[33px] font-semibold leading-none text-ink lg:text-[37px]">
                {m.value}
              </span>
              <span className="text-[13px] font-medium uppercase tracking-[0.12em] text-ink-subtle">
                {m.label}
              </span>
              <span className="text-[14px] leading-relaxed text-ink-subtle">{m.sub}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ClosingCta() {
  return (
    <section>
      <div className="mx-auto flex max-w-[1200px] flex-col items-start gap-6 px-5 py-16 lg:flex-row lg:items-center lg:justify-between lg:py-20">
        <div>
          <h2 className="text-[26px] font-semibold tracking-[-0.01em] text-ink lg:text-[31px]">
            Watch a real mandate refuse a bad order.
          </h2>
          <p className="mt-3 max-w-[52ch] text-[16px] leading-relaxed text-ink-muted">
            No wallet setup. Fund a demo wallet in the browser and cause a real on-chain event in
            under a minute.
          </p>
        </div>
        <div className="flex w-full shrink-0 flex-col gap-3 sm:w-auto sm:flex-row">
          <Link
            href="/start"
            className="inline-flex w-full items-center justify-center gap-2 rounded-sm bg-accent-btn px-5 py-3 text-[16px] font-medium text-accent-ink transition-colors hover:bg-accent-btn-hover sm:w-auto"
          >
            Launch the app
            <ArrowRightIcon size={16} weight="bold" aria-hidden />
          </Link>
          <Link
            href="/proof"
            className="inline-flex w-full items-center justify-center gap-2 rounded-sm border border-hairline bg-surface-1 px-5 py-3 text-[16px] font-medium text-ink transition-colors hover:border-hairline-strong hover:bg-surface-2 sm:w-auto"
          >
            Verify the live mandate
          </Link>
        </div>
      </div>
    </section>
  );
}
