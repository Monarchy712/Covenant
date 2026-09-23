# TECHNICAL_SPIKE_REPORT.md — Covenant × Kuru integration

**Question this spike answers:** *Can a smart-contract vault (not an EOA) control a Kuru
market-making position on Monad strongly enough to enforce a market-making mandate?*

Evidence tags: **GREEN** = proven by a test I ran or a canonical-source read · **YELLOW** =
plausible / not fully proven · **RED** = impossible or risky. Every GREEN cites a test name.
All tests run on a **Monad-testnet fork against real deployed Kuru bytecode** (chain 10143,
block 64938269). "Looks promising" is not used.

---

## 1. Executive result

**CONDITIONAL PASS → recommendation BUILD WITH TECHNICAL CAVEAT.**

A smart-contract vault can own Kuru inventory and orders directly, discover and read its own
orders on-chain, measure its own fills on-chain within a bounded error, and enforce a sell
allowance and price band atomically. No EOA / EIP-7702 path is required. The MM cannot move
issuer inventory out of vault control. The single caveat is a gas one: the on-chain
enforcement reads are O(N) in the vault's simultaneous open orders, so Covenant must cap
concurrent orders per side (or keep a running accumulator). This is an implementation detail,
not an architectural blocker.

37/37 fork tests pass **and** the full lifecycle was executed live on Monad testnet
(Phase 9, §6) — deploy → deposit → place → taker fill → cancel+replace, all `status=true`,
with the vault owning order #2 and `soldBase()=39.96e18` verified on-chain. The fork was
authoritative (testnet result identical).

---

## 2. What was proven (GREEN)

1. **Contract ownership of Kuru orders** — a contract calling `addSellOrder`/`addBuyOrder`/
   `batchUpdate` directly is recorded as the order owner (`s_orders[id].ownerAddress ==
   vault`). `LifecycleTest.test_placeAsk_recoverId`, `test_ownership_mmOwnsNothing`.
2. **Own MarginAccount custody** — vault deposits credit `key(vault, token)`; MM/attacker
   balances stay zero. `LifecycleTest.test_depositCreditsVaultMargin`.
3. **On-chain order-ID recovery** — via monotonic `s_orderIdCounter`, correct even with a
   third party interleaving orders. `LifecycleTest.test_orderId_underConcurrentThirdParty`.
4. **Own order-state reads** — owner/side/price/remaining size from `s_orders`.
5. **Cancel & atomic replace by the contract** — `test_cancel`, `test_replaceAtomic`
   (single `batchUpdate`).
6. **On-chain fill measurement** — `soldBase` from margin + resting sizes; partial/full/
   dust/two-in-a-block. `FillsTest` (7).
7. **Sell governor** — spec boundaries exact. `GovernorTest.test_specBoundaries`.
8. **Price band** — same-tx `bestBidAsk`, empty/one-sided handled. `BandTest` (6).
9. **Custody against MM/attacker** — no path drains vault inventory. `AdversarialTest` (11).
10. **No EIP-7702 dependency** — everything is a direct contract call.

## 3. What was NOT proven (YELLOW / open)

- **Mainnet market creation** — YELLOW/RED-leaning. `Router.deployProxy` is open in source
  and on testnet, but the deployed mainnet Router is reported owner-gated (Optara). Covenant
  on mainnet must use a Kuru-created market, not self-deploy. Not blocking on testnet.
- **Maker-fee sign across fee regimes** — YELLOW. Verified at makerFeeBps=10 the vault gets
  a base rebate; the net-sold formula holds. Other fee configs re-checkable with the same
  method.

## 4. Blockers

- **None architectural.** The MM cannot extract inventory (STOP CHECK C GREEN).
- **One gas caveat (not a blocker):** enforcement reads scale O(N) with the vault's own open
  orders (§7). Mitigation: cap concurrent orders or maintain a running locked/sold sum.

## 5. Contracts (addresses, interfaces)

Real Kuru testnet (verified via `cast code`, EIP-1967 impl reads — see
`docs/KURU_ARCHITECTURE.md`):

