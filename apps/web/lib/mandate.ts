import { formatUnits } from "viem";

/** Human "time left" until a unix timestamp (seconds). */
export function timeLeft(endsAtSec: number | string): string {
  const end = Number(endsAtSec);
  const s = end - Math.floor(Date.now() / 1000);
  if (s <= 0) return "ended";
  const d = Math.floor(s / 86400);
  if (d >= 1) return `${d}d left`;
  const h = Math.floor(s / 3600);
  if (h >= 1) return `${h}h left`;
  const m = Math.floor(s / 60);
  return `${m}m left`;
}

export const toBase = (raw: string | bigint): number => Number(formatUnits(BigInt(raw), 18));
export const toQuote = (raw: string | bigint): number => Number(formatUnits(BigInt(raw), 6));
export const fmtNum = (n: number, max = 2): string =>
  n.toLocaleString("en-US", { maximumFractionDigits: max });
