# CONTRACTS_REPORT.md — Covenant contract layer (Day 2, Sep 24)

Built on the proven Kuru integration from the spike (`TECHNICAL_SPIKE_REPORT.md`,
`docs/KURU_ARCHITECTURE.md`). New contracts live in `src/covenant/`; the spike contracts are
untouched for reference. All tests run on a **Monad-testnet fork at pinned block 64938269**
against **real deployed Kuru bytecode**; only the ERC20 tokens are mocks.

---

## 1. Status per priority item

| # | Item | Status |
|---|---|---|
| 1 | Vault core: roles, state machine, quote (band/cap/governor), cancel, withdraw/settle + tests | **DONE** |
| 2 | Governor windows + fail-dominant checkpoint + fees + tests | **DONE** |
| 3 | Factory + registry + tests | **DONE** |
| 4 | snapshot() + previewQuote() views | **DONE** |
| 5 | Invariant fuzzing | **DONE** (4 invariants, 40 runs × 800 calls, 0 reverts) |
| 6 | Testnet deploy + smoke run + ABI export | **DONE** (live on testnet; see §7) |

**Tests: 93 unit/state/adversarial pass + 4 invariants pass = 97 total, 0 failing.**

---

## 2. Architecture summary + final interfaces

- **CovenantFactory** (`3.4 KB` runtime) — deploys each `CovenantVault` as an **EIP-1167 clone**
  of one implementation (chosen over `new` so factory runtime stays tiny and never risks the
  24 KB limit from embedding vault initcode). Validates terms, keeps per-issuer / per-MM /
  global registries.
- **CovenantVault** (`18.4 KB` runtime, clone target, `initialize()` not constructor) — custodies
  inventory in its **own** Kuru MarginAccount balance, owns every Kuru order (ERC2771
  `_msgSender()` == the vault, proven in the spike), and enforces the mandate atomically.
  `ReentrancyGuard` + `SafeERC20`; no upgradeability, no admin backdoor, no delegatecall, no
  arbitrary external calls (only the fixed Kuru OrderBook/MarginAccount, validated at init).

**Factory functions:** `createMandate(Terms)`, `mandatesOf`, `mandatesForMM`, `allMandates(offset,limit)`, `totalMandates`. Event `MandateCreated(vault,issuer,mm,market)`. Errors `ZeroAddress`, `BadBounds(what)`, `MarketAssetMismatch`.

**Vault functions by role:**
- issuer: `depositInventory`, `fundFees`, `updateTerms`/`setMM` (CREATED only), `activate`, `pause`, `unpause`, `terminate`, `withdraw`
- MM: `accept`, `quote(bidPrices,bidSizes,askPrices,askSizes,cancelIds)`, `cancel(ids)`, `claimFees`
- anyone: `checkpoint`, `poke`, `cancelAllAfterEnd`, `finalize`
- views: `snapshot()`, `previewQuote(...)`, `currentState`, `endsAt`, `soldBaseSigned`, `netSoldInWindow`, `restingAskBaseRaw`, `openBid/AskCount`, `openBid/AskIds`, `terms`, `intervals`, `accruedFees`, `feeEscrow`, `claimedFees`, `consecutiveFails`.

**Events:** `MandateAccepted, InventoryDeposited, FeesFunded, Activated, OrderPlaced, OrderCancelled, WindowRolled, CheckpointObserved, IntervalFinalized, FeeClaimed, Paused, Unpaused, Terminated, Withdrawn, Settled`.

**Errors:** `NotIssuer, NotMM, WrongState(current), AlreadyInitialized, TermsLocked, SellAllowanceExceeded(netSold,restingAfter,requested,cap), OutsideBand(price,mid,bandBps), EmptyBook, TooManyOpenOrders(isBid,count,max), OpenOrdersRemain, InsufficientEscrow, LengthMismatch, NothingToClaim, NotActivatable`.

ABIs exported to `abi/CovenantVault.json` (47 fns / 15 events / 16 errors) and `abi/CovenantFactory.json`.

---

## 3. Allowed-actions matrix (state × function × role)

`I`=issuer, `M`=MM, `A`=anyone. ✓=allowed, ·=reverts (WrongState or role error).

