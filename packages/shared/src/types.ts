export type Address = `0x${string}`;

export enum MandateState {
  CREATED = 0,
  ACCEPTED = 1,
  ACTIVE = 2,
  PAUSED = 3,
  ENDED = 4,
  SETTLED = 5,
}

export const stateName = (s: number): string =>
  ["CREATED", "ACCEPTED", "ACTIVE", "PAUSED", "ENDED", "SETTLED"][s] ?? `UNKNOWN(${s})`;

/// Mirrors CovenantTypes.Terms (all bigints on-chain).
export interface Terms {
  market: Address;
  baseToken: Address;
  quoteToken: Address;
  issuer: Address;
  mm: Address;
  netSellCapPerWindow: bigint;
  windowLength: bigint;
  bandBps: bigint;
  maxOpenPerSide: bigint;
  maxSpreadBps: bigint;
  minDepthPerSide: bigint;
  checkpointInterval: bigint;
  feePerInterval: bigint;
  duration: bigint;
  maxConsecutiveFails: bigint;
}

export interface OrderView {
  id: number;
  isBid: boolean;
  price: bigint;
  remaining: bigint;
}

/// Mirrors CovenantVault.snapshot() return.
export interface Snapshot {
  state: number;
  terms: Terms;
  activatedAt: bigint;
  endsAt: bigint;
  windowIndex: bigint;
  soldBase: bigint;
  netSoldInWindow: bigint;
  remainingAllowance: bigint;
  openOrders: OrderView[];
  baseMargin: bigint;
  quoteMargin: bigint;
  feeEscrow: bigint;
  accruedFees: bigint;
  claimedFees: bigint;
  currentInterval: bigint;
  currentObserved: boolean;
  currentPassed: boolean;
  currentFailed: boolean;
  consecutiveFails: bigint;
}
