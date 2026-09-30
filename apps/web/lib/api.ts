/**
 * Typed client for the Covenant backend (hosted on Railway).
 * Base comes from NEXT_PUBLIC_API_URL; never hardcode addresses — read them from /config.
 */
export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
  "https://covenantservices-production.up.railway.app";

export interface CovenantConfig {
  chainId: number;
  rpcUrl: string;
  explorer: string;
  factory: `0x${string}`;
  houseMM: `0x${string}`;
  flagshipVault: `0x${string}`;
  flagshipMarket: `0x${string}`;
  base: `0x${string}`;
  quote: `0x${string}`;
  faucetEnabled: boolean;
  flagship: {
    vault: `0x${string}`;
    botsOn: boolean;
    lastActiveTs: number;
  };
}

export interface ProofInterval {
  interval: number;
  paid: number; // 0 | 1
  amount: string;
  finalizedBlock: number;
}

export interface ProofResponse {
  vault: `0x${string}`;
  vaultUrl: string;
  state: number;
  stateName: string;
  terms: {
    market: `0x${string}`;
    baseToken: `0x${string}`;
    quoteToken: `0x${string}`;
    issuer: `0x${string}`;
    mm: `0x${string}`;
    netSellCapPerWindow: string;
    windowLength: string;
    bandBps: string;
    maxOpenPerSide: string;
    maxSpreadBps: string;
    minDepthPerSide: string;
    checkpointInterval: string;
    feePerInterval: string;
    duration: string;
    maxConsecutiveFails: string;
  };
  netSoldInWindow: string;
  remainingAllowance: string;
  cap: string;
  accruedFees: string;
  consecutiveFails: string;
  compliance: {
    observed: number;
    passed: number;
    paidIntervals: number;
    intervals: ProofInterval[];
  };
}

async function getJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { accept: "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return (await res.json()) as T;
}

export const fetchConfig = (init?: RequestInit) => getJSON<CovenantConfig>("/config", init);
export const fetchProof = (vault: string, init?: RequestInit) =>
  getJSON<ProofResponse>(`/proof/${vault}`, init);

/** Human "time since" for the flagship's honest idle state. */
export function timeAgo(unixSeconds: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
