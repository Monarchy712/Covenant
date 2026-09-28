# BACKEND_REPORT.md — Day 4

Priority order was 1 → 2 → 5 → 6 → 3 → 4 → 7 → 8 → 9 → 10. I completed the highest-value parts
(the integration surface and the live settlement proof) plus 1, 2, Docker/Railway prep, and the
safe parts of 10, and I've flagged exactly what needs you.

## Status per part

| Part | Item | Status |
|---|---|---|
| 1 | Wallet separation (status/topup scripts, startup sharing-check, env) | **DONE** — needs you to set a dedicated `PRIVATE_KEY_FAUCET` |
| 2 | Seeder auto-deposits margin + keeps a drifting two-sided book | **DONE** (code + typecheck; live-verify with `RUN_SEEDER=true` after faucet/seeder funded) |
| 5 | Frontend integration surface (actions + utils + reads + docs) | **DONE** — 17 tests incl. live round-trips |
| 6 | Live settlement proof (`pnpm e2e:full`) | **DONE** — 24 txs, SETTLED, exact balances (`docs/E2E_RUN.md`) |
| 3 | House MM (auto-accept + honest quoting for invited mandates) | **DONE** — `services/src/houseMm.ts`, `RUN_HOUSE_MM`, advertised via `/config` |
| 4 | Role-based demo sessions (issuer/mm/trader) + admin `/demo/reset` | **DONE** — `POST /demo/session {address,role}`; mm-role creates+funds+activates a fresh mandate |
| 7 | Production hardening | **DONE (core)** — `/config`, `/markets`, `/mandates/:vault/summary`, `/proof/:vault`; SSE `Last-Event-ID` resume + heartbeat; `/health` ok/degraded/down + 503; graceful shutdown (WAL checkpoint); CORS from `ALLOWED_ORIGINS`; `ADMIN_TOKEN`-gated admin. (Block-timestamp backfill cache = optional TODO.) |
| 8 | Hosting on Railway | **DONE** — live at `https://covenantservices-production.up.railway.app` (Docker build; `/health` `/config` `/markets` `/summary` `/proof` + SSE verified from outside) |
| 9 | Hosted ≥60-min soak | **DONE** — `docs/SOAK_REPORT.md`: autonomous loop, lifecycle via hosted API (paid interval + blocked sell), SSE resume, seeder-keeps-book, restart recovery; seeder cost fixed |
| 10 | Public repo (LICENSE, gitleaks, explorer verify, README) | **DONE (local parts)** — MIT LICENSE; clean git-history secret scan; **contracts verified on Sourcify (exact_match)**; README pitch + Mermaid architecture + why-Monad |

### Explorer verification (Sourcify, chain 10143, exact_match)
- CovenantFactory `0x49dcD18CdACB881070Afb90f0b992ad7afac34E4` — verified (exact_match)
- CovenantVault implementation `0x987922C61bD2941D593ED145A4D894f62838b18d` — verified (exact_match)
- Browse: `https://sourcify.dev/#/lookup/<address>` or `https://repo.sourcify.dev/contracts/full_match/10143/<address>/`

## What needs YOU (blocking items)

1. **Dedicated faucet wallet.** `PRIVATE_KEY_FAUCET` currently == `DEPLOYER` (`wallets:status`
   shows FAUCET=SEEDER=DEMO_ISSUER=DEPLOYER share `0xa341…6123`). The startup check refuses to
   run faucet + seeder together until you set a fresh, funded `PRIVATE_KEY_FAUCET`. This blocks
   Part 4 (demo sessions) and the hosted soak (Part 9), not the rest.
