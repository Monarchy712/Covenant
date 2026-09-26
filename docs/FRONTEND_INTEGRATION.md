# FRONTEND_INTEGRATION.md

The frontend developer should never need to read contract code. Every button maps to a typed
helper in `@covenant/shared` (returns a wagmi/viem-ready `{ address, abi, functionName, args, value? }`
plus an `approvals` pre-step list) or to an API endpoint. Reads come from `@covenant/shared` read
helpers or the API. Live events arrive via SSE.

## How to send an action

```ts
import { depositInventory, withGasBuffer } from "@covenant/shared";
import { usePublicClient, useWriteContract } from "wagmi";

const action = depositInventory(vault, baseToken, amount); // { approvals, call }

// 1) send each approval first (ERC20.approve spender=approval.spender, amount)
for (const a of action.approvals) {
  await writeContractAsync({ address: a.token, abi: erc20Abi, functionName: "approve", args: [a.spender, a.amount] });
}
// 2) estimate gas, set limit = estimate × 1.15 (Monad charges the LIMIT), send the call
const estimate = await publicClient.estimateContractGas({ ...action.call, account });
await writeContractAsync({ ...action.call, gas: withGasBuffer(estimate) });
```

**Gas rule:** ALWAYS `gas: withGasBuffer(estimate)` on every write. Monad charges the gas limit,
so never send without one, and never set a loose ceiling.

## Screen × button table

Legend: helper = `@covenant/shared` fn; ev = event emitted (indexed → SSE); refresh = what to re-fetch.

| Screen | Button/action | Helper / endpoint | Pre-steps (approvals) | Expected event(s) | Refresh from | Errors it can show |
|---|---|---|---|---|---|---|
| `/` Landing | Launch app | (route) | — | — | — | — |
| `/` Landing | View a live mandate | `GET /config` → flagshipVault → `/proof/[vault]` | — | — | `/config`, `/proof/:vault` | — |
| `/start` | Connect wallet | wagmi/RainbowKit | — | — | — | — |
| `/start` | Try demo mode | `POST /demo/session {address, role}` | — | — | response (vault, market, houseMM) | rate-limit 429 |
| `/start` | Get demo tokens | `POST /faucet {address}` | — | ERC20 `Transfer` (mint) | wallet balances | 429 cooldown |
| `/app` Issuer home | (list) | `GET /mandates?issuer=` | — | — | `/mandates` | — |
| `/app` | Create mandate | route → `/create` | — | — | — | — |
| `/create` Step1 | Create Kuru test market | `createMarket(base, quote)` | — | (market proxy deployed) | tx receipt → market addr | — |
| `/create` Step1 | (mint tokens) | `POST /faucet` | — | ERC20 `Transfer` | balances | 429 |
| `/create` Step2 | (live preview) | `plainEnglishTerms(terms)` | — | — | — | — |
| `/create` Step3 | Create mandate | `createMandate(factory, terms)` | — | `MandateCreated(vault,issuer,mm,market)` | `/mandates`, tx→vault | `BadBounds`, `ZeroAddress`, `MarketAssetMismatch` |
| `/create` Step3 | Use Covenant's demo MM | `GET /config` → houseMM addr into terms.mm | — | — | `/config` | — |
| `/create` Step4 | Approve+Deposit base | `depositInventory(vault, base, amt)` | approve base→vault | `InventoryDeposited` | `/mandates/:vault/summary`, snapshot | ERC20 allowance, `NotIssuer` |
| `/create` Step4 | Approve+Deposit quote | `depositInventory(vault, quote, amt)` | approve quote→vault | `InventoryDeposited` | snapshot | — |
| `/create` Step4 | Approve+Fund fees | `fundFees(vault, quote, amt)` | approve quote→vault | `FeesFunded` | snapshot | — |
| `/create` Step4 | Activate | `activate(vault)` | — | `Activated` | snapshot (→ ACTIVE) | `NotActivatable`, `WrongState` |
| `/mandate/[id]` | (flow strip, book, gauge, KPI, fees) | `getSnapshot`, `getOrderBook`, `GET /proof/:vault`, SSE `/stream/:vault` | — | live events animate | snapshot + SSE | — |
| `/mandate/[id]` | Pause | `pause(vault)` | — | `Paused` | snapshot | `NotIssuer`, `WrongState` |
| `/mandate/[id]` | Unpause | `unpause(vault)` | — | `Unpaused` | snapshot | `WrongState` |
| `/mandate/[id]` | Terminate | `terminate(vault)` | — | `Terminated` | snapshot (→ ENDED) | `NotIssuer`, `WrongState` |
| `/mandate/[id]` | Cancel all (after end) | `cancelAllAfterEnd(vault)` | — | `OrderCancelled`×n | snapshot | `WrongState` |
| `/mandate/[id]` | Withdraw | `withdraw(vault)` | — | `Withdrawn`, `Settled` | snapshot (→ SETTLED) | `OpenOrdersRemain`, `WrongState` |
| `/invite/[id]` | (terms preview) | `getSnapshot` + `plainEnglishTerms` | — | — | snapshot | — |
| `/invite/[id]` | Accept mandate | `accept(vault, terms)` (embeds `computeTermsHash`) | — | `MandateAccepted` | snapshot (→ ACCEPTED) | `TermsMismatch`, `NotMM`, `WrongState` |
| `/mm/[id]` | Place / Replace (quote) | `quote(vault, bidP, bidS, askP, askS, cancelIds)` | — | `OrderPlaced`×n, `OrderCancelled`×n | snapshot, `/stream` | `OutsideBand`, `TooManyOpenOrders`, `SellAllowanceExceeded`, `EmptyBook`, `NotMM`, `WrongState` |
| `/mm/[id]` | Preflight (red/green) | `preflightQuote(client, vault, …)` | — | — | — | returns `{ok, selector, message}` |
| `/mm/[id]` | Cancel | `cancel(vault, ids)` | — | `OrderCancelled` | snapshot | `NotMM` |
| `/mm/[id]` | Claim fees | `claimFees(vault)` | — | `FeeClaimed` | snapshot | `NothingToClaim`, `NotMM` |
| `/mm/[id]` | (reverted tx card) | `decodeCovenantError(revertData)` | — | — | — | any custom error → human message |
| `/proof/[id]` | (verify, no wallet) | `GET /proof/:vault` | — | — | `/proof/:vault` (explorer links) | — |
| `/proof/[id]` | Checkpoint now | `checkpoint(vault)` | — | `CheckpointObserved`, maybe `IntervalFinalized` | snapshot | `WrongState` |
| `/proof/[id]` | (roll window) | `poke(vault)` | — | `WindowRolled` (if crossed) | snapshot | — |
| `/trade/[market]` | Buy | `traderBuy(market, quote, quoteAmount, minOut)` | approve quote→market | Kuru `Trade` | orderbook, gauge, `/stream` | ERC20 allowance, Kuru revert |
| `/trade/[market]` | Sell | `traderSell(market, base, size, minOut)` | approve base→market | Kuru `Trade` | orderbook, gauge | — |