| Contract | Address | Impl |
|---|---|---|
| Router (proxy) | `0x7EFbE105Ca7415dE98F96622173458ac1c054630` | `0xaaa0f0c4…be1ed` |
| MarginAccount (proxy) | `0xd029C2D98ff85D8F64799017fE00a59B1159CE02` | `0xf10af40f…52c3` |
| KuruForwarder | `0x681bB1508E14433b148a2549ba2726454aDc9BB4` | `0x0d7295d5…b38c` |
| MonadDeployer | `0xDacd06372cEb638640c9D8466A023b7362324e1A` | (non-proxy) |
| KuruUtils | `0xE0841E0F06c5770C1D4930EC6C507ee33199C88C` | (non-proxy) |

Interfaces (`src/interfaces/`, matched to canonical source `Kuru-contracts-dex-public`
commit `2060bb27`, with evidence comments for every doc deviation): `IKuruOrderBook`,
`IKuruMarginAccount`, `IKuruRouter`. Vault under test: `src/KuruIntegrationSpike.sol`.

## 6. Transactions (hashes + explanation)

- **Fork tests:** 37/37 pass — `forge test --fork-url $RPC_URL_TESTNET`. Suites: Probe(1),
  Lifecycle(7), Fills(7)+Diag(1), Governor(2), Band(6), Adversarial(11), Gas(2). Fork
  execution uses the same bytecode as testnet, so behavior is authoritative for logic.

- **Live broadcast (Phase 9): DONE — executed on Monad testnet (chain 10143), 2026-09-23,
  blocks 64944360–64944437. Total paid 0.5788 MON.** `ONCHAIN EXECUTION COMPLETE & SUCCESSFUL`.

  Deployed artifacts (all verified live via `cast code`/`cast call`):
  | Thing | Address |
  |---|---|
  | MockBase (18dec) | `0xbfA1312f5737cA579b4643500E37E1F45B53b7Bd` |
  | MockUSDC (6dec) | `0xE6858574f60A1208B08839e4FA1C8DA5c4F2052f` |
  | Kuru market (OrderBook proxy) | `0x136d9f9249402B76f56bd6f53cEDC0c1BFeA99B8` |
  | KuruIntegrationSpike vault | `0x6855c932fb900e5eA0C8982A11895878E1B35E0F` |

  Transactions (all `status=true`):
  | Step | Tx hash | Block |
  |---|---|---|
  | MockBase deploy | `0x2e853358bb9c2a1b604ae03d41b186f692b2cef74c3cd10b0c82d9cc841eadbb` | 64944360 |
  | MockUSDC deploy | `0x81dc48e07087f08bbcf7050854cc782dbebbf02578c22f37cb9fe6f429182085` | 64944365 |
  | Router.deployProxy (market create) | `0x7fac1b6d4aeb3ad987f13e90c3245ffdd62986fdf66f888062a1d00e3c599545` | 64944370 |
  | Vault deploy | `0xfb7b146f7dfae2f2a377ae72528548df640972ef79f55bc1ba1874b785a05405` | 64944376 |
  | depositInventory (500 base) | `0x5c23bb4939468fc1f92eb401d497fa27bad1f096979e6d9f6c7e61052897ce16` | 64944392 |
  | placeAsk (id 1) | `0xc8a06a7b622283fc10846d7368a0f404ef56615a242738b446cdc112c5609831` | 64944422 |
  | taker placeAndExecuteMarketBuy | `0x108fca43ce76ff643b9a5cf049341603a684b62fc4888e6aadfb675a0fd9447a` | 64944432 |
  | replaceAskAtomic (id 2) | `0x2e02a796c5259964ef60649172ceec9d34c676fdfd0420b5b83f8f6662348caf` | 64944437 |

  **Independent on-chain verification after the run** (`cast call` against the live vault):
  `soldBase() = 39.96e18`, `restingAskBaseRaw() = 50e18`, `openAskCount() = 1`,
  `s_orders(2).ownerAddress == 0x6855…E0F` (the vault), ask, size 50 base, price 2e8+tick.
  Testnet result is byte-for-byte the fork result — the fork was authoritative.

## 7. Gas (measured, with cost table)

Gas **used** (fork, `--gas-report` medians and `GasTest` gasleft deltas):