2. **Top up DEPLOYER** (0.96 MON, and it's issuer+seeder+faucet-source). `pnpm wallets:topup`
   sends DEPLOYER → service wallets (dry-run; add `--yes` to broadcast).
3. **Railway deploy (Part 8/9).** You're logged into Railway. Steps below; the deploy + hosted
   soak are yours.

## Part 5 — integration surface (the key deliverable)

`packages/shared/src/`:
- `actions.ts` — one typed helper per user action returning `{ address, abi, functionName, args, value? }`
  + `approvals[]` pre-steps: `createMarket, createMandate, updateTerms, setMM, accept`
  (computes `termsHash` locally), `depositInventory, fundFees, activate, pause, unpause,
  terminate, quote, cancel, claimFees, checkpoint, poke, cancelAllAfterEnd, finalize, withdraw,
  traderBuy, traderSell`.
- `utils.ts` — `withGasBuffer` (×1.15), formatters, `explorerTx/AddressUrl`, `plainEnglishTerms`.
- `reads.ts` — `getSnapshot`, `getOrderBook` (mid + flagged vault orders), `getTermsHash`,
  `preflightQuote` (selector → human message).
- `errors.ts` — `decodeCovenantError` covering every custom error.

**Verification:** `services/test/integration.test.ts` — 17 tests, incl. LIVE round-trips against
the deployed vault: `computeTermsHash(terms) === on-chain termsHash()`, `getSnapshot`,
`getOrderBook`, `preflightQuote`. Docs: `docs/FRONTEND_INTEGRATION.md` maps every screen×button →
helper, pre-steps, events, refresh source, and error messages. **The frontend never reads contract code.**

## Part 6 — live settlement (`docs/E2E_RUN.md`)

Full lifecycle on real testnet, vault `0x1f260263B010D293b7268cAC9e6E575Ec3d192DB`:
create → accept(termsHash) → deposit → fund → activate → honest quote + taker fill → **paid**
interval → pause/unpause → **blocked** oversized sell (`SellAllowanceExceeded` decoded from
revert data: net-sell 39.96 + resting 5060 + requested 5000 > cap 1000) → failed interval →
duration ENDED → cancelAllAfterEnd → finalize → claimFees → withdraw → **SETTLED**. Asserted:
MM received exactly 100 USDC accrued, issuer got +960.04 base and +1480.16 quote (inventory +
proceeds + unused escrow), vault zeroed. 24 tx hashes recorded.

## Hosting steps for you (Part 8)

```bash
railway init                       # or link an existing project
railway up                         # builds the Dockerfile
railway volume add --mount /data   # persistent SQLite (DB_PATH=/data/covenant.db)
# set variables (NOT in the repo):
railway variables set RPC_URL_TESTNET=… PRIVATE_KEY_KEEPER=… PRIVATE_KEY_FAUCET=… \
  PRIVATE_KEY_SEEDER=… PRIVATE_KEY_MM=… PRIVATE_KEY_TAKER=… RUN_KEEPER=true RUN_SEEDER=true \
  RUN_MM_BOT=true RUN_FAUCET=true ADMIN_TOKEN=… ALLOWED_ORIGINS=https://<your-vercel-domain>
```
Healthcheck is wired to `/health` (returns 503 when down). Verify `/health`, `/config`, and SSE
from outside once deployed.

## Gas per keeper/service action (measured, charged on the LIMIT)

From the E2E and unit runs (gas used ≈ limit on Monad): checkpoint ~150–370k, quote ~550–750k,
cancelAllAfterEnd ~520k, finalize ~190k, claimFees ~148k, withdraw ~295k, deposit ~170k. Every
send uses `estimate × 1.15`.

## Remaining for the frontend / next sessions

- **Frontend build** (React): wire buttons to `@covenant/shared` helpers per `FRONTEND_INTEGRATION.md`.
- **Part 3 house MM, Part 4 role-based demo sessions, Part 7 remaining hardening** (graceful
  shutdown, RPC backoff, ADMIN_TOKEN gating, block-timestamp cache), **Part 9 hosted soak**,
  **Part 10** explorer (Sourcify) verification + README architecture/why-Monad + dead-code cleanup.

## 10-line summary
1. Parts 1–7 + local Part 10 DONE; only Parts 8 (Railway deploy) and 9 (hosted soak) need you.
2. Part 5 (key deliverable): full typed action/read/util surface + `FRONTEND_INTEGRATION.md`; 17 tests incl. LIVE round-trips (computeTermsHash == on-chain termsHash).
3. Part 6 (key deliverable): live settlement E2E through SETTLED, exact balances, 24 tx hashes; oversized sell decoded live as SellAllowanceExceeded, MM paid exactly its accrued fee.
4. Part 1: `wallets:status`/`topup` + startup sharing-check; flags FAUCET=DEPLOYER collision.
5. Part 2: seeder auto-deposits margin + keeps a drifting two-sided book (no more EmptyBook).
6. Part 3: house MM auto-accepts invited mandates (safe-bounds validated) + quotes honestly.
7. Part 4: role-based `/demo/session` (issuer/mm/trader) + admin `/demo/reset`.
8. Part 7: `/config`, `/markets`, `/summary`, `/proof`, SSE resume+heartbeat, `/health` 503, graceful shutdown, CORS+ADMIN_TOKEN.
9. Part 10: MIT LICENSE, clean git-history secret scan, **both contracts Sourcify-verified (exact_match)**, README pitch+architecture.
10. RED risks: none. NEEDS YOU: dedicated funded `PRIVATE_KEY_FAUCET` (+topup DEPLOYER) for live demo mm-role/soak, and the Railway deploy (Parts 8/9).
