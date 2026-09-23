# DAY_1_DECISION.md

Each line: PASS / FAIL / UNKNOWN · GREEN / YELLOW / RED · one line of evidence.
GREEN = proven by a test/tx I ran. All tests run on a **Monad-testnet fork against
real Kuru bytecode** (real deployed Router/MarginAccount/OrderBook), not mocks of Kuru.

- [x] Vault can deposit into MarginAccount — **PASS · GREEN** — `LifecycleTest.test_depositCreditsVaultMargin`: `getBalance(vault,base)=500e18`, keyed to the vault.
- [x] Vault can place resting Kuru order — **PASS · GREEN** — `LifecycleTest.test_placeAsk_recoverId` / `test_placeBid_recoverId`: post-only ask & bid rest, owner == vault.
- [x] Vault can cancel order — **PASS · GREEN** — `LifecycleTest.test_cancel`: order deleted, base margin re-credited to pre-place value.
- [x] Vault can replace order — **PASS · GREEN** — `LifecycleTest.test_replaceAtomic`: single `batchUpdate` cancel+place by the contract; old id gone, new id owned by vault.
- [x] Vault can reliably identify order ID — **PASS · GREEN** — `LifecycleTest.test_orderId_underConcurrentThirdParty`: `s_orderIdCounter` monotonic; correct id recovered even with a third party's order interleaved.
- [x] Vault can read its own order state — **PASS · GREEN** — `LifecycleTest.test_placeAsk_recoverId`: `s_orders` → owner/side/price/remaining size all read on-chain.
- [x] Vault can observe partial fills — **PASS · GREEN** — `FillsTest.test_partialFill`/`test_fullFill`/`test_dustFill`: order remaining size drops by exactly the matched base.
- [x] Vault can calculate sold amount on-chain — **PASS · GREEN** — `FillsTest`: `soldBase = deposited − freeMargin − Σ resting ask sizes`; exact to rounding, differs from gross only by the maker rebate (`makerFeeBps`).
- [x] Vault can enforce sell limit — **PASS · GREEN** — `GovernorTest.test_specBoundaries`: 900+50+40 ok, +50 ok at limit, +60 reverts `SellAllowanceExceeded(sold,resting,requested,allowance)`; `sold` from the on-chain formula.
- [x] Vault can enforce price/spread band — **PASS · GREEN** — `BandTest` (6 tests): valid/invalid/boundary/empty/one-sided; reads `bestBidAsk` same-tx (18-dec scale, incl. AMM-vault liquidity).
- [x] MM cannot withdraw issuer inventory — **PASS · GREEN** — `AdversarialTest` (11 tests): role gates + `MarginAccount.withdraw` self-keyed + direct order cancel owner-checked; vault margin provably untouched.
- [x] Contract does not depend on EIP-7702 EOA path — **PASS · GREEN** — all placement/cancel/replace done by the contract via direct `addSellOrder`/`addBuyOrder`/`batchUpdate`; ownership via ERC2771 `_msgSender()` == the contract (source `OrderBook.sol:377`, no `tx.origin`/EOA guard).
- [x] Frequent quote/cancel gas is reasonable — **PASS · YELLOW** — `GasTest`: place ~96–102k warm, atomic replace ~207k, deposit ~136k. Monad charges the gas-LIMIT (empirically confirmed: live replace tx limit==receipt.gasUsed==439519 vs ~207k executed). CAVEAT: enforcement reads O(N) in the vault's own open orders (299k @ 100) — cap concurrent orders / cache the locked-sum; set tight gas limits.
- [x] Architecture is reproducible — **PASS · GREEN** — `forge test --fork-url $RPC_URL_TESTNET` reproduces 37/37; live `--broadcast` executed on testnet (blocks 64944360–64944437, all status=true, vault `0x6855…E0F`, market `0x136d…99B8`); addresses verified via `cast code`; foundry.toml + .env.example committed.

---

**Can a Covenant Vault control a Kuru market-making position strongly enough to enforce a
market-making mandate?** — **YES** — a smart contract owns its Kuru orders and margin
directly (ERC2771 `_msgSender()`, no EOA/7702 requirement), reads its own order and fill
state on-chain, and atomically enforces a sell allowance and price band; the MM cannot move
inventory out of vault control. **ONLY WITH CAVEAT:** the on-chain enforcement reads
(`soldBase`/`restingAskBaseRaw`) are O(N) in the vault's simultaneous open orders, so
Covenant must cap concurrent orders per side (or maintain a running locked/sold accumulator)
to keep quote() gas bounded — an implementation detail, not an architectural blocker.
