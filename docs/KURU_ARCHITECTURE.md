# KURU_ARCHITECTURE.md — Phase 1

**Goal of this doc:** establish the *real* Kuru architecture on Monad from observed
on-chain state and canonical source, so the spike contract can be written against
OBSERVED signatures, not docs.

**Evidence tags:** GREEN = proven by an on-chain read / tx / canonical source I
inspected. YELLOW = plausible, not fully proven. RED = impossible / risky.

---

## 1. Sources used (provenance)

| Source | What it gave | Trust |
|---|---|---|
| `Kuru-Labs/Kuru-contracts-dex-public` @ `2060bb27` (2026-04-15) | **Canonical Solidity source** for OrderBook, MarginAccount, Router, KuruForwarder, ERC2771Context | GREEN — this is the real implementation source |
| `Kuru-Labs/kuru-sdk` (`abi/*.json` Hardhat artifacts) | ABIs for OrderBook, MarginAccount, Router, MonadDeployer, KuruUtils | GREEN — matches deployed selectors |
| `paulwesley6679-beep/monad-maize` (`spike/`) | Real **testnet** run: `Router.deployProxy` created a market, post-only maker order placed, taker fill, verified via `s_orders`/`getL2Book`/`Trade`. Addresses sourced from docs.kuru.io | GREEN — independent testnet proof, addresses re-verified below |
| `Synsight-lab/Optara` (`test/fork/interfaces/IKuru.sol`) | Mainnet-fork ground-truth corrections (return-data, struct layout, margin-debit, deployProxy gate) | GREEN — corrections independently reproduced by source read |
| `tima-t/deltamon`, `jarrodwatts/jev-trader` | Contract-side Kuru adapters + fork tests (`KuruSpotAdapter.sol`, `KuruMainnetFork.t.sol`) | YELLOW — reference only, not re-run here |

---

## 2. Deployed contracts (addresses)

`cast code` byte counts observed live on Monad testnet (chain 10143) on 2026-09-23.
141-byte contracts are ERC1967 proxies; impl read from EIP-1967 slot
`0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc`.

| Contract | Address | Network | Source/ABI origin | Purpose | Contract-callable? | EOA-only? | Permissions | Key functions |
|---|---|---|---|---|---|---|---|---|
| Router (proxy) | `0x7EFbE105Ca7415dE98F96622173458ac1c054630` → impl `0xaaa0f0c4d49d09ef33ae758d88afab810ecbe1ed` | testnet | docs.kuru.io + verified `cast code` (141B proxy) + kuru-sdk ABI | Deploy markets, registry | **YES** | no | `deployProxy` **not** `onlyOwner` in source (testnet open; mainnet gated — see §6) | `deployProxy`, `verifiedMarket`, `orderBookImplementation` |
| MarginAccount (proxy) | `0xd029C2D98ff85D8F64799017fE00a59B1159CE02` → impl `0xf10af40f060b7ae54a2d5da682becc981dfb52c3` | testnet | same | Custody of trader balances | **YES** | no | `deposit` open; `withdraw` self-keyed; `debit/creditUser` verified-market-only | `deposit`, `withdraw`, `getBalance`, `balances` |
| KuruForwarder (proxy) | `0x681bB1508E14433b148a2549ba2726454aDc9BB4` → impl `0x0d7295d5e52b9269000ea6e60cc29af7d1b1b38c` | testnet | same | ERC2771 meta-tx relayer (for EOAs) | n/a | no | trusted-forwarder only | not needed by a contract |
| MonadDeployer | `0xDacd06372cEb638640c9D8466A023b7362324e1A` (6703B, non-proxy) | testnet | kuru-sdk ABI | Token+market bundle deployer | YES | no | — | `deployTokenAndMarket` |
| KuruUtils | `0xE0841E0F06c5770C1D4930EC6C507ee33199C88C` (8017B, non-proxy) | testnet | kuru-sdk ABI | View helpers | YES | no | — | book/price helpers |
| Testnet USDC | `0x3bA3d39AFcf8bb994f7964B3e0171Ea2Ba361570` (1737B) | testnet | docs.kuru.io | Official quote token (no public mint) | YES | no | — | ERC20 |
| MON/USDC market (proxy) | `0xa241896A7Dbe8a550D2E5fF7A914bB1989ceD2D9` → impl `0x72cae0a99c19b574e8a6de558f43fc1d019c9374` (35548B) | testnet | docs.kuru.io | Example OrderBook (reportedly no liquidity) | YES | no | per-market | `addBuyOrder`/`addSellOrder`/`batchUpdate`/`s_orders`… |