| Function \ State | CREATED | ACCEPTED | ACTIVE | PAUSED | ENDED | SETTLED |
|---|---|---|---|---|---|---|
| accept (M) | ✓ | · | · | · | · | · |
| updateTerms/setMM (I) | ✓ | · | · | · | · | · |
| depositInventory (I) | · | ✓ | ✓ | · | · | · |
| fundFees (I) | · | ✓ | ✓ | · | · | · |
| activate (I) | · | ✓* | · | · | · | · |
| quote (M) | · | · | ✓ | · | · | · |
| cancel (M) | · | · | ✓ | ✓ | · | · |
| checkpoint (A) | · | · | ✓ | · | · | · |
| poke (A) | · | · | ✓ | · | · | · |
| pause (I) | · | · | ✓ | · | · | · |
| unpause (I) | · | · | · | ✓ | · | · |
| terminate (I) | · | · | ✓ | ✓ | · | · |
| cancelAllAfterEnd (A) | · | · | · | · | ✓ | · |
| finalize (A) | · | · | ✓ | ✓ | ✓ | · |
| withdraw (I) | · | · | · | · | ✓** | · |
| claimFees (M) | · | · | ✓ | ✓ | ✓ | ✓*** |

\* requires inventory>0 and escrow ≥ one fee. \*\* requires zero open orders (else `OpenOrdersRemain`), then → SETTLED. \*\*\* claimable = accrued−claimed remains claimable after settle.
ENDED is derived lazily from `activatedAt + duration` in `currentState()`.
Tested in `test/covenant/{StateMachine,Roles}.t.sol` (roles: attacker/issuer/mm gating; representative + boundary cells for each transition).

---

## 4. Decisions made (with reasoning)

Using PRODUCT_FLOW.md §16 recommended defaults except where this prompt overrode them:

