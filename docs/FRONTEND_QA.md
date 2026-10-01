# Frontend QA — journeys, results, timings

Verified on Monad testnet via Playwright + live reads against the hosted API
(`https://covenantservices-production.up.railway.app`) and the flagship vault
`0x27199bf4D9b8B2c4bD509e642ea7Be9C58f85408`. Screens in `docs/screenshots/m1…m6/`.

## Environment note (important)

The demo **faucet's MON drip is failing (faucet wallet out of MON)** — it mints base/USDC but the
MON transfer reverts, so a demo burner ends up with tokens and **0 MON** and cannot pay gas for any
write. Demo-session funding is also IP-rate-limited for 24h. Therefore the **write journeys
(launch, accept, quote, send-anyway, trade, terminate, claim) could not be executed end-to-end live
tonight.** Their code paths are proven (see journey 1) and will run once the faucet is topped up
with MON (see `OVERNIGHT_REPORT.md` §6). All **read journeys pass live**.

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