Mainnet (reference only, from repo configs — **not** re-verified here, mark UNKNOWN until checked):
Router `0xd651346d7c789536ebf06dc72aE3C8502cd695CC`, MarginAccount
`0x2A68ba1833cDf93fa9Da1EEbd7F46242aD8E90c5`. UNKNOWN precision until `cast code`.

> Rule followed: no address here is invented. Every testnet row was confirmed with
> `cast code` (byte counts above) and, for proxies, an EIP-1967 impl read.

---

## 3. OrderBook — the decisive ownership finding (GREEN)

`OrderBook is Initializable, UUPSUpgradeable, ERC2771Context, AbstractAMM`.

Order ownership is set to **`_msgSender()`** everywhere:
- Placement stores `s_orders[id] = Order(_msgSender(), size, …)` (OrderBook.sol:377)
  and `emit OrderCreated(id, _msgSender(), …)` (:381).
- Cancel requires `_msgSender() == _order.ownerAddress` (:518, :531).

`ERC2771Context._msgSender()` returns:
```
isTrustedForwarder(msg.sender) ? <address parsed from calldata suffix> : msg.sender
```
A contract calling the OrderBook **directly** is not the trusted forwarder, so
`_msgSender() == msg.sender == the calling contract`. **The contract is the order owner.**

- **No `tx.origin` guard.** The only `tx.origin` in the whole `contracts/` tree is an
  *informational field* in the `Trade` event (OrderBook.sol:1234), not a check.
- **No `isContract`/`extcodesize`/EOA guard anywhere** (grep of `contracts/` returned only that event line).

⇒ A smart-contract vault can own Kuru orders and margin **directly, with no EIP-7702
and no EOA requirement.** The kuru-sdk-py "MM Entrypoint / 7702" path exists only so
*EOAs* can batch; a contract just calls `batchUpdate` itself. **Core hypothesis PROVEN at source level** (empirical confirmation: Phase 3 tests).

### Order-ID recovery (GREEN, deterministic)
`uint40 public s_orderIdCounter;` is a **monotonic counter**. Every placement does
`_orderId = s_orderIdCounter + 1; s_orderIdCounter = _orderId;` (:201-202, :242-243,
:272-273, :309-310). Therefore:
- Placing exactly one resting order in the vault's own tx ⇒ its ID ==
  `s_orderIdCounter()` read immediately after (or `before + 1`).
- Placing bid+ask ⇒ IDs `before+1` and `before+2`, in call order.
- **Concurrency safety:** within one EVM transaction nothing else executes between the
  internal add and the counter read, so third-party orders in the same *block* cannot
  interleave inside the vault's *call*. Reading the counter inside the same tx is
  race-free. (post-only maker orders always rest ⇒ always get an ID.)

### Order state read (GREEN)
`s_orders(uint40) →
(address ownerAddress, uint96 size, uint40 prev, uint40 next, uint40 flippedId,
 uint32 price, uint32 flippedPrice, bool isBuy)`.
`size` is the **remaining** size (decremented on fills). Owner, side, price, remaining
size all readable on-chain by the vault.

### Documented deviations — all confirmed against source (GREEN)
| Doc claim | Reality (source) | Evidence |
|---|---|---|
| `addBuyOrder/addSellOrder` return `uint40 orderId` | Return **nothing** (`external` void) | IOrderBook.sol + Optara fork note |
| `bestBidAsk()` returns `(uint32,uint32)` | `(uint256,uint256)`; "no side" = `type(uint256).max` | ABI + Optara fork note |
| `placeAndExecuteMarketBuy` `_minAmountOut` uint96 | **uint256** (changes selector) | source signature |
| resting orders debit wallet | debit **MarginAccount** balance; need `deposit()` first, else `InsufficientBalance()` `0xf4d678b8` | `_consumeFunds → debitUser` |
| `Trade.isBuy` | **taker** direction; price at 18-dec scale | event + Optara note |

### batchUpdate (GREEN — atomic cancel+place by the contract)
`batchUpdate(uint32[] buyPrices, uint96[] buySizes, uint32[] sellPrices,
uint96[] sellSizes, uint40[] orderIdsToCancel, bool postOnly)`.
Body: cancels each id via `_cancelOrder` (owner-checked vs `_msgSender()`), then places
buys then sells via `addBuyOrder/addSellOrder` (owned by `_msgSender()`). One call, one
`_msgSender()` = the vault. This is the requoting primitive; **no 7702 needed**.

