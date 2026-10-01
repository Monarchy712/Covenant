"use client";

import { useEffect } from "react";
import { cn } from "@/lib/cn";
import { Button } from "./Button";

/** Confirmation modal that states consequences in plain English. */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "primary",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "primary" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} aria-hidden />
      <div className={cn("relative w-full max-w-md overflow-hidden rounded-md border border-hairline bg-surface-1 shadow-[0_24px_80px_rgba(0,0,0,0.6)]")}>
        <div className="p-5">
          <h2 className="text-[17px] font-medium text-ink">{title}</h2>
          <p className="mt-2 text-[14px] leading-relaxed text-ink-muted">{body}</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-hairline px-5 py-3">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} size="sm" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
