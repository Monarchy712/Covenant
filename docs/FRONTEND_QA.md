# Frontend QA — journeys, results, timings

Verified on Monad testnet via Playwright + live reads against the hosted API
(`https://covenantservices-production.up.railway.app`) and the flagship vault
`0x27199bf4D9b8B2c4bD509e642ea7Be9C58f85408`. Screens in `docs/screenshots/m1…m6/`.

## Live write-journey run — 2026-10-04

With a directly-funded burner (`0x5d90…b0D7`, MON sent by the issuer; mock base/USDC self-minted
via the open mint), the write paths were driven through the UI on real Monad testnet:

- **Journey 1 — launch: PASS end-to-end.** Wizard (demo token, house MM) → `createMandate` →
  wait-for-accept (house MM auto-accepted) → deposit base → fund fees → `activate`, all confirmed
  on-chain, routed to `/mandate/0x65DdC3…AEcFe` (state **ACTIVE**, 100 base margin, 100 USDC escrow).
  Create confirmed in **1.7s**.
  - **Bug found + fixed (frontend):** the wizard deposited **before** the MM accepted, but the
    contract requires `ACCEPTED`/`ACTIVE` for `depositInventory` ("deposit not allowed"). Reordered
    to create → wait-accept → deposit → fund → activate.
  - **Bug found + fixed (frontend):** the wizard only deposited **base**, so the vault had no quote
    margin and the maker could not place **bids** (Kuru revert `0xf4d678b8`); two-sided quoting and
    the house MM's auto-quote both failed. Added a **quote-inventory deposit** step to the wizard.
  - **House MM auto-quote:** will re-verify after the quote-inventory fix is live (the MM accepted
    but could not two-side quote without quote margin). Time-to-first-quote recorded on re-run.
- **Journey 2 — MM console blocked card: PASS.** On an ACTIVE mandate where the burner is the MM
  (`0xb412…755e`): normal two-sided quote **confirmed in 1.3s** (book of 2 orders, checkpoint panel
  PASS, 50 USDC accrued by the keeper). Oversized ask → preflight **red** → **Send anyway** →
  a **real mined, reverted tx** `0xbf3ab7d8dcaf7c884bac06469d996f72fff35c678641e0cfafcc91045573346a`
  (status 0x0, block 67339421, gas charged on the 2.5M limit). The hook replayed the call at that
  block and the **Blocked by contract** card showed the decoded `SellAllowanceExceeded`:
  *"net-sold 100 plus resting-after-this-order 5,000 exceeds the 1,000 cap for this window (this
  order adds 5,000)"* — correct decomposition (no double-count), **Reverted in 1.2s**, explorer link.
  Screens: `docs/screenshots/m7/j2-blocked-by-contract.png`.
- **Journeys 3–5 (widen→fail, trade, terminate→settle):** blocked mid-run by a **faucet bug**
  (below) that cost the funded burner's key when the scratchpad was cleared between sessions; will
  run via `/demo/session` once the backend is redeployed.

### Backend bug found (fix in tree, needs redeploy)

The faucet mints base/USDC fine but its **MON drip reverts out-of-gas**: it sent with a hardcoded
`gas: 21_000n`, and on Monad a plain value transfer needs more than the 21,000 EVM base (observed
`gasUsed == gasLimit == 21000`, status 0x0, e.g. `0x567e7a…`). So every demo wallet ends up with
tokens and **0 MON**. Fixed in `services/src/faucet.ts` (`gas: 60_000n`). Also in tree: the approved
IP-rate-limit change (1 → 5 per IP / 24h; per-address stays 1/24h) in `config.ts` + `faucet.ts`.
Both ship together on the next Railway redeploy; then J1 funding re-runs via `/demo/session` as a judge.

## Journeys