---

## 4. MarginAccount — custody model (GREEN, ideal for Covenant)

`balances[keccak256(abi.encodePacked(user, token))]` (`_accountKey`).

| Function | Access | Effect | Covenant relevance |
|---|---|---|---|
| `deposit(user, token, amt)` | open | credits `key(user,token)`, pulls tokens from **caller** (`_msgSender()`) | Vault calls `deposit(address(this), …)` → funds its **own** margin |
| `withdraw(amt, token)` | **self-keyed** | touches only `balances[key(_msgSender(), token)]` | **MM/attacker can only withdraw their OWN margin — never the vault's** (BLOCKER-preventer) |
| `debitUser` / `creditUser` / `creditUsersEncoded` | `require(verifiedMarket[msg.sender])` | move margin | Only a verified OrderBook can move the vault's margin; no EOA can |
| `getBalance(user, token)` / `balances(key)` | view | read | Vault reads its own margin on-chain |

⇒ Custody is enforced by the protocol: (1) withdraw is self-only, (2) only verified
markets can debit, (3) deposits credit the named user. **Empirical: Phase 7.**

---

## 5. Fill tracking formula (YELLOW→GREEN pending Phase 4)

Placing an ask: `debitUser(vault, base, size·baseMult/sizePrec)` — base leaves margin,
locked in the resting order. Cancel credits back the **remaining** size
(OrderBook.sol:587). On a fill, the maker (vault) is credited **quote** via
`creditUsersEncoded`; the ask's `size` in `s_orders` drops by the filled amount. Base
sold to the taker carries **no maker fee** (maker fee is applied on the quote proceeds;
taker fee on the taker's base credit).

**Vault sold-base invariant (exact on the base side):**
```
baseSold = baseDepositedCumulative
         − getBalance(vault, base)                       // current free margin
         − Σ_over_vault_open_asks( s_orders[id].size · baseMult / sizePrec )
```
- `baseDepositedCumulative`: the vault records this (it performs the deposits).
- The vault tracks its own ask IDs (it placed them).
- Only rounding is the deterministic `·baseMult/sizePrec` integer division ⇒ bounded
  error < 1 `sizePrecision` tick per order edge. Fees do not touch base-sold.
Quote received is the mirror: `getBalance(vault, quote)` rise = proceeds net of maker fee.
**To be confirmed empirically in Phase 4** (partial fills, two-in-a-block, dust).

---

## 6. Permissions / gotchas

- **`Router.deployProxy` is NOT `onlyOwner` in canonical source.** Optara reports the
  *deployed mainnet* Router gates it (an upgraded/owner-gated deployment); monad-maize
  created a testnet market via `deployProxy` successfully. ⇒ **testnet: open (use it);
  mainnet: expect a gate.** Verified empirically in Phase 2.
- `OrderBookType`: `NO_NATIVE=0`, `NATIVE_IN_BASE=1`, `NATIVE_IN_QUOTE=2`. Use `0` for
  ERC20/ERC20 (both mocks are ERC20).
- `deposit`/order sizes are in *market precision units* (`sizePrecision`,
  `pricePrecision`), not raw token decimals. `getMarketParams()` returns
  `(uint32 pricePrecision, uint96 sizePrecision, address base, uint256 baseDec,
  address quote, uint256 quoteDec, uint32 tickSize, uint96 minSize, uint96 maxSize,
  uint256 takerFeeBps, uint256 makerFeeBps)`.
- Monad gas-on-gas-limit claim: to verify in Phase 8.

---

## 7. Phase 1 verdict

| Question | Verdict |
|---|---|
| Can a contract own Kuru orders? | **GREEN** (source: `_msgSender()`, no EOA guard) |
| Can a contract deposit/withdraw its own margin? | **GREEN** (source) |
| Can a contract recover its order ID on-chain? | **GREEN** (source: `s_orderIdCounter`) |
| Can a contract read its own order state? | **GREEN** (`s_orders`) |
| Atomic cancel+place by contract? | **GREEN** (`batchUpdate`) |
| Does it need EIP-7702? | **NO** (7702 is an EOA-only convenience) |
| Can the MM steal margin? | **GREEN-negative** (withdraw self-keyed, debit market-only) — confirm Phase 7 |

All source-level greens require **empirical** confirmation on a fork / testnet
(Phases 2-9). No claim here is promoted to a final GREEN in the report without a test
name or tx hash.
