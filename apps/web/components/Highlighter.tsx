"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

/**
 * An animated text annotation that draws once, left to right, on mount.
 * - variant "highlight": a translucent marker behind the text.
 * - variant "underline": a solid line under the text.
 * Uses a background gradient with box-decoration-clone so it wraps cleanly across
 * lines. Respects reduced-motion.
 */
export function Highlighter({
  children,
  className,
  variant = "highlight",
  color = "#22d3ee", // aqua
  delayMs = 450,
}: {
  children: React.ReactNode;
  className?: string;
  variant?: "highlight" | "underline";
  color?: string;
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

  const isUnderline = variant === "underline";
  const fill = isUnderline ? color : `color-mix(in srgb, ${color} 32%, transparent)`;
  const thickness = isUnderline ? "0.09em" : "44%";
  const position = isUnderline ? "0 100%" : "0 86%";

  return (
    <span
      className={cn("box-decoration-clone bg-no-repeat", className)}
      style={{
        backgroundImage: `linear-gradient(${fill}, ${fill})`,
        backgroundPosition: position,
        backgroundSize: on ? `100% ${thickness}` : `0% ${thickness}`,
        transition: reduce ? "none" : "background-size 720ms cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      {children}
    </span>
  );
}
