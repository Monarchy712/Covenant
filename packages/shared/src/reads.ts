import type { PublicClient } from "viem";
import { covenantVaultAbi, kuruOrderBookAbi } from "./abis.js";
import { ERROR_MESSAGES, errorSelector } from "./errors.js";
import type { Address, Snapshot } from "./types.js";
import type { PreflightResult } from "./utils.js";

const U256_MAX = (1n << 256n) - 1n;

/// One-call dashboard snapshot (on-chain).
export async function getSnapshot(client: PublicClient, vault: Address): Promise<Snapshot> {
  const s = (await client.readContract({
    address: vault,
    abi: covenantVaultAbi,
    functionName: "snapshot",
  })) as unknown as Snapshot;
  return s;
}

export async function getTermsHash(client: PublicClient, vault: Address): Promise<`0x${string}`> {
  return (await client.readContract({
    address: vault,
    abi: covenantVaultAbi,
    functionName: "termsHash",
  })) as `0x${string}`;
}

/// Top-of-book from Kuru (18-dec scale; uint256.max means that side is empty), plus the
/// vault's own resting orders flagged. NOTE: full L2-depth decode of getL2Book is deferred;
/// the dashboard needs the mid (band reference) + the vault's own orders, both provided here.
export interface OrderBookView {
  bestBid: bigint | null;
  bestAsk: bigint | null;
  mid: bigint | null;
  vaultOrders: { id: number; isBid: boolean; price: bigint; remaining: bigint }[];
}

export async function getOrderBook(
  client: PublicClient,
  market: Address,
  vault?: Address,
): Promise<OrderBookView> {
  const [bid, ask] = (await client.readContract({
    address: market,
    abi: kuruOrderBookAbi,
    functionName: "bestBidAsk",
  })) as [bigint, bigint];
  const bestBid = bid === U256_MAX || bid === 0n ? null : bid;
  const bestAsk = ask === U256_MAX || ask === 0n ? null : ask;
  let mid: bigint | null = null;
  if (bestBid !== null && bestAsk !== null) mid = (bestBid + bestAsk) / 2n;
  else if (bestBid !== null) mid = bestBid;
  else if (bestAsk !== null) mid = bestAsk;

  let vaultOrders: OrderBookView["vaultOrders"] = [];
  if (vault) {
    const s = (await client.readContract({
      address: vault,
      abi: covenantVaultAbi,
      functionName: "snapshot",
    })) as any;
    vaultOrders = (s.openOrders as any[]).map((o) => ({
      id: Number(o.id),
      isBid: o.isBid,
      price: o.price as bigint,
      remaining: o.remaining as bigint,
    }));
  }
  return { bestBid, bestAsk, mid, vaultOrders };
}

// selector -> error name (built once from the vault ABI)
const SELECTOR_TO_NAME: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const e of covenantVaultAbi as any[]) {
    if (e.type === "error") m[errorSelector(e.name)] = e.name;
  }
  return m;
})();

/// Wrap previewQuote(): returns { ok, selector, message }. selector 0x00000000 == OK.
export async function preflightQuote(
  client: PublicClient,
  vault: Address,
  bidPrices: bigint[],
  bidSizes: bigint[],
  askPrices: bigint[],
  askSizes: bigint[],
  cancelIds: bigint[],
): Promise<PreflightResult> {
  const sel = (await client.readContract({
    address: vault,
    abi: covenantVaultAbi,
    functionName: "previewQuote",
    args: [bidPrices, bidSizes, askPrices, askSizes, cancelIds],
  })) as `0x${string}`;
  if (sel === "0x00000000") return { ok: true, selector: sel, message: "OK" };
  const name = SELECTOR_TO_NAME[sel];
  const message = name ? (ERROR_MESSAGES[name]?.([]) ?? `Would revert: ${name}`) : `Would revert (${sel})`;
  return { ok: false, selector: sel, message };
}