| Op | Gas used | Notes |
|---|---|---|
| depositInventory | ~136k | transferFrom + approve + MarginAccount.deposit |
| placeAsk / placeBid (warm) | ~96–102k | +governor+band checks; O(1) in opposing book depth |
| placeAsk (cold first insert) | ~251k | fresh price-point tree node |
| cancelOrder | ~92k | |
| replaceAskAtomic (a "quote": cancel+place) | ~207k | one `batchUpdate` |
| soldBase() read | 5.9k @1 → 62k @20 → **299k @100** | **O(N) in the vault's own open orders** |

**Linearity:** placement is ~O(1) in the *opposing* book depth (a post-only order that
doesn't cross just inserts). The enforcement reads (`soldBase`/`restingAskBaseRaw`) are
**O(N) in the vault's own resting asks** because they iterate `openAskIds`. Keep concurrent
orders small or cache the locked-sum.

**Monad gas-charging model (verified from docs AND empirically on-chain):** Monad charges
the transaction's **gas LIMIT, not gas used** — no refund. Proven with the live
`replaceAskAtomic` tx `0x2e02a796…`: the tx's gas **limit** (439,519) equals the receipt's
`gasUsed` (439,519), while the same op executes in **~207k** on the fork. Monad reports and
charges the full limit. **Actionable:** forge's default limits ran ~2× true execution
(placeAsk charged 512,540 vs ~96–298k executed; replace 439,519 vs ~207k), so Covenant must
set **tight gas limits** (execution + small buffer) or it overpays ~2×.

**Cost table** — gas price `102 gwei` (measured via `cast gas-price`). MON price
**ASSUMED = $0.10** (testnet MON has no market price; substitute mainnet MON price — the
MON figures are exact, only the USD scales). A "quote" = one cancel+place (`replaceAskAtomic`,
limit budgeted 260k):

| Quotes | MON (@260k limit) | USD (@ $0.10/MON) |
|---|---|---|
| 1 | 0.0265 | $0.0027 |
| 10 | 0.265 | $0.0265 |
| 100 | 2.65 | $0.265 |
| 1,000 | 26.5 | $2.65 |

Per-op (gas-limit budgeted): deposit 0.0173 MON, place 0.0133 MON, cancel 0.0122 MON.

## 8. Order state (how IDs and state are discovered)

- **ID recovery:** `s_orderIdCounter` is a monotonic `uint40` (`_orderId = counter+1;
  counter = _orderId`). The vault reads it immediately AFTER placement — within one atomic
  tx nothing interleaves, so the value is exactly the new order's id (bid+ask ⇒ `+1`,`+2`).
  Methods considered: (a) **counter read after placement — CHOSEN, GREEN**; (b) state-mapping
  scan — unnecessary; (c) deterministic sequencing — equivalent to (a); (d) return-data
  decode — **impossible** (placement returns void). Events are not on-chain-readable, so an
  event-only method is disqualified by requirement.
- **State:** `s_orders(id)` → `(ownerAddress, size, prev, next, flippedId, price,
  flippedPrice, isBuy)`. `size` is the remaining size.

## 9. Fill tracking (exact formula and error bound)

```
soldBase = baseDepositedCumulative − getBalance(vault, base) − Σ(remaining ask size · 10^baseDec / sizePrecision)
```
- Measures **net base disposed**. Placing an ask debits base 1:1 into the order; a fill of
  `matched` base reduces the order's remaining size by exactly `matched` (gross), credits the
  taker `matched·(1−takerFeeBps)`, and credits the maker (vault) a **rebate of
  `makerFeeBps·matched` back into free base margin**.
- Therefore `soldBase = matched·(1 − makerFeeBps/1e4)`, **exact to sizePrecision integer
  rounding**. **Error bound vs gross matched:** `makerFeeBps/1e4 · matched ≤
  makerFeeBps/1e4 · allowance` (here 0.1%). Fully explained by the maker rebate; no
  unaccounted leakage (`FillsTest`, and `Diag.t.sol` raw measurement:
  gross 40 base → free +0.04, soldBase 39.96).

## 10. Ownership (who controls inventory and orders)

- **Orders:** `OrderBook` stores `Order(_msgSender(), …)` and checks `_msgSender() ==
  ownerAddress` on cancel. `ERC2771Context._msgSender()` returns `msg.sender` for any
  non-forwarder caller ⇒ a direct contract call makes the **contract** the owner. No
  `tx.origin`/`isContract`/EOA guard exists (only an informational `tx.origin` field in the
  `Trade` event). Proven: `LifecycleTest` (owner == vault), `AdversarialTest` (MM/attacker
  can't cancel the vault's order directly — owner-checked revert).
- **Margin:** `balances[keccak256(user, token)]`. `withdraw` is **self-keyed** to
  `_msgSender()`; `debitUser`/`creditUser` require `verifiedMarket[msg.sender]`. So only the
  vault (via role-gated functions) or a verified market can move the vault's margin.

## 11. Security findings (bypasses, self-trade)

- **No inventory-exfiltration path** for MM or attacker (STOP CHECK C GREEN, 11 tests):
  vault role gates, self-keyed `MarginAccount.withdraw`, verified-market-only debit, and
  owner-checked direct cancels all hold.
- **Self-trade (documented, not prevented):** a captured MM can lift the vault's own ask via
  a colluding taker. This is **not theft** — the vault receives fair proceeds at its ask
  price and the volume counts against the allowance. Max value a captured MM can bleed is
  **bounded by band × allowance**: per-unit price slack ≤ `bandBps/1e4` of mid, over at most
  `sellAllowance` base, minus taker fees they pay. `AdversarialTest.test_selfTrade_isBoundedNotTheft`.
  Covenant should tighten `bandBps` and gate the allowance/KPI payout accordingly.

## 12. Kuru compatibility

All documented deviations confirmed against canonical source and reproduced on the fork:
placement returns **void** (recover id from counter); `bestBidAsk` returns **(uint256,uint256)**
at **18-decimal scale** and **includes AMM-vault liquidity**; `placeAndExecuteMarketBuy`
`_minAmountOut` is **uint256**; its `_quoteAmount` is in **price-precision units**; resting
orders debit **MarginAccount** (deposit first, else `InsufficientBalance() 0xf4d678b8`);
`batchUpdate(buyP,buyS,sellP,sellS,cancelIds,postOnly)` is the atomic requote primitive;
`Trade.isBuy` is the taker direction. Markets created via `deployProxy` are auto-verified in
MarginAccount (`ProbeTest`).

## 13. Covenant compatibility (can the core mechanism be built?)

**Yes.** Every primitive Covenant's Vault needs exists and is contract-usable:
issuer deposit → vault-owned margin; MM quotes only through the vault (role-gated place/
cancel/replace); on-chain sold measurement drives a sell allowance; a same-tx band bounds
quote prices; the MM can never withdraw inventory. The KPI-gated payout (out of scope here)
sits on top of the same on-chain `soldBase`/order-state reads proven in Phases 4/8.

## 14. Remaining risks

1. **Gas O(N) in own open orders** — cap concurrent orders or keep a running locked/sold
   accumulator (YELLOW; mitigatable).
2. **Mainnet market creation gated** — use a Kuru-provisioned market on mainnet (YELLOW).
4. **AMM-vault interaction** — `bestBidAsk` includes AMM liquidity; band uses it as intended,
   but Covenant should decide whether AMM-vault fills against its orders are desired (design).
5. **Fee-regime dependence of the rebate term** — re-verify `soldBase` error bound if fees
   change (low risk; method in place).

## 15. Recommendation

**BUILD WITH TECHNICAL CAVEAT.** The Kuru integration underneath Covenant is sound: a
contract vault controls a Kuru MM position strongly enough to enforce a mandate, with no
EOA/7702 dependency and no inventory-exfiltration path. Proceed to build Covenant on this
foundation, with the explicit engineering constraint of **capping the vault's simultaneous
open orders (or caching the locked/sold sum)** to keep `quote()` gas bounded, and **setting
tight gas limits** (Monad charges the limit, empirically ~2× overpay otherwise). The full
lifecycle is proven both on a fork (37/37) and live on Monad testnet (§6).
