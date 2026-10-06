"use client";

import { useEffect, useState } from "react";
import { SunIcon, MoonIcon } from "@phosphor-icons/react";

type Theme = "light" | "dark";
const KEY = "covenant-theme";

/** Nav theme toggle. Default follows the system preference (no stored choice);
 *  toggling sets an explicit light/dark and persists it. The no-flash inline
 *  script in the root layout applies a stored choice before hydration. */
export function ThemeToggle() {
  // `null` until mounted so SSR/first paint don't assume a theme (no mismatch).
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    let initial: Theme;
    try {
      const stored = localStorage.getItem(KEY) as Theme | null;
      initial = stored ?? (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    } catch {
      initial = "dark";
    }
    setTheme(initial);
  }, []);

  const apply = (next: Theme) => {
    setTheme(next);
    const root = document.documentElement;
    root.setAttribute("data-theme", next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* ignore */
    }
    // keep the mobile browser chrome color in sync
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", next === "light" ? "#f6f7f9" : "#08090c");
  };

  const toggle = () => apply(theme === "light" ? "dark" : "light");

  // Stable, theme-agnostic placeholder before mount to avoid a hydration flash.
  const isLight = theme === "light";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === null ? "Toggle color theme" : isLight ? "Switch to dark theme" : "Switch to light theme"}
      title={isLight ? "Switch to dark" : "Switch to light"}
      className="inline-flex size-9 items-center justify-center rounded-sm border border-hairline bg-surface-1 text-ink-subtle transition-colors hover:border-hairline-strong hover:bg-surface-2 hover:text-ink"
    >
      {/* Show the icon of the theme you'd switch TO. Invisible until mounted. */}
      <span className={theme === null ? "opacity-0" : "opacity-100"}>
        {isLight ? <MoonIcon size={17} weight="bold" aria-hidden /> : <SunIcon size={17} weight="bold" aria-hidden />}
      </span>
    </button>
  );
}
