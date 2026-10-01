# Covenant — PROGRESS

Living tracker. Update at the end of every milestone.

## 1. Status at a glance
- **Last updated:** 2026-09-30
- **Current phase:** backend complete + hosted; flagship deployed; **frontend M1 done (design
  system + landing), awaiting review**

### Frontend M1 — design system + landing (2026-09-30)
- **Stack:** `apps/web` (pnpm workspace) = Next.js 14 App Router + React 18 + Tailwind v4 +
  TanStack Query, consuming `@covenant/shared`. wagmi/RainbowKit deferred to M2 (landing needs no
  wallet). Single locked dark theme.
- **Design direction:** institutional trust + trading-terminal precision. References: **Linear**
  (near-black canvas, hairline panels, accent-for-meaning) + **Stripe** (tabular figures where
  money matters). One azure accent (`#4c8dff`); semantic colors carry meaning only (green=paid,
  red=blocked, amber=paused, grey=idle). Geist Sans + Geist Mono (tabular). Docs: `apps/web/DESIGN.md`.
- **Built:** `/design` (tokens + full component inventory) and `/` (landing). Components: Logo,
  Button, Badge/StateBadge, Panel, Stat, AllowanceGauge, KpiTimeline, OrderBookMini, FlagshipPanel,
  SiteNav, SiteFooter.
- **Landing is live-data-real:** the hero's FlagshipPanel reads `/config` + `/proof/:vault` from the
  hosted API and does an on-chain `getOrderBook` read. Verified showing 90 intervals paid, 182/182
  observed, 4,500 USDC accrued, 0.5% of cap sold, all-green KPI timeline, resting book with vault
  orders marked. Honest idle state when `flagship.botsOn` is false ("active Xh ago").
- **Verified:** `pnpm build` + `pnpm typecheck` green; Playwright screenshots at 1440 + 390
  (`apps/web/docs/screens/`); web-design-guidelines audit run + fixes (skip link, touch-action,
  aria-hidden on decorative icons, aria-live on live panel, 2-line balanced hero headline).
