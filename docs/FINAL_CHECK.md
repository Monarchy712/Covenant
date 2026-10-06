# Covenant — Final pre-submission audit

Date: 2026-10-06 · Audited against the live app (`covenant-sandy.vercel.app`) + the Railway API +
on-chain reads. PASS/FAIL per item, with evidence. Items fixed during the audit are marked **(fixed)**.

> Note on scope: the frontend light-theme work is committed-but-not-yet-deployed, so the **live
> site audited here is the pre-theme deployment** (the same build that passed the documented
> `docs/FRONTEND_QA.md` run-2 on 2026-10-05). On-chain contracts/backend are current.

---

## LIVE PRODUCT

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | Landing loads with no wallet | **PASS** | HTTP 200; renders hero + flagship panel with no connected wallet. |
| 2 | Flagship panel shows full history (~90/90) | **PASS** | Flagship panel: **90/90 intervals paid, 182 checkpoints, 0 failed**, fees 4,500 USDC (restored by the backfill). |
| 3 | Every nav/footer link resolves | **PASS** | Internal routes all 200 (`/proof` 307 → its flagship redirect, intentional). External: GitHub repo, `PRODUCT_FLOW.md`, `README.md`, Kuru docs, Sourcify (factory + vault impl) all 200. |
| 4 | No console errors on any page | **PASS** | Landing + proof: zero console errors. |
| 5 | Proof page works with no wallet | **PASS** | `/proof/<flagship>` renders all figures (90/90, net-sold 9.89/1,000, ±2% band, 50 USDC fee) with no wallet. |
| 6 | Proof page on mobile (390px) | **PASS** | At 390px: `document.scrollWidth == 390`, no horizontal overflow. |
| 7 | **J1** judge launch + house-MM first quote | **PASS** | Fresh burner → demo-wallet funded (treasury drip) → wizard → launched `0xFdbd62a2…879C16a1` ACTIVE. Steps confirmed in 2.8 / 1.5 / 2.5 / 1.8 s; **house MM posted a two-sided quote (BID 2.003×50 / ASK 2.015×50) ~22 s after activation.** Activity feed indexed the funding events within 7–11 s. |
| 8 | **J2** Send-anyway → reverted tx + decoded Blocked card | **PASS (run-2)** | Verified on-chain in `FRONTEND_QA.md` run-2 (2026-10-05): real reverted tx `0xbf3ab7d8…346a` (status 0x0), decoded `SellAllowanceExceeded`. The decoded Blocked card is live on the landing today with a real reverted-order example; MM-console preflight + "Send anyway" confirmed present on the live deploy. |
| 9 | **J3** widen → checkpoint FAIL → fee frozen | **PASS (run-2)** | `FRONTEND_QA.md` run-2: `checkpoint()` tx `0xe47b3bc9…951` → passed=false, consecutiveFails↑, accruedFees=0, dashboard "Frozen this interval". MM-console "If a checkpoint ran now" panel confirmed live this audit (shows PASS on the J1 mandate: two-sided, spread 0.6% vs 1% max, depth 90). |
| 10 | **J4** trade → fill hits the vault | **PASS (path proven) ⚠ finding** | Trade→fill→vault proven live: the flagship's **net-sold 9.89** comes from real taker fills (and run-2 moved a test vault's net-sold to 9.68). **Finding:** my fresh trade-panel buys this audit failed with transient Monad RPC `"Missing or invalid parameters"`; the trade panel does not auto-retry that class of error (the backend's `getLogsRetry` does). See Recommendations. |
| 11 | **J5** terminate → withdraw → correct receipt | **PASS (run-2)** | `FRONTEND_QA.md` run-2: terminate (two-step) → ENDED → withdraw → SETTLED; issuer received **+400 base and +1,000 quote** (inventory + proceeds + unused escrow), matching the chain exactly. (The settlement-receipt *display* fix is in the pending frontend deploy; the on-chain settlement is correct.) |
| 12 | /health: status ok | **PASS** | `status: ok`, dbPath `/data/covenant.db`, forward indexer at head (lag ~16). |
| 13 | /health: backfill done | **PASS (fixed)** | Backfill completed (data present: 90 intervals, 182 checkpoints). `/health.backfill.done` read `false` after a service restart (in-memory status reset). **(fixed)** `maybeResumeOnBoot` now reflects the persisted completion so `/health` reports `done:true` after a restart. |
| 14 | Every wallet above threshold | **PASS (fixed)** | keeper 15.1, faucet 3.79, seeder 19.7, treasury 48.67, **house MM 13.7** (on-chain) — all above their treasury thresholds. **(fixed)** the house-MM / demo-issuer / taker wallets are now added to `/health.balances` (previously only keeper/faucet/seeder/treasury were listed). |
| 15 | Treasury balance + runway | **PASS** | Treasury **48.67 MON**. Idle burn ≈ 0 (flagship bots off), so it lasts indefinitely while idle. Under judging it's the demo driver (see Recommendations) — ~0.6 MON per full demo + drips ⇒ the current ~48.7 MON (plus ~48 MON of service-wallet buffers the treasury can recycle) covers **~10 days at 8–10 demos/day without a refill**, tight; a top-up is recommended. |
| 16 | Flagship ACTIVE until ≥ Oct 25 | **PASS** | On-chain snapshot: **ACTIVE, ends 2026-10-28 19:20 UTC** (22.9 days left). Activated 2026-09-28. |

### J-journey note
J1 was run fresh end-to-end on the live URL this audit. J2/J3/J5 are cited from `docs/FRONTEND_QA.md`
run-2 (2026-10-05, on the same deployed build) with on-chain tx hashes, and their live UI mechanisms
were confirmed present this audit. Re-running J2/J3/J5 fresh would create 2–3 more demo mandates; the
documented evidence + live-mechanism confirmation was judged sufficient. 2 demo mandates were used
this audit (J1 + the earlier backfill-verification session's burner).

---

## REPO + RULES

| # | Item | Result | Evidence |
|---|---|---|---|
| 17 | Repo public | **PASS** | `github.com/Monarchy712/Covenant` returns 200 unauthenticated. |
| 18 | MIT LICENSE present | **PASS** | `LICENSE` at root, "MIT License". |
| 19 | gitleaks clean over FULL history | **PASS** | `gitleaks detect` v8.21.2 over all 55 commits → **"no leaks found"**. Manual scan also found 0 private-key values; `.secrets/` and `.env` never committed; `PRIVATE_KEY_TREASURY` value never in history. |
| 20 | `.secrets/` + treasury key never committed | **PASS** | `.secrets/` gitignored, 0 commits touch it; `.env` 0 commits; treasury key string absent from history. |
| 21 | Vercel env only `NEXT_PUBLIC_` non-secret | **MANUAL** | Code reads only `NEXT_PUBLIC_API_URL` (optional; defaults to the Railway URL). No secret is needed client-side. **Verify in the Vercel dashboard** that no non-`NEXT_PUBLIC_` secret was added (see By-hand). |
| 22 | README: pitch | **PASS** | Opening pitch + track. |
| 23 | README: architecture diagram | **PASS** | Mermaid flowchart (Issuer → Factory → Vault → Kuru; Indexer → API → Frontend). |
| 24 | README: Why Monad w/ measured numbers | **PASS** | "Why Monad" + gas-on-limit × 1.15, 102 gwei, sub-second blocks. |
| 25 | README: setup | **PASS** | Foundry (`forge build/test`) + pnpm (`pnpm install`, `dev:services`) sections. |
| 26 | README: ALL current addresses (latest factory + flagship) | **PASS (fixed)** | **(fixed)** README was missing the current flagship vault, market, base, quote, house MM, and the frontend live URL. Added a complete current-address table + live URL; marked the old Kuru/env addresses as Phase 0/1 provenance. |
| 27 | README: Sourcify links — LATEST factory + vault impl verified | **PASS** | Factory `0x49dc…34E4` (matches `/config`) and vault impl `0x9879…b18d` both **Sourcify exact_match** (verified 2026-09-27). The flagship is an **EIP-1167 clone of `0x9879`** (bytecode confirmed), so these are the latest in use, not earlier ones. Sourcify lookup links added. |
| 28 | README: live URL | **PASS (fixed)** | **(fixed)** `https://covenant-sandy.vercel.app` added near the top and in the addresses section. |
| 29 | README: AI coding disclosure | **PASS** | Explicit disclosure (built with Claude Code). |
| 30 | README: spike folder marked as in-window pre-build validation | **PASS** | "Pre-build validation (spike)" section points at `src/KuruIntegrationSpike.sol`, `TECHNICAL_SPIKE_REPORT.md`, `DAY_1_DECISION.md`. |
| 31 | Commit history inside Sep 1 – Oct 13 window | **PASS** | 55 commits, first 2026-09-23, last 2026-10-06 — all within the window. |
| 32 | Docs consistent (no stale addresses/claims) | **PASS** | Current flagship `0x2719…` and factory `0x49dc…` referenced consistently in README/PROGRESS/WALKTHROUGH/OVERVIEW/FRONTEND_QA; no doc claims a different "current" flagship. |

---

## Fixes applied during this audit (code — needs redeploy)
- `services/src/index.ts` — add house-MM / demo-issuer / taker to `/health.balances` (item 14).
- `services/src/backfill.ts` — `/health.backfill.done` reflects persisted completion after a restart (item 13).
- `README.md` — current-address table, live URL, Sourcify lookup links (items 26/28).

(Services typecheck: 0 errors.)

## Recommendations / known findings
- **Trade-panel transient-RPC retry (item 10).** The public Monad RPC intermittently returns
  "Missing or invalid parameters" on `estimateGas`/market-order calls; the backend retries this, the
  **trade panel does not** — a judge can see "Transaction failed" and must retry. Recommend adding a
  small estimateGas/send retry in the frontend trade path (and/or pointing the app at a dedicated
  RPC). Not changed here (frontend is mid-deploy; "no new features").
- **Committed `.next` build in history** (2 commits, now gitignored) — harmless library code (no
  secrets), but it bloats the clone. Optional: `git filter-repo` to strip it (history rewrite).

## DEMO_DAILY_CAP + treasury budget for Oct 11–20 (judging window)
- Per-demo treasury cost: a full role=mm demo ≈ **~0.6 MON** (0.2 drip + demo-issuer funding + keeper
  checkpoints); cheaper roles (trader/issuer) ≈ ~0.22 MON. Drips are already capped by
  `faucetDailyMonBudget` (5 MON/day ≈ 25 unique wallets/day).
- **Recommended settings (Railway env):**
  - `DEMO_DAILY_CAP=10` (up from 8) — don't block a busy judging day; still bounds burn.
  - **Top the treasury to ~100 MON before Oct 11** (currently 48.67). At cap 10/day × ~0.6 MON +
    drips ⇒ ~8–10 MON/day; 100 MON gives the full 10-day window a comfortable margin.
  - `FAUCET_IP_PER_24H=5` (already set) is fine; bump `faucetDailyMonBudget` to ~8 MON only if you
    expect >25 unique judges/day.
  - Watch `/health` → `treasury.low` (warns < 15 MON); refill if it dips below ~20 MON mid-window.
