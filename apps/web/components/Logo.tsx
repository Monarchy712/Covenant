import { cn } from "@/lib/cn";

/**
 * Covenant mark: a seal split by a hairline — two parties bound by one contract.
 * The vertical rule is the covenant line; the enclosing bracket is the vault that
 * owns the orders. Simple geometric mark (allowed): no gradients, no glow.
 */
export function Logo({ className, size = 22 }: { className?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      {/* vault bracket */}
      <path
        d="M8 3H5.5A2.5 2.5 0 0 0 3 5.5v13A2.5 2.5 0 0 0 5.5 21H8M16 3h2.5A2.5 2.5 0 0 1 21 5.5v13a2.5 2.5 0 0 1-2.5 2.5H16"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      {/* covenant line */}
      <path d="M12 6.5v11" stroke="var(--color-accent)" strokeWidth="1.6" strokeLinecap="round" />
      {/* the two seals */}
      <circle cx="12" cy="6.5" r="1.6" fill="var(--color-accent)" />
      <circle cx="12" cy="17.5" r="1.6" fill="currentColor" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <Logo />
      <span className="text-[15px] font-semibold tracking-tight text-ink">Covenant</span>
    </span>
  );
}
