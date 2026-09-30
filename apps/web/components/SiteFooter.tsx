import { Wordmark } from "@/components/Logo";
import type { CovenantConfig } from "@/lib/api";

const REPO = "https://github.com/Monarchy712/Covenant";
const sourcify = (addr: string) => `https://repo.sourcify.dev/contracts/full_match/10143/${addr}/`;

export function SiteFooter({ config }: { config: CovenantConfig | null }) {
  const factory = config?.factory;
  const impl = "0x987922C61bD2941D593ED145A4D894f62838b18d"; // Sourcify-verified vault implementation

  return (
    <footer className="border-t border-hairline bg-canvas">
      <div className="mx-auto grid max-w-[1200px] gap-10 px-5 py-12 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
        <div className="flex flex-col gap-3">
          <Wordmark />
          <p className="max-w-[34ch] text-[13px] leading-relaxed text-ink-subtle">
            An enforceable market-making mandate on Kuru. Inventory the market maker can use but
            not take. Fees paid only when the chain proves the work.
          </p>
        </div>

        <FooterCol title="Product">
          <FooterLink href="/start">Launch app</FooterLink>
          <FooterLink href="/create">Create a mandate</FooterLink>
          <FooterLink href="/explore">Explore mandates</FooterLink>
          <FooterLink href="/proof">Verify a mandate</FooterLink>
        </FooterCol>

        <FooterCol title="Contracts">
          <FooterLink href={sourcify(impl)} external>
            Vault (Sourcify)
          </FooterLink>
          {factory && (
            <FooterLink href={sourcify(factory)} external>
              Factory (Sourcify)
            </FooterLink>
          )}
          <FooterLink href="https://kuru-testnet-docs.mintlify.site/" external>
            Kuru order book
          </FooterLink>
        </FooterCol>

        <FooterCol title="Learn">
          <FooterLink href={REPO} external>
            GitHub
          </FooterLink>
          <FooterLink href={`${REPO}/blob/main/docs/PRODUCT_FLOW.md`} external>
            How it works
          </FooterLink>
          <FooterLink href={`${REPO}/blob/main/README.md`} external>
            Docs
          </FooterLink>
        </FooterCol>
      </div>

      <div className="mx-auto flex max-w-[1200px] flex-col gap-2 border-t border-hairline px-5 py-5 text-[12px] text-ink-faint sm:flex-row sm:items-center sm:justify-between">
        <span>Monad testnet · chain 10143 · settlement on Kuru</span>
        <span>Built for the Onchain Finance &amp; Trading track. Testnet only.</span>
      </div>
    </footer>
  );
}

function FooterCol({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-faint">
        {title}
      </span>
      {children}
    </div>
  );
}

function FooterLink({
  href,
  children,
  external,
}: {
  href: string;
  children: React.ReactNode;
  external?: boolean;
}) {
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      className="text-[13px] text-ink-subtle transition-colors hover:text-ink"
    >
      {children}
    </a>
  );
}