1. **Clones over `new`** — factory runtime stays ~3.4 KB; avoids embedding vault initcode.
2. **`initialize(Terms, marginAccount)`** — clone pattern; margin address injected by factory (network-canonical). Guarded against re-init.
3. **Checkpoint = fail-dominant** (prompt override of PRODUCT_FLOW): any failing observation voids the interval fee. `PRODUCT_FLOW.md` updated + changelog added.
4. **`soldBaseSigned()` is int256** — bid fills can push net base bought beyond deposits (net long → negative). Governor uses `netSoldInWindow + restingAskBaseAfter ≤ cap`.
5. **Fixed tumbling windows** with lazy roll + permissionless `poke()`; `soldAtWindowStart` snapshotted on first interaction in a new window.
6. **Empty-book band bootstrap** (PRODUCT_FLOW open decision #9): if the live mid is 0 (fresh market, no CLOB/AMM reference), a **two-sided** quote seeds the reference mid from its own proposed bid/ask (and requires ask≥bid); a **one-sided** quote into an empty book reverts `EmptyBook`. Production markets carry AMM-vault liquidity so mid>0. Documented; safe (no lone off-price order can ever be placed).
7. **Unobserved interval is neutral** for the consecutive-fail counter (only observed-fail increments; observed-pass resets). Rationale: permissionless checkpoint means a genuinely dark MM *will* be observed failing by the keeper/issuer.
8. **Paused intervals**: `checkpoint()` reverts while PAUSED, so those intervals get no observation → neither paid nor a fail (matches PRODUCT_FLOW #10 "freeze").
9. **Order-cap counting prunes filled ids lazily** (`_pruneFilled`/`_ownerSizePrice`) before counting (PRODUCT_FLOW #7).
10. **fee escrow held as quote ERC20 in the vault** (not Kuru margin), separate from quote inventory; `withdraw` returns `escrow − accrued`, MM keeps `accrued − claimed`.
11. **`finalize()` catch-up bounded** to `MAX_FINALIZE_BATCH = 256` intervals per call so a huge time gap can't OOG; call again to continue.

**Open decisions still needing you:**
- Mandate mutability granularity (currently issuer may edit economic knobs only in CREATED; market/tokens/issuer are immutable). Confirm this is the desired lock scope.
- Whether AMM-vault fills against the vault's own orders are desirable (band uses AMM-inclusive mid); product-level choice.
- Production fee-token = real USDC (mainnet); testnet uses a mock. Confirm the mainnet quote/fee token.

---

## 5. Governor drift bound + checkpoint fail-dominance

**Governor drift (quantified).** The cap is enforced as `netSoldInWindow + restingAskBaseAfter ≤
cap` at every `quote`. Windows are fixed: `windowIndex = (now − activatedAt)/windowLength`; on the
first interaction in a new window (`quote`/`cancel`/`checkpoint`/`poke`) the vault snapshots
`soldAtWindowStart = soldBaseSigned()`. **Drift:** fills that occur *after* a window boundary but
*before* the first `poke` are attributed to the **previous** window (they land in `soldBase`
before the snapshot). The bound on mis-attributed volume is the base fillable in that gap, which
is **≤ the vault's resting-ask depth at the boundary ≤ cap** (the governor never let more than
`cap` of ask exposure rest). So per-window net-sold ≤ `cap + (resting-ask depth at boundary)`.
Mitigation: the keeper calls `poke()` at each boundary, driving drift → 0. Tested:
`Governor.test_driftBound_fillBeforePoke_attributedToPrevWindow` (a 30-base fill pre-poke is
attributed to the old window; the new window starts at ~0). The invariant suite asserts
`netSoldInWindow ≤ cap + 51e18` under the poked regime.

**Checkpoint fail-dominance.** `intervalIndex = (now − activatedAt)/checkpointInterval`. Each
`checkpoint()` records `passed` or `failed` for the current interval; an interval **pays iff
`observed && passed && !failed`**. A single failing observation sets a sticky `failed` flag, so a
later "fixed" passing observation cannot rescue the fee — the MM cannot game the fee by only
quoting well at the tick it expects to be checked, because *anyone* can checkpoint at the worst
moment. Finalization is lazy (on the next observed interval, or `finalize()` after ENDED); the
fee accrues at most once per interval and never beyond escrow. Tested exhaustively in
`test/covenant/Checkpoint.t.sol` (pass; no-bid; no-ask; wide-spread; thin-depth; pass-then-fail
same interval → unpaid; unobserved → unpaid+neutral; paused → neither; K-consecutive-fails →
early terminate; lazy finalize across skipped intervals).

---

## 6. Test results, invariants, gas, sizes, Slither

**Suites (all pass on fork):**
| Suite | Tests |
|---|---|
| covenant/Factory | 5 |
| covenant/StateMachine | 7 |
| covenant/Roles | 5 |
| covenant/Quote | 8 |
| covenant/Governor | 5 |
| covenant/Checkpoint | 10 |
| covenant/Fees | 3 |
| covenant/Adversarial | 6 |
| covenant/Views | 6 |
| covenant/Lifecycle | 1 |
| **covenant unit total** | **56** |
| covenant/Invariant | 4 (40 runs × 800 calls, 0 reverts) |
| spike suites (Phase 1–9) | 37 |
| **grand total** | **97** |

**Invariants (handler-based fuzz):** MM never gains base and gains quote only via claimed fees;
`accrued ≤ escrow`, `claimed ≤ accrued`; open orders/side ≤ max; `netSoldInWindow ≤ cap + drift`.

**Gas (used; Monad charges the LIMIT — set estimate + ~15%):**
| Function | Median gas used |
|---|---|
| activate | 41,865 |
| cancel (1 order) | 113,481 |
| checkpoint | 150,128 (max 236,466) |
| claimFees | 68,356 |
| depositInventory | 171,754 |
| previewQuote | 91,379 |
| snapshot | 118,862 |
| quote (two-sided place, band+cap+governor+batchUpdate) | 556,267 |

The heavy items (`quote`, `checkpoint`, `snapshot`) iterate the vault's open-order lists, so cost
grows with open orders/side — bounded by `maxOpenPerSide` (1..10, default 5); the spike measured
this O(N) behavior (soldBase 5.9k@1 → 299k@100). Keep `maxOpenPerSide` small (default 5).

**Contract sizes (24 KB limit):** CovenantVault **18,429 B** (margin 6,147 B); CovenantFactory
**3,411 B**. Both comfortably under.

**Slither 0.11.6:** 18 findings, **0 real vulnerabilities**:
- *reentrancy-no-eth* on `quote`/`cancelAllAfterEnd`/`withdraw` — false positives: all three carry
  `nonReentrant`, and the only external calls are to the fixed, trusted Kuru OrderBook/
  MarginAccount (validated at init, not attacker-controlled). Reentrancy is tested blocked
  (`Adversarial.test_reentrancyOnClaim_blocked` with a malicious fee token).
- *unused-return* on `getMarketParams()`/`s_orders()` tuple reads — intended; we consume only the
  fields we need.
- *uninitialized-local* on accumulators (`k`, `amount`, `newAskBase`, `hiBid`) — intended
  zero-initialization for counters/sums.
- `via_ir=true` (needed for stack depth); `forge fmt` clean.

---

## 7. Testnet deployment (live) + smoke-run tx hashes

Deployed on Monad testnet (chain 10143) via `forge script script/DeployCovenant.s.sol
--broadcast --gas-estimate-multiplier 115`. `ONCHAIN EXECUTION COMPLETE & SUCCESSFUL`, ~1.06 MON.
Addresses in `deployments/testnet.json`:

| Contract | Address |
|---|---|
| CovenantFactory | `0xD9163757C1CCefdDE239B595d96EA725735D42a9` |
| Vault implementation | `0x4A78336a98C498AE1FA9D711701E059DFA7FC4a0` |
| Smoke CovenantVault (clone) | `0x7d4459c90b34923ebAae673334149F0791972f10` |
| Kuru market | `0xcaf5c210ABc88F9dEAE449D916D9C6FE08C56a35` |
| MockBase | `0xCfaB4A4C28Ff179A318068ac4c241b04953910bF` |
| MockUSDC | `0xfd1C67C505554d85447c3111523B8F7BfBE6d127` |

Smoke-run tx hashes (all `status=true`):
| Step | Tx |
|---|---|
| Factory deploy | `0x5c3186e7d5aa1eeb06a20e5c6fb47658a0cb14219a972bb75541610b7d07b417` |
| createMandate | `0xdf7d7f271f4dc08f739b09bfc12caa8334e7e5b40347bbf178128710e603e423` |
| accept | `0x6f571f02a6d5f56b5aa77078bf79178c67f7463403537491de3a6183e79bd00f` |
| depositInventory (base) | `0x539ea1775f2fea30c86c8c36c418676291b70e709a02f7f27e657d2055642666` |
| depositInventory (quote) | `0xfb654856a5a0c0529cdda75f7c2b0f30ffaa7a2294d4c256c49b0743dba16404` |
| fundFees | `0xdd6106b5f3372b77cce08c81c87149abbbf68f9aad7adf70397feec53f78367a` |
| activate | `0x984ee6e7af770e024fb4ea9d41716cb006f6c9cc2e380242a9288ef4cde587fa` |
| quote (two-sided) | `0x7489f5e49967a560ace0da2c47e6e17788135119b7afd4df199d155c50f26ebd` |
| taker fill | `0x4cf6a0800f52c5596ac2ec5cf398e8c10efc7c8117e52c932873902b514a2a4e` |
| checkpoint | `0x09ef5a64d57822ba911ad4022f377269ea99d2abe58a0271ba61afdae57f10fe` |

Independent on-chain verification after the run: `currentState()==ACTIVE(2)`,
`soldBaseSigned()==39.96e18`, `openBidCount()==1`, `openAskCount()==1`.

---

## 8. Known risks / TODOs for the frontend day

1. **Empty-book bootstrap**: the first quote must be two-sided on a market with no reference mid.
   Frontend MM console should enforce two-sided on the opening quote (or seed via a market with
   AMM liquidity).
2. **Gas O(N) in open orders**: cap `maxOpenPerSide` low; frontend should discourage many orders.
   Monad charges the gas LIMIT — the app must set `estimate × ~1.15`, not a loose ceiling.
3. **Keeper must `poke()` at window boundaries** and `checkpoint()` each interval; otherwise
   governor drift and unpaid intervals accrue. Frontend proof page should expose "checkpoint now".
4. **`previewQuote()` returns an error selector** (bytes4) — the console maps it to the red
   preflight message; keep the selector→message map in sync with the errors in §2.
5. **Decimals/precision**: prices are pricePrecision units, sizes sizePrecision units,
   `placeAndExecuteMarketBuy._quoteAmount` is in price-precision units (spike finding) — the UI
   must convert human values.
6. **Fee/quote token** on mainnet = real USDC; swap the mock. Mainnet market creation is
   Kuru-gated (spike finding) — use a Kuru-provisioned market.

---

## 10-line summary

1. Full contract layer built: `CovenantFactory` (clones) + `CovenantVault` in `src/covenant/`.
2. Roles, CREATED→ACCEPTED→ACTIVE⇄PAUSED→ENDED→SETTLED state machine, all role/state-gated.
3. `quote()` enforces band + open-order cap + signed net-sell governor atomically via Kuru `batchUpdate`.
4. Fixed governor windows with lazy roll + `poke()`; drift bound quantified and tested.
5. Fail-dominant KPI checkpoint with lazy finalization; fee escrow accrual/claim; PRODUCT_FLOW updated.
6. Withdraw/settle returns all inventory + proceeds + unused escrow to the issuer; MM only ever gets fees.
7. `snapshot()` + `previewQuote()` power the dashboard and the MM red preflight.
8. 97 tests pass on a real-Kuru testnet fork (56 covenant unit + 4 invariants + 37 spike); Slither clean (0 real issues).
9. Deployed live on Monad testnet; full smoke mandate executed (10 tx hashes recorded); ABIs exported.
10. **No RED risks.** YELLOW: gas O(N) in open orders (cap it), keeper must poke/checkpoint, empty-book opening quote must be two-sided.
