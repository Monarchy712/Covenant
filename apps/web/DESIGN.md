# Covenant — Design System

**Direction:** institutional trust + trading-terminal precision. Calm, dense, confident.
"Stripe's clarity meets a professional trading terminal." **Two real themes** (dark + light,
system-default with a nav toggle), one accent, semantic colors for meaning only, tabular numerals
on every number.

---

## 1. References (and what each contributes)

**Linear** (`linear.app`) — the structural backbone.
- Near-black cool canvas with charcoal panels separated by **hairline borders**, not shadows.
- A **single accent used only for meaning** (brand mark, focus, a few CTAs), never decoratively.
- Dense, technical, "software-craft documentation" feel. Product surfaces framed in dark panels
  rather than atmospheric color.
- We take: the surface/hairline ramp, accent discipline, tight negative letter-spacing on display
  type, and the flat (shadow-light) elevation model.

**Stripe** (`stripe.com`) — the financial-infrastructure trust layer.
- **Tabular figures wherever money and metrics appear.** Editorial display headlines at controlled
  scale. A dashboard shell that flips to a dark app polarity.
- We take: tabular-numeral rigor (every number is `.num`, Geist Mono + `tnum`), trust-first copy,
  and money/KPI readouts that read like a statement, not marketing.

What we deliberately did **not** borrow: Linear's lavender accent (too close to the banned
"AI purple-blue") and Stripe's gradient mesh. Covenant's accent is a flat azure, no gradients,
no glow.

---

## 2. Color tokens (two themes)

Every color is a CSS variable (`--color-*`) defined in `@theme` (the dark default, which also
generates the utilities) and **overridden** under `:root[data-theme="light"]` and the
`prefers-color-scheme: light` media query. No component carries a hardcoded color, so switching a
single attribute re-themes the whole app. `color-scheme` tracks the theme (native controls,
scrollbars). **Default = system preference**; the nav toggle sets an explicit choice persisted in
`localStorage` (`covenant-theme`), applied before first paint by a tiny inline script (no FOUC).

### Neutral base
| Token | Dark | Light | Use |
|---|---|---|---|
| `canvas` | `#08090c` | `#f6f7f9` | page background (light is a warm-cool off-white, never pure white) |
| `canvas-raised` | `#0b0d11` | `#eef1f5` | alternating section band |
| `surface-1` | `#0e1015` | `#ffffff` | panels (white panels lift off the off-white canvas) |
| `surface-2` | `#14171d` | `#f1f4f8` | elevated / hover / inputs |
| `surface-3` | `#1a1e25` | `#e7ebf1` | track fills, deepest inset |
| `hairline` | `#212630` | `#e3e7ee` | default 1px borders |
| `hairline-strong` | `#2e3542` | `#cbd2dd` | hover borders, emphasis rules |

### Ink (contrast lifted in both themes so secondary text never reads "disabled")
| Token | Dark | Light | Use |
|---|---|---|---|
| `ink` | `#f4f6f9` | `#0b0e14` | primary text (≈18:1 both themes, AAA) |
| `ink-muted` | `#ccd3de` | `#363f4d` | body copy (≈10–13:1, AAA) |
| `ink-subtle` | `#95a0af` | `#586273` | labels, secondary (≈5.5–7:1, AA) |
| `ink-faint` | `#6b7483` | `#6b7584` | captions, meta, units (≈4:1, AA for UI/large) |

### Accent + semantic (meaning only; all pass AA **as text** on their surfaces)
| Token | Dark | Light | Meaning |
|---|---|---|---|
| `accent` | `#4c8dff` | `#1a66e0` | brand · interactive · focus · links |
| `accent-btn` | `#3570d8` | `#1a66e0` | **solid button background** (needs white text ≥ 4.5; a bright azure for AA text on dark can't also carry white text, hence the split) |
| `pass` | `#35c978` | `#0a7a42` | compliant · paid · passing |
| `fail` | `#f5565f` | `#cf2230` | blocked · failed |
| `warn` | `#f7ad33` | `#8a5a00` | paused · warning (light uses a dark amber so it reads as text) |
| `idle` | `#7b8491` | `#5c6673` | unobserved · neutral |

Each semantic has a `-soft` fill and `-line` border variant (also themed) for tinted panels/chips.
`danger-btn` mirrors `accent-btn` for the red button background. Elevation uses themed
`--shadow-pop` / `--shadow-modal` (heavy on dark, soft on light); panels stay flat on both.

**Rule:** color is never decorative. Green means a fee was paid; red means an order was blocked or
a checkpoint failed; amber means paused/near-limit; grey means unobserved/idle. If a color has no
meaning, it is a neutral. The accent is distinct in hue from all four semantics, so "brand/UI"
never reads as "good outcome" (green).

**Contrast:** every text/background pair in both themes was audited to WCAG AA (body aims AAA);
the full result is recorded in `PROGRESS.md` (theme session).

---

## 3. Typography

- **Geist Sans** — interface + display. `next/font`, self-hosted, `font-display: swap`.
- **Geist Mono** — every number (prices, sizes, fees, counts, addresses) via `.num`
  (`font-variant-numeric: tabular-nums; "tnum" "zero"`). Inline figures in prose use `.tnum`.
- Global features: `cv02 cv03 cv04 ss01`, base tracking `-0.011em`.
- **Readability pass:** the whole type ramp was bumped ~1 step (body 15→16, labels 11/12→12/13,
  display up proportionally) so the UI reads comfortably at 100% zoom. Base weight is heavier
  (`--weight-body: 450`, headings `--weight-strong: 650`) using Geist's variable axis (no faux
  bold). The ramp below is the post-bump scale.

