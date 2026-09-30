import Link from "next/link";
import { ArrowLeftIcon, ArrowUpRightIcon } from "@phosphor-icons/react/dist/ssr";
import { SiteNav } from "@/components/SiteNav";
import { Badge } from "@/components/ui/Badge";
import { fetchConfig, type CovenantConfig } from "@/lib/api";

export const revalidate = 60;
export const metadata = { title: "Covenant · Verify a mandate" };

export default async function ProofPage() {
  let config: CovenantConfig | null = null;
  try {
    config = await fetchConfig({ next: { revalidate: 60 } });
  } catch {
    /* fall through */
  }
  const vault = config?.flagship.vault;

  return (
    <div className="flex min-h-[100dvh] flex-col bg-canvas">
      <SiteNav />
      <main id="main" className="mx-auto flex w-full max-w-[640px] flex-1 flex-col justify-center px-5 py-20">
        <Badge tone="accent" className="w-fit">
          Public
        </Badge>
        <h1 className="mt-4 text-[30px] font-semibold tracking-[-0.02em] text-ink lg:text-[36px]">
          Verify a mandate, no wallet needed
        </h1>
        <p className="mt-3 max-w-[52ch] text-[15px] leading-relaxed text-ink-muted">
          The full public proof page (live terms, compliance history, net sold, and a per-number
          verify link) ships in M6. Until then, read the live flagship mandate straight from the
          chain on the explorer.
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          {vault && (
            <a
              href={`https://testnet.monadexplorer.com/address/${vault}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-sm bg-accent px-4 py-2.5 text-[14px] font-medium text-accent-ink transition-colors hover:bg-accent-hover"
            >
              Open the flagship on the explorer
              <ArrowUpRightIcon size={14} weight="bold" aria-hidden />
            </a>
          )}
          <Link
            href="/"
            className="inline-flex items-center justify-center gap-2 rounded-sm border border-hairline bg-surface-1 px-4 py-2.5 text-[14px] font-medium text-ink transition-colors hover:border-hairline-strong hover:bg-surface-2"
          >
            <ArrowLeftIcon size={15} weight="bold" aria-hidden />
            Back to home
          </Link>
        </div>
      </main>
    </div>
  );
}
