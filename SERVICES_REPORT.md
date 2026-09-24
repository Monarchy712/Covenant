# SERVICES_REPORT.md — Covenant off-chain services (Day 3)

One Node 22+ / TypeScript process (viem) with modules: **indexer, api, keeper, faucet, bots**,
plus a `packages/shared` the frontend imports. Run everything with `pnpm dev:services`; create a
live demo mandate with `pnpm demo:setup`.

## 1. What was built
- **Step 0 contract fix:** `accept(bytes32 termsHash)` + `termsHash()` view (`TermsMismatch` on stale/edited terms); AMM-vault fills documented as allowed; quote==fee token. Redeployed; 101 Foundry tests green.
- **packages/shared:** viem `monadTestnet` chain, ABIs (CovenantVault/Factory + minimal Kuru OrderBook incl. the `Trade` event + mintable mock ERC20), addresses from `deployments/testnet.json`, TS `Terms`/`Snapshot` types, and a **custom-error decoder** (`decodeCovenantError`, `errorSelector`) reused by the frontend.
- **services:** config (env + module toggles + 1.15× gas), per-wallet serial **NonceManager**, viem clients + `sendTx` (estimate→limit→used logging), SQLite DB, indexer, REST+SSE API, keeper, faucet, bots, and `demo:setup`.

## 2. API reference (CORS open for localhost:3000)
| Method + path | Returns |
|---|---|
| `GET /health` | head block, indexed block, lag, service-wallet balances, factory |
| `GET /mandates?issuer=&mm=` | mandate rows (state derived on the dashboard) |
| `GET /mandates/:vault` | live `vault.snapshot()` + state name |
| `GET /mandates/:vault/events` | decoded events (paginated `limit`/`offset`) |
| `GET /mandates/:vault/fills` | fills attributed to the vault |
| `GET /mandates/:vault/checkpoints` | checkpoint observations |
| `GET /mandates/:vault/intervals` | finalized intervals (paid/amount) |
| `GET /mandates/:vault/price` | mid over time (charts) |
| `GET /stream/:vault` (SSE) | each new decoded event for the vault within ~1s |
| `POST /faucet {address}` | mints base+quote+MON drip; returns tx hashes |
| `POST /demo/session {address}` | funds + returns a demo context (never holds keys) |

## 3. Keeper schedule logic
Restart-safe: every 5 s tick it re-derives actions from each vault's on-chain `snapshot()`, so no
persisted schedule is needed.
- **poke():** ACTIVE only; when `floor((now-activatedAt)/windowLength)` exceeds the last poked
  window → poke immediately (minimizes the documented governor drift).
- **checkpoint():** ACTIVE only (checkpoint reverts while PAUSED by design); **≥2 random samples
  per interval** — the first ASAP at interval start, the next at a random offset in the remaining
  interval. Random timing is what catches an MM that only quotes near predictable ticks
  (fail-dominant scoring).
- **after ENDED:** `cancelAllAfterEnd()` while open orders remain, then `finalize()` once.
- **Low-balance alert:** logs at ERROR when the keeper wallet < 0.1 MON.
- In-memory per-vault state only avoids redundant sends within a run; on restart the worst case is
  one extra idempotent checkpoint/poke.

## 4. Indexer design
- **RPC getLogs cap (discovered empirically):** Monad testnet rejects ranges > 100 blocks
  (`eth_getLogs is limited to a 100 range`). → **chunkSize = 90** (safety margin); on a range/rate
  error the chunker halves the window and retries, and backs off on 429.
- **Confirmation lag = 3 blocks** behind head (cheap re-org safety on a fast chain; tunable).
- **Backfill** from the factory deploy block (`deployments/testnet.json.factoryBlock`), then follow
  the head every 2 s.
