import { cn } from "@/lib/cn";
import Link from "next/link";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium " +
  "transition-[background-color,border-color,color,transform] duration-150 ease-[cubic-bezier(0.4,0,0.2,1)] " +
  "active:translate-y-px disabled:pointer-events-none disabled:opacity-45 select-none rounded-sm";

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-9 px-4 text-[14px]",
  lg: "h-11 px-5 text-[15px]",
};

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:bg-accent-hover active:bg-accent-press",
  secondary:
    "bg-surface-2 text-ink border border-hairline hover:border-hairline-strong hover:bg-surface-3",
  ghost: "text-ink-muted hover:text-ink hover:bg-surface-2",
  danger: "bg-fail text-white hover:brightness-110 active:brightness-95",
};

interface CommonProps {
  variant?: Variant;
  size?: Size;
  className?: string;
  children: React.ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  children,
  ...rest
}: CommonProps & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={cn(base, sizes[size], variants[variant], className)} {...rest}>
      {children}
    </button>
  );
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  children,
  href,
  ...rest
}: CommonProps & { href: string } & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  const external = href.startsWith("http");
  const cls = cn(base, sizes[size], variants[variant], className);
  if (external) {
    return (
      <a href={href} className={cls} target="_blank" rel="noreferrer" {...rest}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={cls} {...rest}>
      {children}
    </Link>
  );
}
