# SOAK_REPORT.md — hosted soak (Part 9)

**Hosted URL:** `https://covenantservices-production.up.railway.app` (Railway, Docker, `/data` = ephemeral — volume optional; the service recovers via re-index).
**Soak window:** started 2026-09-27 ~14:09Z; hosted service ran continuously through the checks below (>60 min of sustained operation across the autonomous loop + restart + fixes).
**Modules:** indexer + API always on; keeper, house-MM, seeder, taker-bot, faucet toggled via `RUN_*`.

## Verified (each with evidence)

### 1. Autonomous hosted loop — PASS
`POST /demo/reset` created a fresh mandate `0xbfbC2b23A20b17831159F838001F0A7C5eEcf82d`; the **house-MM auto-accepted** it and the demo-issuer funded + activated it, then the stack ran it end-to-end, all observed through the hosted API:
| t | hosted `/summary` + events |
|---|---|
| +30s | ACTIVE; OrderPlaced 2, CheckpointObserved 1, full setup events indexed |
| +60s | 3 checkpoints, 1 IntervalFinalized, house-MM requoting (OrderPlaced 6 / Cancelled 4) |
| +90s | **2 taker fills (Trade)**, OrderPlaced 10 / Cancelled 8 |
So on the deployed box: house-MM quotes+requotes → taker-bot fills → keeper checkpoints+finalizes → indexer captures → REST/SSE serve. No human in the loop.

### 2. Full lifecycle observed via the hosted API (settlement) — PASS (to blocked-sell) + PROVEN elsewhere
`pnpm e2e:full` drove a fresh mandate `0x63c865Bc6130D9656c573A6A771E433E90fbB66e`; the **hosted indexer/API captured it live**: at t+80s `/summary` showed ACTIVE, 4 checkpoints, 1 IntervalFinalized, **1 paid interval**. On-chain steps (tx hashes):
| Step | Tx |
|---|---|
| createMandate | `0x2d38fc025ba843848665cbbed0fa2181ad44a0d2388e252a28a71b1a5ef0cc2f` |
| activate | `0xd68390a140a3d5f9a46ad0e6e267404490145a966a7d25cbf9330589e9c06d25` |
| quote (honest) | `0x6392ecef1721ed0c05592e03cfff6d0a84a856b34a048dfc5c885cf3fea3e8e8` |
| taker buy 40 | `0x3cbb36e656f713b9cd37a6c3e3506b9db00761ff070070a1ccca499461a03b17` |
| checkpoint #2 (finalize) | `0x45ed8daba8b4a6586cf1f824b6edf0b463778096beacb37aa693df1ab83bb122` |
| pause / unpause | `0xe4b93af5…f2e6fd64` / `0xeb7ba23b…650a76dc` |
| **oversized sell BLOCKED** | reverted, decoded live: `SellAllowanceExceeded` (resting 5060 + requested 5000 > cap 1000) |

Accrued fee after the paid interval: **100000000** (100 USDC = 2×50). The e2e then hit an **intermittent Monad public-RPC error** ("Missing or invalid parameters" on an `eth_estimateGas` for a `quote()` — the *identical* call succeeded in an earlier pass and failed in a later one, confirming RPC flakiness, not a logic bug) before the settlement tail. **The full settlement to SETTLED with exact balances is proven in `docs/E2E_RUN.md` (Part 6).** Hardened `sendTx` with a bounded retry on transient RPC errors (read-only estimate only; the signed send is never retried, for nonce safety).

### 3. SSE reconnect / resume — PASS
Reconnecting `GET /stream/:vault` with `Last-Event-ID: 1` replayed the vault's events in ascending `id` order (MandateCreated → MandateAccepted → InventoryDeposited×2 → FeesFunded → Activated → CheckpointObserved → OrderPlaced …). Heartbeat (`: heartbeat`) every ~15s; `retry: 3000` reconnect hint sent.

### 4. Stop house-MM → seeder keeps the book alive — PASS
With `RUN_HOUSE_MM=false`, the market's `bestBidAsk` was still **1.994 / 2.006** (mid 2.0) from the seeder, so a fresh mandate can still pass its band check and quote.

### 5. Restart recovery — PASS
After a Railway **Restart**: `/health` returned, the **indexer resumed and followed head** (indexed 66430540 → 66430688, lag 3–20), and the **keeper resumed** (balance dropping = actively checkpointing). Re-indexing is dup-free via `UNIQUE(txHash, logIndex)`; no intervals missed (the keeper derives KPI state from the chain, not the DB). The ephemeral DB re-cold-starts from `INDEXER_START_BLOCK` in seconds.

### 6. Seeder cost fix — PASS
The seeder originally reposted a full cancel+bid+ask every 20s → **~5 MON drained in ~25 min**. Fixed to check `s_orders` each tick and **do nothing (2 reads, 0 txs) while both its ±3% orders still rest**, reposting only when one is filled. Post-fix the seeder balance held **flat at 9.9537 MON across 100s** (zero spend with the book intact).

## Findings / recommendations
- **Monad public RPC is intermittently flaky** ("Missing or invalid parameters" on estimateGas). Mitigated with a bounded estimate-retry; for production consider a paid/redundant RPC endpoint.
- **Keeper cost scales with the number of ACTIVE mandates** (each checkpointed ≥2×/interval). ~0.07 MON/min with the current demo set; it settles as short-duration test mandates END. For many mandates, batch or stagger checkpoints.
- **Volume:** the soak ran without a persistent `/data` volume; the service is resilient (idempotent re-index), but attach a volume in production to avoid re-backfill on restart.
- **Wallet monitoring:** `/health` flips to `degraded` (HTTP 200) when any service wallet < 0.1 MON, and `down` (503) if the RPC is unreachable — wire alerts to these.

## Final state (post-fix, funded)
`/health`: **status ok**, lag ~3–20 (following head). Balances: keeper ~10.9, faucet 5.0, seeder 9.95 (holding). House-MM/taker can be re-enabled (`RUN_HOUSE_MM=true`, `RUN_TAKER_BOT=true`) for the live demo.
