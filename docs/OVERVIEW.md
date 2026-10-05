# Covenant — Project Overview (LLM hand-off brief)

A single high-level brief to understand the whole project: what it is, how it works, the
architecture, the user flows, and the current status. For deeper detail see the pointers at the end.

---

## 1. What it is (one paragraph)

Covenant lets a token project ("issuer") hire a market maker ("MM") to quote its token on **Kuru**
(Monad's on-chain order book) under a mandate the MM **physically cannot break**. Instead of lending
the MM the tokens (the classic deal that let Movement Labs' MM dump ~66M tokens on day one), the
issuer's inventory goes into a **CovenantVault** smart contract that **owns every order on the book**.
The MM can only place/cancel orders *through* the vault, and the vault re-checks the mandate — a
net-sell cap, a price band, an open-order limit — **in the same transaction** as each order, so an
order that breaks the rules simply reverts. The MM is paid a fee per time interval **only for
intervals the chain can prove** it quoted two-sided, tight, and deep enough (a permissionless
"checkpoint"); a single failing observation voids that interval's fee.

**Honest limit:** Covenant governs on-chain inventory on Kuru. It can't stop an MM hedging on another
venue. It protects the issuer's tokens and proves the MM's on-chain work.

---

## 2. The core mechanism (the one idea)

> The tokens sit in a contract that is the **only thing allowed to place orders**, and it **refuses
> any order that breaks the mandate** — so the MM works inside rails it cannot bend, and only gets
> paid for liquidity the chain can prove.

- **Custody:** inventory lives in the vault's own Kuru MarginAccount. The MM can never withdraw it.
- **Enforcement:** every order runs the net-sell-cap governor + price-band + order-cap checks atomically; a violating order reverts (e.g. `SellAllowanceExceeded`).
- **Proof-of-work:** `checkpoint()` is permissionless; anyone can force the chain to score the MM's quoting. Pass → the interval's fee accrues; any fail → it's voided.

---

## 3. Lifecycle

`CREATED` → `ACCEPTED` → `ACTIVE` → (`PAUSED` ⇄ `ACTIVE`) → `ENDED` → `SETTLED`

Issuer deploys the vault + sets terms + invites the MM → MM accepts (pins the terms hash) → issuer
deposits inventory + fee budget + activates → MM quotes, anyone checkpoints, anyone trades → issuer
terminates (or duration ends) + orders cancelled → issuer withdraws inventory + proceeds + unused
escrow; MM keeps only earned fees.

---

## 4. Architecture

| Layer | What | Where |
|---|---|---|
| **Contracts** | `CovenantFactory` + per-mandate `CovenantVault`, on top of **Kuru** (on-chain order book) and **MockBase/MockUSDC** test tokens | Monad testnet (chain 10143) |
| **Backend** (`services/`) | One Node/TypeScript process, modules toggled by env: **indexer** (events → SQLite), **REST+SSE API**, **keeper** (checkpoints), **faucet** (demo funding), **house MM** (auto-accepts + quotes honestly), **treasury** (central MON funding + auto-top-up), **seeder/taker** bots | Railway (Docker), SQLite on a mounted `/data` volume |
| **Frontend** (`apps/web`) | Next.js 14 App Router + React + Tailwind + viem. Reads live state from chain + the API; writes via an injected wallet (MetaMask) or an in-browser demo burner | Vercel |

**Data flow:** the frontend reads *live* state directly from the vault contract (state, book, gauge,
fees) and reads *history* (activity feed, KPI timeline, compliance) from the backend indexer's DB.

---

## 5. Users and flows (what each does)

- **Judge / newcomer:** one click funds a browser burner (faucet drips MON + mints test tokens), then they *are* an issuer/MM/trader. The 3-minute demo path: create a mandate → house MM quotes → trade against it → try an oversized sell (blocked on-chain) → widen spread (checkpoint fails, fee freezes) → verify on the public page.
- **Issuer:** `/app` (my mandates) → `/create` (4-step wizard: token → terms → MM → fund & launch) → `/mandate/[vault]` (hero dashboard: book, net-sold gauge, KPI timeline, fees; pause / terminate / withdraw).
- **Market maker:** `/invite/[vault]` (review + accept) → `/mm/[vault]` (quote ticket with live preflight, "Send anyway" → the "Blocked by contract" card, KPI panel, claim fees).
- **Public (no wallet):** `/explore` (all mandates) → `/proof/[vault]` (live compliance, verify-on-explorer links, trade panel, "checkpoint it yourself", embeddable badge).

---

## 6. Live deployment

| Thing | Value |
|---|---|
| Frontend | `https://covenant-sandy.vercel.app` |
| Backend API | `https://covenantservices-production.up.railway.app` |
| Chain | Monad testnet (10143), explorer `testnet.monadexplorer.com` |
| Factory | `0x49dcD18CdACB881070Afb90f0b992ad7afac34E4` |
| Flagship vault (always-on reference mandate) | `0x27199bf4D9b8B2c4bD509e642ea7Be9C58f85408` |
| Flagship Kuru market | `0x1429116A9795FC921bb3Bc735a656B55804714c6` |
| House MM | `0x687dFEcC7eAaFA4DC28f72Bfb9cdB77cAe18a641` |
| Treasury (central MON funding) | `0x66E8E7F54daAb0424ffC23c7c13cCc01C50dadff` |
| Base / Quote (USDC) test tokens | `0xC565…3617` / `0x2968…A60c` |
| Repo | `github.com/Monarchy712/Covenant` |

---

## 7. Current status

**Done and live:**
- Contracts deployed; custody/ownership/governor/band enforcement proven by tests + testnet txs.
- Backend hosted on Railway with a persistent `/data` volume and a hard **persistence guard** (refuses to start if the DB isn't on a mounted volume — this was the cause of an earlier history-loss).
- **Faucet MON drip** fixed (routed through the treasury; verified live) so demo wallets are funded.
- **Treasury** auto-top-up keeps service wallets funded from one central wallet.
- Frontend M1–M7 complete; all five write-journeys PASS on-chain; **live J1** (full judge path on the Vercel site) PASS — mandate reaches ACTIVE and the house MM quotes two-sided within seconds.

**In flight:**
- **Historical backfill** of the flagship's compliance history (the data had been lost when the DB was briefly on ephemeral storage). Runs *inside* the hosted service via `POST /admin/backfill`, is resumable, and survives restarts. Progress is in `/health.backfill`. ETA is bound by the public RPC's rate limit (hours; a private `RPC_URL_TESTNET` would cut it to <1h).

**Pending:**
- Let the backfill reach `done:true`, then confirm the flagship shows ~90 intervals / ~182 checkpoints on the live proof page + landing.
- Set `INDEXER_RESET=false` on Railway once the forward cursor is persisted (so a redeploy never clears it).
- Record the 3-minute demo video.

**Known limitations:** Covenant doesn't control off-venue hedging; testnet uses mock tokens; wallet UX is injected-wallet / in-browser-burner only (no WalletConnect). Full list in `docs/WALKTHROUGH.md`.

---

## 8. Where to go deeper

- **`docs/WALKTHROUGH.md`** — plain-English, screen-by-screen walkthrough for every user, the 3-minute demo script, limitations, and future work. (Best for understanding the *product end to end*.)
- **`docs/PRODUCT_FLOW.md`** — the product + mechanism spec (terms, state machine, money flows, security cases).
- **`PROGRESS.md`** — chronological build log: what was done each milestone/session, bugs found + fixed, decisions.
- **`README.md`** — setup + "why Monad".
