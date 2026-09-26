import { type Abi, encodeAbiParameters, keccak256 } from "viem";
import { covenantVaultAbi, covenantFactoryAbi, kuruRouterAbi, kuruOrderBookAbi, mockErc20Abi } from "./abis.js";
import { KURU } from "./chain.js";
import type { Address, Terms } from "./types.js";

/// wagmi/viem-ready write descriptor. Feed straight into `writeContract(call)`.
export interface PreparedCall {
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  value?: bigint;
}

/// An ERC20 approval the caller must send BEFORE the main call (spender pulls `amount`).
export interface Approval {
  token: Address;
  spender: Address;
  amount: bigint;
}

/// A user action: optional approval pre-steps, then the main call.
export interface Action {
  approvals: Approval[];
  call: PreparedCall;
}

const V = covenantVaultAbi;

/// Standard demo-market params (mirror the deployed testnet market; see CONTRACTS_REPORT).
export const DEMO_MARKET = {
  sizePrecision: 10_000_000_000n, // 1e10
  pricePrecision: 100_000_000n, // 1e8
  tickSize: 100n,
  minSize: 100_000_000n, // 1e8
  maxSize: 10_000_000_000_000_000n, // 1e16
  takerFeeBps: 30n,
  makerFeeBps: 10n,
  ammSpread: 100n,
} as const;

// ---------------------------------------------------------------------------
// Terms hash (local) — must equal keccak256(abi.encode(terms)) on-chain.
// ---------------------------------------------------------------------------
const TERMS_TUPLE = {
  type: "tuple",
  components: [
    { name: "market", type: "address" },
    { name: "baseToken", type: "address" },
    { name: "quoteToken", type: "address" },
    { name: "issuer", type: "address" },
    { name: "mm", type: "address" },
    { name: "netSellCapPerWindow", type: "uint256" },
    { name: "windowLength", type: "uint256" },
    { name: "bandBps", type: "uint256" },
    { name: "maxOpenPerSide", type: "uint256" },
    { name: "maxSpreadBps", type: "uint256" },
    { name: "minDepthPerSide", type: "uint256" },
    { name: "checkpointInterval", type: "uint256" },
    { name: "feePerInterval", type: "uint256" },
    { name: "duration", type: "uint256" },
    { name: "maxConsecutiveFails", type: "uint256" },
  ],
} as const;

export function computeTermsHash(t: Terms): `0x${string}` {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return keccak256(encodeAbiParameters([TERMS_TUPLE] as any, [t] as any));
}

