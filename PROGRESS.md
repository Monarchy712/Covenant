# Covenant — PROGRESS

Living tracker. Update at the end of every milestone.

## 1. Status at a glance
- **Last updated:** 2026-09-24
- **Current phase:** Off-chain services DONE → next is the frontend
- **Deadline:** Oct 13, 11:59 PM ET · **target submit:** Oct 11 · **~19 days left**
- **Track:** Onchain Finance & Trading

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
**Live demo mandate (current `deployments/testnet.json`, `pnpm demo:setup` @ block 65359102):**
- Factory: `0x49dcD18CdACB881070Afb90f0b992ad7afac34E4`
- Vault (demo mandate): `0xaF7CcA436AD2ECaEcbD2A969C8bDd1B3387C1b46`
- Market: `0x1429116A9795FC921bb3Bc735a656B55804714c6`
- Base (mBASE): `0xC5652d30758EaF1e0ABA2Fa46e3fB069d6f33617`
- Quote (mUSDC): `0x2968F6Ab34415bBF6D8cB72e25c3578B5796A60c`

**Earlier factory (Step-0 redeploy, superseded by the demo):** `0x31E00E955908AAC109C801A72A9022A5C9B849B6`
**Kuru testnet (reused):** Router `0x7EFbE105Ca7415dE98F96622173458ac1c054630`, MarginAccount `0xd029C2D98ff85D8F64799017fE00a59B1159CE02`

**Service wallets (addresses only):**
- Keeper (soak: = ATTACKER): `0x6d11172f538b60BE3a69c745944767Ac94019df7`
- Faucet / Seeder (soak: = DEPLOYER): `0xa34118bD1A2A789A962A4471C59c3964fb716123`
- MM bot: `0x687dFEcC7eAaFA4DC28f72Bfb9cdB77cAe18a641` · Taker bot: `0x7A0A94615094Ef0673f2D0F031D43fB9ED78cc0B`

## 9. Risks
- **GREEN** — contract layer (101 tests, invariants, live). Kuru integration (proven).
- **GREEN** — services pipeline (live soak: fee paid, blocked sell, failed checkpoint, events in API/SSE).
- **YELLOW** — gas is O(N) in the vault's open orders; keep `maxOpenPerSide` small (≤5). Keeper must run continuously (poke/checkpoint) — needs a hosted, funded keeper.
- **YELLOW** — one shared RPC (public Monad testnet), 100-block getLogs cap; a private RPC would speed backfill and reduce rate-limit risk.
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
