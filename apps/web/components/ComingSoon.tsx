import Link from "next/link";
import { ArrowLeftIcon, ArrowUpRightIcon } from "@phosphor-icons/react/dist/ssr";
import { SiteNav } from "@/components/SiteNav";
import { Badge } from "@/components/ui/Badge";

const REPO = "https://github.com/Monarchy712/Covenant";

/**
 * Placeholder for app routes that ship in later milestones (M2 wallet/start,
 * M3 create, M4 dashboard, M6 proof/explore). Keeps every nav/footer link
 * resolving instead of 404, and points to what already works.
 */
export function ComingSoon({
  eyebrow,
  title,
  description,
  milestone,
}: {
  eyebrow: string;
  title: string;
  description: string;
  milestone: string;
}) {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-canvas">
      <SiteNav />
      <main id="main" className="mx-auto flex w-full max-w-[640px] flex-1 flex-col justify-center px-5 py-20">
        <Badge tone="accent" className="w-fit">
          {eyebrow}
        </Badge>
        <h1 className="mt-4 text-[30px] font-semibold tracking-[-0.02em] text-ink lg:text-[36px]">
          {title}
        </h1>
        <p className="mt-3 max-w-[52ch] text-[15px] leading-relaxed text-ink-muted">{description}</p>
        <p className="mt-2 text-[13px] text-ink-subtle">Shipping in {milestone}.</p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/"
            className="inline-flex items-center justify-center gap-2 rounded-sm border border-hairline bg-surface-1 px-4 py-2.5 text-[14px] font-medium text-ink transition-colors hover:border-hairline-strong hover:bg-surface-2"
          >
            <ArrowLeftIcon size={15} weight="bold" aria-hidden />
            Back to home
          </Link>
          <a
            href={REPO}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-sm px-4 py-2.5 text-[14px] font-medium text-accent transition-colors hover:text-accent-hover"
          >
            Follow the build on GitHub
            <ArrowUpRightIcon size={14} weight="bold" aria-hidden />
          </a>
        </div>
      </main>
    </div>
  );
}