// ---------------------------------------------------------------------------
// market
// ---------------------------------------------------------------------------
export function createMarket(base: Address, quote: Address): Action {
  return {
    approvals: [],
    call: {
      address: KURU.router as Address,
      abi: kuruRouterAbi as unknown as Abi,
      functionName: "deployProxy",
      args: [
        0, // NO_NATIVE
        base,
        quote,
        DEMO_MARKET.sizePrecision,
        DEMO_MARKET.pricePrecision,
        DEMO_MARKET.tickSize,
        DEMO_MARKET.minSize,
        DEMO_MARKET.maxSize,
        DEMO_MARKET.takerFeeBps,
        DEMO_MARKET.makerFeeBps,
        DEMO_MARKET.ammSpread,
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// mandate setup
// ---------------------------------------------------------------------------
export function createMandate(factory: Address, terms: Terms): Action {
  return { approvals: [], call: { address: factory, abi: covenantFactoryAbi, functionName: "createMandate", args: [terms] } };
}

export function updateTerms(vault: Address, terms: Terms): Action {
  return { approvals: [], call: { address: vault, abi: V, functionName: "updateTerms", args: [terms] } };
}

export function setMM(vault: Address, mm: Address): Action {
  return { approvals: [], call: { address: vault, abi: V, functionName: "setMM", args: [mm] } };
}

/// accept pins the terms hash the MM reviewed (computed locally from `terms`).
export function accept(vault: Address, terms: Terms): Action {
  return { approvals: [], call: { address: vault, abi: V, functionName: "accept", args: [computeTermsHash(terms)] } };
}

/// depositInventory pulls `amount` of `token` from the issuer via the vault → approve the VAULT.
export function depositInventory(vault: Address, token: Address, amount: bigint): Action {
  return {
    approvals: [{ token, spender: vault, amount }],
    call: { address: vault, abi: V, functionName: "depositInventory", args: [token, amount] },
  };
}

export function fundFees(vault: Address, quoteToken: Address, amount: bigint): Action {
  return {
    approvals: [{ token: quoteToken, spender: vault, amount }],
    call: { address: vault, abi: V, functionName: "fundFees", args: [amount] },
  };
}

export const activate = (vault: Address): Action => noArg(vault, "activate");

// ---------------------------------------------------------------------------
// controls (issuer)
// ---------------------------------------------------------------------------
export const pause = (vault: Address): Action => noArg(vault, "pause");
export const unpause = (vault: Address): Action => noArg(vault, "unpause");
export const terminate = (vault: Address): Action => noArg(vault, "terminate");

// ---------------------------------------------------------------------------
// MM trading
// ---------------------------------------------------------------------------
export function quote(
  vault: Address,
  bidPrices: bigint[],
  bidSizes: bigint[],
  askPrices: bigint[],
  askSizes: bigint[],
  cancelIds: bigint[],
): Action {
  return {
    approvals: [],
    call: { address: vault, abi: V, functionName: "quote", args: [bidPrices, bidSizes, askPrices, askSizes, cancelIds] },
  };
}

export function cancel(vault: Address, ids: bigint[]): Action {
  return { approvals: [], call: { address: vault, abi: V, functionName: "cancel", args: [ids] } };
}

export const claimFees = (vault: Address): Action => noArg(vault, "claimFees");

// ---------------------------------------------------------------------------
// anyone
// ---------------------------------------------------------------------------
export const checkpoint = (vault: Address): Action => noArg(vault, "checkpoint");
export const poke = (vault: Address): Action => noArg(vault, "poke");
export const cancelAllAfterEnd = (vault: Address): Action => noArg(vault, "cancelAllAfterEnd");
export const finalize = (vault: Address): Action => noArg(vault, "finalize");
export const withdraw = (vault: Address): Action => noArg(vault, "withdraw");

// ---------------------------------------------------------------------------
// trade panel (Kuru market orders, direct to the market)
// ---------------------------------------------------------------------------
/// Buy base off the book. NOTE: `_quoteAmount` is in PRICE-PRECISION units (spike finding),
/// not raw quote tokens. Trader approves the MARKET to pull quote (isMargin=false).
export function traderBuy(market: Address, quoteToken: Address, quoteAmount: bigint, minAmountOut = 0n): Action {
  return {
    approvals: [{ token: quoteToken, spender: market, amount: 2n ** 255n }],
    call: {
      address: market,
      abi: kuruOrderBookAbi as unknown as Abi,
      functionName: "placeAndExecuteMarketBuy",
      args: [quoteAmount, minAmountOut, false, false],
    },
  };
}

/// Sell base into the book. `size` is in sizePrecision units. Trader approves the MARKET for base.
export function traderSell(market: Address, baseToken: Address, size: bigint, minAmountOut = 0n): Action {
  return {
    approvals: [{ token: baseToken, spender: market, amount: 2n ** 255n }],
    call: {
      address: market,
      abi: kuruOrderBookAbi as unknown as Abi,
      functionName: "placeAndExecuteMarketSell",
      args: [size, minAmountOut, false, false],
    },
  };
}

/// mintDemoTokens is served by the API (POST /faucet), not an on-chain user call.
export const mintDemoTokensEndpoint = "/faucet";

// ---------------------------------------------------------------------------
function noArg(vault: Address, fn: string): Action {
  return { approvals: [], call: { address: vault, abi: V, functionName: fn, args: [] } };
}