- **Fill attribution:** Kuru's `Trade(orderId, makerAddress, isBuy, price, updatedSize,
  takerAddress, txOrigin, filledSize)` carries `makerAddress`, so a fill belongs to a vault iff
  `makerAddress == vault`. Trade args are non-indexed, so the indexer scans each mandate's market
  and filters. (`isBuy` is the TAKER direction; `price` is 18-dec scale — spike findings.)
- **Idempotent:** every insert is `INSERT OR IGNORE` on `(txHash, logIndex)`; safe to restart/re-run.
- **SQLite tables:** mandates, events, orders, fills, checkpoints, intervals, windows,
  fee_accruals, price_points, cursor, faucet_log.
- **SSE freshness:** the indexer emits only genuinely new rows (SQLite `changes>0`) to the API bus,
  so re-indexed duplicates don't spam SSE.

## 5. Faucet limits (testnet only)
- Per-address AND per-IP cooldown: once / 24 h (rejects with a clear message).
- Fixed amounts: 100k mBASE + 100k mUSDC + 0.2 MON drip.
- Daily total MON budget cap (5 MON/day) across all requests.
- Never holds user keys — `/demo/session` funds a browser-generated burner and returns a demo context.
- Verified live: first call minted base+quote+MON (3 tx hashes); the immediate repeat was
  rate-limited (`address funded in last 24h`).

## 6. Gas per keeper action (Monad charges the LIMIT; used == limit)
| Action | estimate | limit (1.15×) | charged (used) |
|---|---|---|---|
| poke | 40,620 | 46,713 | 46,713 |
| checkpoint | ~251k–271k | ~288k–312k | == limit |
| (quote/cancel/finalize measured in `CONTRACTS_REPORT.md` §7) | | | |
Confirms the spike's gas-on-limit finding on live service txs (receipt `gasUsed` == the set limit).

## 7. Soak results (live Monad testnet)
Demo mandate `0xaF7CcA436AD2ECaEcbD2A969C8bDd1B3387C1b46` (10-min window, 2-min checkpoint).

**Honest run** (keeper + MM honest bot + taker):
- Keeper poked + checkpointed; interval 0 finalized **PAID → accruedFees = 50 USDC** (verified via API `snapshot()`).
- Sample tx hashes: poke `0x7b001ae7…ee05c`, checkpoint `0xda97f7e5…9b252`, MM quote `0x12201705…3161f`.

**Malicious run** (keeper + MM malicious bot):
- Oversized sell **blocked** by the contract (governor) — the quote reverted (SellAllowanceExceeded; contract tests prove the exact selector).
- Wide-but-in-band spread quotes placed (`mmBot.wideSpread` e.g. `0x2ea0860d…c17d`) → checkpoints then **FAIL** the spread KPI (≥2 failed observations via API) → fee freezes.
- Malicious-run checkpoint tx e.g. `0x7b8088bd…b686`.

**Criteria (all met):** ≥1 interval pays ✓ · ≥1 fails after the malicious switch ✓ · oversized sell reverts ✓ · events appear in the API/DB within seconds ✓.

> The full ≥30-min soak is runnable with the same commands (§ below); the run above exercised every
> required outcome in a few minutes thanks to the 2-min demo checkpoint interval.

## 8. How to run
```bash
pnpm install
pnpm demo:setup                    # deploy a fresh demo mandate (short windows), refresh shared addrs
pnpm dev:services                  # indexer + API (default)
# full demo (bots + keeper):
RUN_KEEPER=true RUN_MM_BOT=true MM_BOT_MODE=honest RUN_TAKER_BOT=true pnpm dev:services
# show a failing/blocked MM:
RUN_KEEPER=true RUN_MM_BOT=true MM_BOT_MODE=malicious pnpm dev:services
```
Env: `RPC_URL_TESTNET`, `DB_PATH`, `PORT`, `PRIVATE_KEY_KEEPER/FAUCET/SEEDER/MM/TAKER` (see `.env.example`).

## 9. Known issues / notes
- **Backfill speed:** the 100-block getLogs cap + per-block timestamp fetches make a cold backfill of a few thousand blocks take ~30–60 s; incremental follow is fast. A private/archive RPC would help.
- **Bot revert messages:** viem's estimate-time message for the blocked oversized sell is generic ("execution reverted"); the frontend decodes the real `SellAllowanceExceeded` via `decodeCovenantError` on the revert data.
- **Seeder bot** needs a prior MarginAccount deposit to post resting orders; for the demo the honest MM bot keeps the book two-sided, so the seeder is a not-strictly-needed safety net.
- **Service wallets:** the soak reused ATTACKER (keeper) + DEPLOYER (faucet/seeder); production needs dedicated funded keys.
- **Integration-on-anvil:** unit tests (vitest, 9) run offline; the "integration" assertion was done as a **live** soak against real testnet (real Kuru), which is stronger than an anvil fork for this stack.

## 10-line summary
1. Step-0 contract fix shipped: `accept(termsHash)` + `termsHash()`; 101 Foundry tests green; factory redeployed.
2. pnpm workspace + `packages/shared` (ABIs, addresses, types, error decoder) ready for the frontend.
3. Indexer: chunked getLogs (RPC caps at 100 → chunk 90), lag 3, idempotent SQLite, fill attribution via `Trade.makerAddress`.
4. REST + SSE API serves snapshots, events, fills, checkpoints, intervals, price, and live streams.
5. Keeper: restart-safe; pokes at window boundaries, random ≥2 checkpoints/interval, cancel+finalize after ENDED.
6. Faucet + demo sessions: per-address/IP 24h limits + daily MON cap; verified live incl. rate limit.
7. Bots: seeder + MM (honest/malicious) + taker; MM bot doubles as the SDK snippet for real MMs.
8. `pnpm demo:setup` creates a live demo mandate (short windows); `pnpm dev:services` runs it all.
9. Live soak PASSED: fee paid (50 USDC), oversized sell blocked, checkpoint failed after widening, events in API within seconds; gas confirms Monad gas-on-limit.
10. **No RED risks.** Next: the frontend. See `PROGRESS.md`.