| Role | Size / weight / tracking | Notes |
|---|---|---|
| Display | 45–54px · 600 · -0.02em · lh 1.05–1.08 | hero, section metrics; `text-balance`, max 2 lines |
| Heading | 26–30px · 600 · -0.01em | section titles |
| Title | 16px · 500 | panel/card titles |
| Body | 15px · 400 · lh 1.5 | copy, max ~52ch |
| Body-sm | 13–14px · 400 | secondary copy |
| Caption/label | 11–12px · 500 · uppercase · 0.12–0.16em | panel headers, stat labels |
| Numeric | Geist Mono · tabular | all data |

---

## 4. Spacing, radius, elevation

- **Spacing:** 4px base. Scale 4 · 8 · 12 · 16 · 24 · 32 · 48; section rhythm 64–96px (`py-16`→`py-20`).
- **Radius (ONE system, Shape Lock):** controls/inputs/buttons `6px` (`sm`), panels `10px` (`md`),
  large surfaces `14px` (`lg`), chips/badges/toggles `pill`. Tight radii read as "terminal."
- **Elevation:** hairline borders carry hierarchy. No drop shadows on the dark base; the only depth
  cues are surface steps (`surface-1` → `-2` → `-3`) and 1px borders. Panels group by `divide`/
  `gap-px` on a `hairline` background (creating crisp interior rules) rather than nested cards.
- **Grid backdrop:** an opt-in `.grid-backdrop` (64px hairline grid) sits behind the hero only, at
  low opacity, to evoke a terminal without noise.

---

## 5. Motion (meaning only)

- Durations: 120ms (micro), 150–180ms (hover/color), 280–500ms (gauge/width transitions).
- Easing: `--ease-out-expo` cubic-bezier(0.16,1,0.3,1) for entrances; `--ease-standard`
  cubic-bezier(0.4,0,0.2,1) for state.
- Tactile: buttons nudge `translate-y-px` on `:active`.
- **`.pulse-once`** — a single ring pulse, applied imperatively **only when a real SSE event
  arrives** (fill, fee accrued, deposit). Never on a loop, never decoratively.
- `.skeleton` shimmer for loading. `prefers-reduced-motion: reduce` collapses all animation and the
  shimmer to static. Numbers/gauges update without layout shift.

---

## 6. Component inventory (built; see `/design`)

- **Logo / Wordmark** — a simple geometric mark: a vault bracket split by the accent "covenant line"
  binding two seals. No gradient, no glow.
- **Button** — variants `primary` (azure), `secondary` (hairline), `ghost`, `danger` (red); sizes
  sm/md/lg; `ButtonLink` for internal/external links. Active-nudge, disabled, full contrast AA.
- **Badge / StateBadge** — semantic pill (accent/pass/fail/warn/idle/neutral); `StateBadge` maps the
  mandate lifecycle (CREATED→SETTLED) to its tone. Dots used only for real state.
- **Panel / PanelHeader** — the core surface: hairline-bordered charcoal panel with an uppercase
  label header (title + hint + right-aligned actions).
- **Stat** — labelled numeric readout, tabular, with optional unit/sub and semantic tone.
- **AllowanceGauge** — net sold / cap this window; fill goes accent → amber (≥75%) → red (≥90%).
- **KpiTimeline** — intervals as dense cells: green paid · red failed · grey unobserved · striped
  amber paused. Hover title explains each. The plainest honest compliance history.
- **OrderBookMini** — asks (red) above, bids (green) below, mid + shaded band; the vault's own
  orders marked with an accent tick; out-of-band levels dimmed.
- **FlagshipPanel** — the live landing mini-dashboard: reads `/config` + `/proof` (real data),
  shows the honest idle state when `botsOn` is false ("active Xh ago"), the compliance record,
  allowance, fees, and the on-chain resting book. Refreshes on an interval (SSE lands in M2).
- **SiteNav / SiteFooter** — single-line ≤64px nav; footer with GitHub, Sourcify-verified contract
  links, and docs.
- **ThemeToggle** — nav icon button (sun/moon, `aria-label`, keyboard-accessible) cycling
  light/dark; default follows system, choice persists in `localStorage`, applied pre-paint (no FOUC).

---

## 7. Guardrails (enforced)

- Accessibility: visible accent focus ring (keyboard-first), AA contrast on text and CTAs, aria
  labels on icon-only controls, semantic headings.
- Responsive: landing + proof fully mobile (390px verified); dashboards desktop-first but usable at
  390px via single-column collapse.
- No layout shift on live updates; numbers formatted via `@covenant/shared` formatters.
- **Zero em-dashes** in any visible string (uses periods, commas, middots, parentheses).
- Icons: Phosphor only, one family, consistent weight. No hand-rolled icon paths.
- No stock imagery — the product's own live data (books, gauges, timelines) is the visual.

---

## 8. Banned (AI-slop) — actively avoided

Purple-blue gradients, glassmorphism, glowing blobs, emoji in UI, generic 3D illustrations,
"web3" hexagons, meaningless sparkle loops, centered-everything hero templates, walls of identical
cards, div-based fake screenshots, decorative status dots, section-number eyebrows, em-dashes.