- **Review revisions (approved M1 + change list):** flagship header shows LIVE only when
  `botsOn`, else "on-chain" + idle badge; merged intervals stat ("90/90 · 182 checkpoints, 0
  failed"); right column now a **real on-chain event feed** (`/mandates/:vault/events`) with tx
  links, book moved under the stats; "Why Monad" retitled + precise ("best in EVM, not the only
  venue") with measured figures (0.31s block, 102 gwei fixed, ~550k gas/two-sided quote, 1 tx/
  requote); a real **Blocked by contract** card in the mechanism section (decoded
  `SellAllowanceExceeded` 39.96+5,060+5,000 > 1,000 from `docs/E2E_RUN.md`; links the vault since
  the oversized sell reverts pre-trade with no mined tx); contrast pass (readable text ≥ ink-subtle);
  hero CTAs = 2 buttons + text link; final CTAs full-width on mobile; internal routes
  (`/start /create /explore /proof`) now resolve via placeholders (built out in M2–M6); all
  external links verified 200.
- **Review round 2 (landing fixes):** (1) blocked-card math corrected to match the contract check
  `netSold + restingAfter > cap` where `restingAfter` already includes `requested` (existing
  resting was 60, not 5,060; shown as "39.96 net-sold + 60 resting + 5,000 requested > 1,000 cap",
  no double-count); (2) flagship book now read **server-side from `/mandates/:vault/summary`**
  (reliable REST, no flaky browser RPC/CORS) and **hidden entirely** when the vault has no resting
  orders (never "flat while idle"); dropped the client viem read → landing bundle 91.6kB → 13.3kB;
  (3) "Why Monad" cards: confirmation-latency headline (~0.3s now, note that M2's TxProgress
  replaces it with the live median), 102 gwei "measured constant" (verified: `eth_gasPrice`
  returns a constant 102 gwei), gas+MON moved into the cost card caption; (4) the merged stat's
  detail is now a full-width sentence line, no mid-phrase wrapping.
- **⚠ FLAG for M5 (shared package bug):** `@covenant/shared` `ERROR_MESSAGES.SellAllowanceExceeded`
  (in `packages/shared/src/errors.ts`) reads "net-sell {a0} + resting {a1} + requested {a2} > cap"
  which **double-counts** — `a1` (restingAfter) already includes `a2` (requested). The MM console's
  "Blocked by contract" card (M5) uses `decodeCovenantError`, so this needs a one-line fix in shared
  to `net-sell {a0} + resting-after-this-order {a1} > cap {a3}` (or decompose a1−a2). Not changed
  yet — flagged per the "don't hack around shared, tell me" rule.
### Frontend M2 — wallet + useCovenantTx/TxProgress + /start (2026-10-01, overnight)
- **Wallet model:** custom `WalletProvider` on viem (not RainbowKit — no WalletConnect projectId per
  decision). Two signers: injected (MetaMask; auto add+switch to chain 10143) and an in-browser
  **demo burner** (viem local key in localStorage, funded via `POST /demo/session`, signs with no
  popups). `WalletButton` in the nav: connect menu + account menu (copy, faucet, export key testnet-
  only, reset, disconnect). `NEXT_PUBLIC_WC_PROJECT_ID` read from env for later.
- **`useCovenantTx` + `TxProgress`:** preflight (estimate/allowance) → approvals as visible sub-steps
  → sign → pending → confirmed with **confirmation latency** ("Confirmed in X.Xs") + explorer link;
  transient-RPC retry once; decoded reverts via `decodeCovenantError`, including the mined
  "Send anyway" case that surfaces a **Blocked by contract** card. Built + typecheck-clean; first
  live write exercised in M3.
- **`/start?role=issuer|mm|trader`:** wallet choice → funding → routing (issuer→/create,
  mm→/invite/[vault], trader→/proof/[vault]). Friendly rate-limit/error fallbacks (explore the live
  flagship), never a dead end.
- **Shared fix:** `ERROR_MESSAGES.SellAllowanceExceeded` no longer double-counts (restingAfter
  already includes requested); graceful empty-args for preflight; unit test in
  `services/test/shared-errors.test.ts` (2 passing).
- **Verified (Playwright):** landing → /start → demo wallet → `POST /demo/session` 200 → /create;
  nav shows the burner address with a working account menu. Build + typecheck green. Screens in
  `docs/screenshots/m2/`. Also: untracked `apps/web/.next` from git.
### Frontend M3 — create wizard + issuer home (2026-10-01, overnight)
- **`/create`** 4-step persisted wizard: token & market (demo token default) → terms (presets +
  sliders + 3 live panels: plainEnglishTerms, band illustration, fee-budget estimate) → market
  maker (house MM default / invite) → fund & launch. **Launch** runs `useCovenantTx` as a live
  checklist: create → approve+deposit base → approve+fund fees → wait for MM acceptance → activate;
  the new vault is decoded from `MandateCreated` and routes to `/mandate/[vault]`.
- **`/app`** issuer home: mandate rows (`/mandates?issuer=` + per-vault `/summary`) with state,
  net-sold gauge, fees, time-left; teaching empty state; connect prompt.
- **Fixed a real wallet bug:** `useCovenantTx` was passing `account: <addressString>` to
  `writeContract`, forcing node-side signing for the local burner ("RPC Request failed"). Now uses
  `wallet.account`. Also hardened for Monad's flaky RPC (retry reads/estimates, gas fallback).
  Proven on-chain: a manual `createMandate` from the burner succeeded (`0x498474…`).
- **Fixed `plainEnglishTerms`** to show minutes/hours for sub-day durations.
- **Verified:** typecheck + build green; wizard steps 1–4 + `/app` screenshotted (`docs/screenshots/m3/`).
- **⚠ BLOCKER for live demo (needs Railway):** the **faucet is out of MON** — it mints tokens but
  the MON drip reverts, so demo burners can't pay gas for any write. Top up `PRIVATE_KEY_FAUCET`
  with MON. This blocks the full live launch/quote/trade path for demo wallets.
### Frontend M4 — mandate dashboard (2026-10-01, overnight)
- **`/mandate/[id]`** hero dashboard, verified live against the flagship: status bar (state,
  time-left, MM, Enforced-by-contract chip to Sourcify), flow strip (pulses only on real SSE
  events), order book (spread + band + vault orders marked), net-sold gauge (window reset +
  buyback note), KPI timeline, fees (escrow/accrued/claimed + frozen indicator), live activity
  feed with tx links, settlement receipt for ENDED/SETTLED. SSE via `useSSE`. Issuer controls
  (pause / two-step terminate / withdraw gated on openOrders==0) built, not live-tested (need MON).
### Frontend M5 — invite + MM console (2026-10-01, overnight)
- **`/invite/[id]`:** plain-English terms, "what you can do" / "what the contract will block",
  "how you get paid", `accept` (pins termsHash); state-aware redirect to the console once accepted.
- **`/mm/[id]` console:** quote ticket (nudges: match-mid/tighten/widen), **live preflight badge**
  (green/red decoded, verified live: oversized ask → red "would exceed the net-sell cap" + reveals
  **Send anyway**), **Blocked by contract** card on a reverted send (fixed `decodeCovenantError`),
  **"If a checkpoint ran now"** PASS/FAIL from the live book, earnings + claim.
- **`/mm`:** MM desk listing invitations/active mandates.
- **Verified live** against the flagship (reads); writes (accept/quote/claim) need MON. Screens in
  `docs/screenshots/m5/`.
### Frontend M6 — proof + trade + badge + explore (2026-10-01, overnight)
- **`/proof/[id]`** public, no-wallet proof: live stats with per-value verify links, net-sold gauge,
  compliance timeline, activity feed, permissionless "Checkpoint now", demo-wallet trade panel,
  embeddable SVG badge + copy-embed/share. **`/badge/[id]`** SVG route. **`/explore`** lists all
  mandates (verified: flagship + the accepted test mandate). **`/proof`** redirects to flagship proof.
- **Verified live** (reads) against the flagship; trade/checkpoint need MON. Screens `docs/screenshots/m6/`.
- **NEXT (M7):** Playwright journeys + web-design-guidelines audit fixes + Vercel deploy prep.
- **Deadline:** Oct 13, 11:59 PM ET · **target submit:** Oct 11 · **judging through ~Oct 25**
- **Track:** Onchain Finance & Trading

### Flagship + cost strategy (2026-09-29)
- **Flagship mandate** `0x27199bf4D9b8B2c4bD509e642ea7Be9C58f85408` — 30-day duration (ends ~Oct 28,
  covers judging), 10-min KPI interval, 1-hr net-sell window, **full 216,000-USDC escrow** (all
  4,320 intervals), created @ block **66487803**. ACTIVE with a seeded resting book. Superseded
  the old flagship `0xaF7CcA…` (terminated).
- **Monad testnet gas is a fixed 102 gwei** → 24/7 bots for 30 days is infeasible (~450+ MON).
  So: flagship stays **ACTIVE + IDLE** (resting book + on-chain snapshot; unobserved intervals are
  neutral, `CovenantVault._finalizeUpTo` → no breach). Liveliness is **on-demand**:
  - **Always-on (→ Oct 20):** faucet + indexer/API + house MM + keeper serve **only user-created
    demo mandates** (`/demo/session`), capped 15-min duration + **8/day** → ~1.7 MON/session,
    ~0 when idle. Flagship excluded via the switch.
  - **Oct 11–16 burst:** flagship bots 24/7 throttled (~77 MON; top-ups in §6).
  - **One-command switch:** `POST /admin/flagship {on}` (ADMIN_TOKEN) or `FLAGSHIP_BOTS=on` —
    gates house MM + keeper + taker on the flagship for the video/judging.
- Landing page reads `/config.flagship` `{vault, botsOn, lastActiveTs}` to show an honest
  "last active" state when idle (never a broken/empty book).

### Hosted (Day-4 deploy) → `docs/SOAK_REPORT.md`
- **LIVE:** `https://covenantservices-production.up.railway.app` (Railway, Docker). Verified from outside: `/health` ok, `/config`, `/markets`, `/summary`, `/proof`, SSE (heartbeat + Last-Event-ID resume).
- **Soak PASS:** autonomous loop (house-MM+taker+keeper+indexer), full lifecycle via hosted API to the blocked oversized sell + a paid interval, SSE resume, seeder-keeps-book, restart recovery. Full settlement→SETTLED proven in `docs/E2E_RUN.md`.
- **Fixes shipped during soak:** Docker `tsconfig.base.json` copy; `db.ts` mkdir; indexer `INDEXER_START_BLOCK` cold-start; demo-issuer wallet separation; `/demo/reset` wait-for-accept; seeder cheap-repost; `estimateGas` retry.
- **Known:** Monad public RPC intermittently flaky (mitigated w/ retry); keeper cost scales with active mandates; no persistent volume (idempotent re-index on restart).

### Day-4 status (this session) → `BACKEND_REPORT.md`
- **DONE:** Part 1 wallet separation; Part 2 seeder auto-deposit + drifting book; Part 3 house MM (auto-accept invited mandates + honest quoting); Part 4 role-based `/demo/session` + admin `/demo/reset`; **Part 5 frontend integration surface** (actions/utils/reads + `docs/FRONTEND_INTEGRATION.md`, 17 tests incl. live round-trips); **Part 6 live settlement proof** (`pnpm e2e:full` → SETTLED, exact balances, `docs/E2E_RUN.md`); Part 7 API (`/config`,`/markets`,`/summary`,`/proof`) + SSE resume/heartbeat + `/health` 503 + graceful shutdown + CORS/ADMIN_TOKEN; Part 8 Dockerfile+railway.json prepared; Part 10 MIT LICENSE + clean secret scan + **contracts Sourcify-verified (exact_match)** + README pitch/architecture.
- **REMAINING / NEEDS SAMYAAK:** (1) dedicated funded `PRIVATE_KEY_FAUCET` (currently == DEPLOYER) + top up DEPLOYER — needed for the live demo mm-role + hosted soak; (2) **Part 8 Railway deploy** + (3) **Part 9 hosted 60-min soak** (steps in `BACKEND_REPORT.md`). Optional TODO: block-timestamp backfill cache.
- **NEXT:** the frontend (wire buttons to `@covenant/shared` per `docs/FRONTEND_INTEGRATION.md`).

## 2. Timeline
- **Sep 22** — Meter killed → Covenant chosen.
- **Sep 23** — Technical spike **PASS** (contract can own a Kuru MM position; live on testnet). → `TECHNICAL_SPIKE_REPORT.md`, `DAY_1_DECISION.md`, `docs/KURU_ARCHITECTURE.md`.
- **Sep 24 (contracts)** — `CovenantFactory` + `CovenantVault` done; 97 tests + 4 invariants; live testnet deploy. → `CONTRACTS_REPORT.md`.
- **Sep 24 (services)** — keeper / indexer / API / faucet / bots + demo fixture; live soak passed. → `SERVICES_REPORT.md`.

## 3. Done
- [x] Kuru integration spike — GREEN, live txs → `TECHNICAL_SPIKE_REPORT.md`
- [x] Vault + Factory (roles, state machine, quote/band/cap/net-sell governor, fail-dominant checkpoint, fee escrow, pause/terminate/withdraw, snapshot/previewQuote) → `CONTRACTS_REPORT.md`
- [x] `accept(bytes32 termsHash)` terms-lock (Step 0) + 4 tests
- [x] 101 Foundry tests (97 unit/state/adversarial + 4 invariants) pass on a real-Kuru testnet fork
- [x] pnpm workspace + `packages/shared` (ABIs, addresses, chain, types, error decoder) for the frontend
- [x] Indexer (SQLite, chunked getLogs, idempotent, fill attribution via `Trade.makerAddress`)
- [x] REST + SSE API
- [x] Keeper (poke at window boundary, random ≥2 checkpoints/interval, cancel+finalize after ENDED)
- [x] Faucet + demo sessions (rate-limited)
- [x] Seeder / MM (honest + malicious) / taker bots
- [x] `pnpm demo:setup` fixture (short windows) → live demo mandate
- [x] 9 vitest unit tests + live soak (honest interval paid; malicious → blocked sell + failed checkpoint) → `SERVICES_REPORT.md`

## 4. In progress
- (none — services milestone closed)

## 5. Next (ordered)
1. **Frontend** (Next.js + wagmi + RainbowKit), screen by screen per `docs/PRODUCT_FLOW.md`:
   landing `/` → start/faucet `/start` → issuer home `/app` → create wizard `/create` →
   mandate dashboard `/mandate/[id]` (hero) → MM invite `/invite/[id]` → MM console `/mm/[id]` →
   public proof `/proof/[id]` → trade panel. Wire to the API + SSE + `@covenant/shared` error decoder.
2. **Hosting** — deploy API (Railway/Fly/render) + frontend (Vercel); point frontend at the API.
3. **Polish** — flow animation on real SSE events, empty/loading/error states, mobile proof page.
4. **Video** ≤ 3:00 (demo script in `PRODUCT_FLOW.md` §14).
5. **Submission.**

## 6. Blocked / needs Samyaak
- **Dedicated service keys:** the soak reused ATTACKER as the keeper and DEPLOYER as faucet/seeder. For hosting, create dedicated funded `PRIVATE_KEY_KEEPER` / `PRIVATE_KEY_FAUCET` wallets and top them up.
- **Wallet funding:** DEPLOYER ~ a few MON left after redeploys + demo; top up before more testnet runs.
- **Kuru bounty text:** confirm the exact bounty wording/requirements to target.
- **Hosting choice:** confirm where to host the API + frontend.

## 7. Open decisions (with what was decided)
- **2026-09-24 — Terms lock:** `accept(termsHash)` pins `keccak256(abi.encode(terms))`; any CREATED edit invalidates a stale acceptance. DECIDED + built.
- **2026-09-24 — AMM-vault fills against vault orders:** ALLOWED (band uses the AMM-inclusive mid; fills are fair). DECIDED + documented.
- **2026-09-24 — Quote token == fee token:** MockUSDC on testnet; Monad-native USDC on mainnet (not built). DECIDED.
- **2026-09-24 — Checkpoint = fail-dominant** (overrode the earlier PRODUCT_FLOW design). DECIDED + built.
- **Still open:** mandate-mutability scope confirmation; hosting; dedicated service wallets; Kuru bounty text.

## 8. Deployed addresses (testnet, chain 10143) — addresses only, NEVER keys
**Flagship mandate (current `deployments/testnet.json`, `pnpm flagship:deploy` @ block 66487803):**
- Factory: `0x49dcD18CdACB881070Afb90f0b992ad7afac34E4`
- **Flagship vault: `0x27199bf4D9b8B2c4bD509e642ea7Be9C58f85408`** (30-day, full escrow, ACTIVE)
- Market: `0x1429116A9795FC921bb3Bc735a656B55804714c6`
- Base (mBASE): `0xC5652d30758EaF1e0ABA2Fa46e3fB069d6f33617`
- Quote (mUSDC): `0x2968F6Ab34415bBF6D8cB72e25c3578B5796A60c`
- Superseded flagship (terminated): `0xaF7CcA436AD2ECaEcbD2A969C8bDd1B3387C1b46`

**Earlier factory (Step-0 redeploy, superseded by the demo):** `0x31E00E955908AAC109C801A72A9022A5C9B849B6`
**Kuru testnet (reused):** Router `0x7EFbE105Ca7415dE98F96622173458ac1c054630`, MarginAccount `0xd029C2D98ff85D8F64799017fE00a59B1159CE02`

**Service wallets (addresses only):**
- Keeper (soak: = ATTACKER): `0x6d11172f538b60BE3a69c745944767Ac94019df7`
- Faucet / Seeder (soak: = DEPLOYER): `0xa34118bD1A2A789A962A4471C59c3964fb716123`
- MM bot: `0x687dFEcC7eAaFA4DC28f72Bfb9cdB77cAe18a641` · Taker bot: `0x7A0A94615094Ef0673f2D0F031D43fB9ED78cc0B`

## 9. Risks
- **GREEN** — contract layer (101 tests, invariants, live). Kuru integration (proven).
- **GREEN** — services pipeline (live soak: fee paid, blocked sell, failed checkpoint, events in API/SSE).
- **GREEN** — Monad testnet clock is stable. Measured 2026-09-29: 214,765 blocks over 66,224s =
  **0.308 s/block, constant** (continuity samples at deploy+1, deploy+1000, and head all ~0.31 s/blk;
  chain clock == wall clock ±4s). Earlier "block.timestamp jumped ~15h" claim was WRONG — it was
  a misread of elapsed time. So `block.timestamp`-based terms (flagship 30-day duration, 10-min
  intervals, 15-min demo mandates) track real time reliably; flagship ends ~Oct 28.
- **YELLOW (operational, fixed)** — a bounded burst was launched as `timeout <s> pnpm start`, which
  only SIGTERMs the `pnpm` parent; the `tsx` child was orphaned and ran ~18h, draining keeper (→2.5)
  and one bot wallet. **Safeguard added:** `pnpm --filter @covenant/services flagship:burst`
  (`services/scripts/burst.sh`) runs the burst in its own process group via `setsid` and a trap
  kills the whole group on timeout/Ctrl-C/SIGTERM. Never launch a burst with a bare `timeout pnpm`.
- **YELLOW** — gas is O(N) in the vault's open orders; keep `maxOpenPerSide` small (≤5). Keeper must
  run continuously (poke/checkpoint) — needs a hosted, funded keeper.
- **YELLOW** — one shared RPC (public Monad testnet), 100-block getLogs cap; a private RPC would
  speed backfill and reduce rate-limit risk.
- **YELLOW** — frontend not started (biggest remaining chunk).
- **RED** — none.

## 10. Demo readiness checklist (3-min script, PRODUCT_FLOW.md §14)
- [x] Backend can create a live mandate (`pnpm demo:setup`)
- [x] MM auto-quotes (honest bot) and the book fills
- [x] A taker buy triggers a fill (taker bot)
- [x] A checkpoint passes and the fee ticks (soak: 50 USDC accrued)
- [x] Oversized sell is blocked by the contract (soak: SellAllowanceExceeded)
- [x] Wider spread → checkpoint fails → fee freezes (soak: failed checkpoints)
- [ ] All of the above shown in the **UI** (needs frontend)
- [ ] Public proof page verifiable with no wallet (needs frontend)
- [ ] 3:00 video recorded

## 11. Submission checklist
- [ ] Public GitHub repo with an OSI license (add `LICENSE`, e.g. MIT)
- [x] README with setup + "why Monad" (has services + contracts setup + AI disclosure; expand "why Monad")
- [x] AI coding disclosure (README)
- [x] Contract addresses / tx hashes (this file + reports)
- [ ] Demo video ≤ 3:00
- [x] Track chosen: Onchain Finance & Trading
- [ ] Bounties: **Kuru** — confirm exact bounty text/requirements
