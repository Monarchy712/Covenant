---
name: design-references
description: A curated library of real-world DESIGN.md breakdowns (color, typography, spacing, motion, layout) for 70+ top product/brand sites — Linear, Vercel, Stripe, Apple, Notion, Raycast, Framer, Supabase, and more. Consult this BEFORE building any frontend UI to ground palette, type scale, spacing, and motion choices in a concrete, real reference instead of generic AI defaults.
metadata:
  source: https://github.com/voltagent/awesome-design-md
  count: "74"
---

# Design references (DESIGN.md library)

A local mirror of [voltagent/awesome-design-md](https://github.com/voltagent/awesome-design-md):
per-brand `DESIGN.md` teardowns of how real, well-regarded sites handle **color, typography,
spacing, layout, motion, and component styling**. Use these as concrete design references so
generated UI reflects a deliberate, real aesthetic — not AI-slop defaults.

## When to use
- Before starting **any** frontend screen: pick 1–2 references whose vibe matches the brief and
  read their `DESIGN.md` to lift a real type scale, palette structure, spacing rhythm, and motion.
- When a design read (see the `taste-skill` / `design-taste-frontend` skill) names a vibe
  ("Linear-clean", "Stripe-trust", "Raycast-dark-tech", "editorial"), open the matching reference.
- When choosing typography or a color system and you want a proven starting point instead of
  Inter + slate-900.

## How to use
1. Match the brief's vibe to a reference below (or 2–3 for a blend).
2. Read `references/<brand>/DESIGN.md` (some also have a `README.md`).
3. Extract the *principles* (type scale ratios, neutral ramp, accent usage, spacing unit, motion
   easing/durations) — adapt them to Covenant's own brand; never copy a brand's identity verbatim.

## Reference index (`references/<name>/DESIGN.md`)

**Dev-tool / SaaS (clean, technical — good fit for Covenant's issuer/MM console):**
linear.app, vercel, stripe, supabase, raycast, framer, notion, posthog, resend, sentry,
mintlify, warp, cursor, replicate, sanity, mongodb, clickhouse, hashicorp, composio, opencode.ai,
together.ai, ollama, expo, webflow, zapier, intercom, figma, miro, cal, lovable, superhuman

**AI / frontier labs (dark-tech, gradient-restraint):**
claude, mistral.ai, minimax, x.ai, elevenlabs, runwayml, cohere, nvidia, meta

**Fintech / trading (trust-first, dense data — relevant to an on-chain trading product):**
stripe, coinbase, kraken, binance, revolut, wise, mastercard, robinhood-adjacent (see revolut/wise)

**Consumer / brand (bold, editorial, motion-forward):**
apple, nike, spotify, airbnb, pinterest, uber, starbucks, shopify, tesla, spacex, playstation,
nintendo-2001, theverge, wired, vodafone, hp, ibm, dell-1996

**Automotive (premium, cinematic):**
bmw, bmw-m, bugatti, ferrari, lamborghini, renault

Full list lives under `references/`. Each entry is self-contained.

> Provenance and license: `references/_SOURCE_README.md`. These are third-party analyses used as
> design references only.
