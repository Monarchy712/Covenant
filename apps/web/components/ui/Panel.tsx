import { cn } from "@/lib/cn";

/** Charcoal panel with a hairline border. The core surface of the terminal. */
export function Panel({
  className,
  children,
  as: Tag = "div",
}: {
  className?: string;
  children: React.ReactNode;
  as?: React.ElementType;
}) {
  return (
    <Tag
      className={cn(
        "rounded-md border border-hairline bg-surface-1",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

/** A labelled header row inside a panel (title left, actions right). */
export function PanelHeader({
  title,
  hint,
  right,
  className,
}: {
  title: React.ReactNode;
  hint?: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-b border-hairline px-4 py-3",
        className,
      )}
    >
      <div className="min-w-0">
        <div className="text-[12px] font-medium uppercase tracking-[0.14em] text-ink-subtle">
          {title}
        </div>
        {hint && <div className="mt-0.5 truncate text-[13px] text-ink-subtle">{hint}</div>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}
