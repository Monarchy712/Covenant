import CovenantVaultAbi from "../abi/CovenantVault.json" with { type: "json" };
import CovenantFactoryAbi from "../abi/CovenantFactory.json" with { type: "json" };

import type { Abi } from "viem";

export const covenantVaultAbi = CovenantVaultAbi as unknown as Abi;
export const covenantFactoryAbi = CovenantFactoryAbi as unknown as Abi;

/// Minimal Kuru OrderBook ABI the services need: the Trade event (fill attribution via
/// makerAddress), bestBidAsk, s_orders, s_orderIdCounter, and the taker/maker calls used by bots.
/// Matches the spike's IKuruOrderBook (docs/KURU_ARCHITECTURE.md).
export const kuruOrderBookAbi = [
  {
    type: "event",
    name: "Trade",
    inputs: [
      { name: "orderId", type: "uint40", indexed: false },
      { name: "makerAddress", type: "address", indexed: false },
      { name: "isBuy", type: "bool", indexed: false },
      { name: "price", type: "uint256", indexed: false },
      { name: "updatedSize", type: "uint96", indexed: false },
      { name: "takerAddress", type: "address", indexed: false },
      { name: "txOrigin", type: "address", indexed: false },
      { name: "filledSize", type: "uint96", indexed: false },
    ],
  },
  {
    type: "function",
    name: "bestBidAsk",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "bestBid", type: "uint256" },
      { name: "bestAsk", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "addBuyOrder",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_price", type: "uint32" },
      { name: "_size", type: "uint96" },
      { name: "_postOnly", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "addSellOrder",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_price", type: "uint32" },
      { name: "_size", type: "uint96" },
      { name: "_postOnly", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "placeAndExecuteMarketBuy",
    stateMutability: "payable",
    inputs: [
      { name: "_quoteAmount", type: "uint96" },
      { name: "_minAmountOut", type: "uint256" },
      { name: "_isMargin", type: "bool" },
      { name: "_isFillOrKill", type: "bool" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "placeAndExecuteMarketSell",
    stateMutability: "payable",
    inputs: [
      { name: "_size", type: "uint96" },
      { name: "_minAmountOut", type: "uint256" },
      { name: "_isMargin", type: "bool" },
      { name: "_isFillOrKill", type: "bool" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "s_orderIdCounter",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint40" }],
  },
] as const;

/// Mintable mock ERC20 (testnet faucet + bots).
export const mockErc20Abi = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "a", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;
