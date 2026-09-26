import { formatUnits } from "viem";
import { monadTestnet } from "./chain.js";
import { stateName } from "./types.js";
import type { Terms } from "./types.js";

/// Monad charges the gas LIMIT (spike finding). Always set limit = estimate × 1.15.
export function withGasBuffer(estimate: bigint, bps = 11_500n): bigint {
  return (estimate * bps) / 10_000n;
}

const EXPLORER = monadTestnet.blockExplorers.default.url.replace(/\/$/, "");
export const explorerTxUrl = (hash: string): string => `${EXPLORER}/tx/${hash}`;
export const explorerAddressUrl = (addr: string): string => `${EXPLORER}/address/${addr}`;

// --- formatters -----------------------------------------------------------
export const formatBase = (raw: bigint, decimals = 18): string => formatUnits(raw, decimals);
export const formatQuote = (raw: bigint, decimals = 6): string => formatUnits(raw, decimals);
export const formatBps = (bps: bigint | number): string => `${Number(bps) / 100}%`;
/// bestBidAsk / mid are at 18-decimal scale; render as a human price.
export const formatPrice18 = (p: bigint): string => formatUnits(p, 18);
/// A price in pricePrecision units → human (price / pricePrecision).
export const formatPriceUnits = (price: bigint, pricePrecision: bigint): string =>
  (Number(price) / Number(pricePrecision)).toString();
export { stateName };

/// The wizard's live plain-English preview sentence.
export function plainEnglishTerms(t: Terms, baseSymbol = "TOKEN", quoteSymbol = "USDC"): string {
  const cap = formatBase(t.netSellCapPerWindow);
  const windowH = Number(t.windowLength) / 3600;
  const band = Number(t.bandBps) / 100;
  const fee = formatQuote(t.feePerInterval);
  const iv = Number(t.checkpointInterval) / 60;
  const days = Number(t.duration) / 86400;
  return (
    `Your market maker may net-sell at most ${cap} ${baseSymbol} per ${windowH}h window, ` +
    `must quote within ±${band}% of mid, and earns ${fee} ${quoteSymbol} per passing ` +
    `${iv}-minute checkpoint, for ${days} days.`
  );
}

/// Reverse-map a previewQuote() selector to a human message (Part 5 preflightQuote uses this).
export interface PreflightResult {
  ok: boolean;
  selector: `0x${string}`;
  message: string;
}
