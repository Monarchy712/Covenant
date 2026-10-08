"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

/**
 * A highlighter marker that wipes across its text once, left to right, on mount.
 * Uses a background gradient with box-decoration-clone so it wraps cleanly across
 * lines, and the accent token so it tracks light/dark. Respects reduced-motion.
 */
export function Highlighter({
  children,
  className,
  delayMs = 450,
}: {
  children: React.ReactNode;
  className?: string;
  delayMs?: number;
}) {
  const [on, setOn] = useState(false);
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    const prefersReduce =
      typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduce) {
      setReduce(true);
      setOn(true);
      return;
    }
    const t = setTimeout(() => setOn(true), delayMs);
    return () => clearTimeout(t);
  }, [delayMs]);

  return (
    <span
      className={cn("box-decoration-clone bg-no-repeat", className)}
      style={{
        backgroundImage:
          "linear-gradient(color-mix(in srgb, var(--color-accent) 30%, transparent), color-mix(in srgb, var(--color-accent) 30%, transparent))",
        backgroundPosition: "0 86%",
        backgroundSize: on ? "100% 44%" : "0% 44%",
        transition: reduce ? "none" : "background-size 720ms cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      {children}
    </span>
  );
}