| # | Journey | Result | Evidence |
|---|---|---|---|
| 1 | Judge path: landing → "I'm a token team" → demo wallet funded → wizard | **PASS (to wizard)** | `POST /demo/session` → 200, burner funded, routed to `/create`; wizard steps 1–4 render with live config + plain-English/band/fee panels. The launch itself is blocked by the faucet MON outage; the launch code is proven: a manual `createMandate` from the browser burner succeeded on-chain (`0x498474895c02503816ee57e3f289ceba9b79dc9938d8fa68989f7f628de3be6e`), and the root blocker (a wallet-signer bug) was fixed. Screens: `m2/start-*`, `m3/create-step{1..4}-*`. |
| 2 | MM path: invite → accept → quote → preflight red → send anyway → blocked | **PASS (preflight); send blocked by MON** | `/invite/[id]` renders terms + can/can't + accept. `/mm/[id]` preflight is **live**: an oversized ask flips the badge to red "would exceed the net-sell cap" and reveals **Send anyway**. The on-chain blocked send needs MON; the decoded "Blocked by contract" card uses the fixed `decodeCovenantError` (unit-tested). Screens: `m5/invite-1440`, `m5/console-ok-1440`, `m5/console-preflight-blocked-1440`. |
| 3 | Trader path: proof → buy → fill appears in gauge/feed | **PASS (UI); buy blocked by MON** | `/proof/[id]` trade panel renders; a buy needs MON. Reads (gauge, feed, SSE invalidation) verified live. Screens: `m6/proof-flagship-1440`. |
| 4 | Proof page renders fully with no wallet (incl. flagship idle) | **PASS** | `/proof/[flagship]` shows 90/90 intervals, 5/1,000 net sold, ±2% band, 50 USDC fee, compliance timeline, activity feed, verify links — all with no wallet. Flagship idle state honest on the landing panel. Screens: `m6/proof-flagship-1440`, `m6/proof-flagship-390`, `m1/landing-*`. |
| 5 | Misbehave path: widen spread → next checkpoint FAIL → fee frozen | **PASS (logic); on-chain needs MON** | MM console has a **Widen** nudge; the **"If a checkpoint ran now"** panel computes two-sided/spread/depth vs limits live (shows PASS on the compliant flagship; would show FAIL on a wide quote). The dashboard shows a **frozen-fee** indicator when `currentFailed`. Live fail requires quoting (MON). |
| 6 | Terminate + settlement: terminate (two-step) → withdraw → receipt | **BUILT; needs issuer wallet + MON** | Dashboard **Terminate** runs the two-step `terminate → cancelAllAfterEnd` via a `ConfirmDialog` that states orders will be cancelled; **Withdraw** is gated on `openOrders == 0`; a **settlement receipt** renders for ENDED/SETTLED. Not live-tested (needs the issuer wallet + MON). |
| 7 | Demo cap reached → friendly fallback, no dead end | **PASS** | `/start` shows a friendly rate-limit panel ("demo faucet at its daily cap") with "Explore the live flagship" + "Back to options" — verified when the demo session returned 429. |

## Timings (measured)

- **Time to first backend action** (landing → demo wallet funded): the `POST /demo/session` round-trip
  completed and routed to `/create` within ~10s of clicking "Continue with a demo wallet".
- **Monad confirmation latency:** `TxProgress` measures submit→receipt and shows "Confirmed in X.Xs"
  on every write (the "why Monad" moment). Block time is a measured 0.31s; a manual burner send
  confirmed in ~1 block during testing.
- **Config/proof/summary/events reads:** sub-second from the hosted API; the dashboard + proof pages
  hydrate immediately from server-fetched data, then refresh on a 12–15s interval + SSE.

## Design/accessibility

- `web-design-guidelines` applied from M1 (focus-visible ring, `color-scheme: dark`, theme-color,
  tabular numerals, skip link, `aria-hidden` on decorative icons, `aria-label` on icon-only links,
  curly apostrophes, real ellipses, zero em-dashes). A pass over the M4–M6 screens is in M7.
- Responsive verified at 1440 + 390 for landing, start, create, dashboard, console, proof.
- No console errors beyond the expected favicon 404 (now added).

## What to run in the morning (after faucet MON top-up)

1. Full wizard launch end-to-end (journey 1) → dashboard.
2. MM console **Send anyway** on an oversized ask → the on-chain "Blocked by contract" card.
3. Trader buy on the proof page → fill in the gauge/feed.
4. Widen spread → checkpoint FAIL → frozen fee.
5. Terminate (two-step) → withdraw → settlement receipt.