Note: `traderBuy._quoteAmount` is in **price-precision units** (spike finding), not raw tokens — convert human input with the market's `pricePrecision`.

## Reads

- `getSnapshot(client, vault)` → full dashboard `Snapshot` (state, terms, orders, margins, fees, interval flags).
- `getOrderBook(client, market, vault?)` → `{ bestBid, bestAsk, mid, vaultOrders[] }` at 18-dec scale (`uint256.max`/0 → null). Vault orders flagged. (Full L2 depth decode of `getL2Book` is a future enhancement; the mid + the vault's own orders cover the dashboard.)
- `getTermsHash(client, vault)` / `computeTermsHash(terms)` → verify before accept.
- `preflightQuote(client, vault, bidP, bidS, askP, askS, cancelIds)` → `{ ok, selector, message }` for the MM console preflight.

## Formatters & links

`formatBase` (18dp), `formatQuote` (6dp), `formatBps`, `formatPrice18` (mid/bestBidAsk), `formatPriceUnits(price, pricePrecision)`, `stateName(state)`, `explorerTxUrl(hash)`, `explorerAddressUrl(addr)`, `plainEnglishTerms(terms)`.

## SSE

Subscribe to `GET /stream/:vault` (`text/event-stream`). Each message is a JSON decoded event
`{ type, txHash, block, ...amounts }`. The stream sends a `heartbeat` comment every ~15s (keep the
connection alive / detect drops). On disconnect, reconnect with the `Last-Event-ID` header (each
event carries an `id:` = DB row id) to resume without gaps. Drive the flow-strip animation ONLY on
real events (OrderPlaced, Trade, CheckpointObserved, IntervalFinalized, FeeClaimed, etc.).

## Burner wallet (demo mode)

`POST /demo/session {address, role}` funds a browser-generated burner (the backend never holds
the key). role=`issuer` returns the house-MM address + a ready market for the wizard; role=`mm`
returns a fresh short-interval mandate that invited the burner (accept + quote in-browser);
role=`trader` returns a live mandate + market for the trade panel. Same rate limits as `/faucet`.

## Config

`GET /config` → `{ chainId, rpcUrl, explorer, factory, houseMM, flagshipVault, flagshipMarket,
faucetEnabled }`. Use it to wire addresses without hardcoding.
