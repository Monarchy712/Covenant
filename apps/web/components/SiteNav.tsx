import Link from "next/link";
import { Wordmark } from "@/components/Logo";
import { ButtonLink } from "@/components/ui/Button";
import { WalletButton } from "@/components/wallet/WalletButton";

const REPO = "https://github.com/Monarchy712/Covenant";

/** Single-line desktop nav, ≤64px tall. Collapses to logo + CTA on mobile. */
export function SiteNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-hairline bg-canvas/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-5">
        <Link href="/" aria-label="Covenant home">
          <Wordmark />
        </Link>

        <nav className="hidden items-center gap-7 text-[13px] text-ink-subtle md:flex">
          <Link href="/explore" className="transition-colors hover:text-ink">
            Explore
          </Link>
          <Link href="/proof" className="transition-colors hover:text-ink">
            Verify a mandate
          </Link>
          <a href={REPO} target="_blank" rel="noreferrer" className="transition-colors hover:text-ink">
            GitHub
          </a>
        </nav>

        <div className="flex items-center gap-2">
          <ButtonLink href="/proof" variant="ghost" size="sm" className="hidden sm:inline-flex">
            View live mandate
          </ButtonLink>
          <WalletButton />
        </div>
      </div>
    </header>
  );
}
