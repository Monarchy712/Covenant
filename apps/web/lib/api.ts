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

export interface EventRow {
  txHash: `0x${string}`;
  logIndex: number;
  block: number;
  ts: number;
  vault: `0x${string}`;
  source: "vault" | "kuru" | string;
  name: string;
  args: string; // JSON string
}

export type DemoRole = "issuer" | "mm" | "trader";
export interface DemoSession {
  vault?: `0x${string}`;
  market?: `0x${string}`;
  houseMM?: `0x${string}`;
  base?: `0x${string}`;
  quote?: `0x${string}`;
  [k: string]: unknown;
}

export class RateLimitError extends Error {
  constructor() {
    super("RATE_LIMIT");
    this.name = "RateLimitError";
  }
}

/** Fund + provision a browser address via the backend (key never leaves the browser). */
export async function postDemoSession(address: string, role: DemoRole): Promise<DemoSession> {
  const res = await fetch(`${API_BASE}/demo/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address, role }),
  });
  if (res.status === 429) throw new RateLimitError();
  if (!res.ok) throw new Error(`/demo/session → ${res.status}`);
  return (await res.json()) as DemoSession;
}

/** Fund + activate a demo (role=mm) mandate after its MM has accepted. No auth; backend uses the
 *  demo-issuer wallet. Retries on 409 (acceptance not yet visible to the backend's RPC read). */
export async function postDemoActivate(vault: string): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${API_BASE}/demo/activate/${vault}`, { method: "POST" });
    if (res.ok) return;
    if (res.status === 409 && attempt < 3) {
      await new Promise((r) => setTimeout(r, 3000)); // accept not propagated yet; retry
      continue;
    }
    throw new Error(`/demo/activate → ${res.status}`);
  }
}

/** Faucet: mint test base/USDC + drip MON to an address. */
export async function postFaucet(address: string): Promise<void> {
  const res = await fetch(`${API_BASE}/faucet`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address }),
  });
  if (res.status === 429) throw new RateLimitError();
  if (!res.ok) throw new Error(`/faucet → ${res.status}`);
}

export interface MandateListItem {
  vault: `0x${string}`;
  issuer: `0x${string}`;
  mm: `0x${string}`;
  market: `0x${string}`;
  base: `0x${string}` | null;
  quote: `0x${string}` | null;
  createdBlock: number;
  createdTx: `0x${string}`;
}

export interface SnapshotJSON {
  state: number;
  terms: ProofResponse["terms"];
  activatedAt: string;
  endsAt: string;
  windowIndex: string;
  soldBase: string;
  netSoldInWindow: string;
  remainingAllowance: string;
  openOrders: { id: number; isBid: boolean; price: number | string; remaining: number | string }[];
  baseMargin: string;
  quoteMargin: string;
  feeEscrow: string;
  accruedFees: string;
  claimedFees: string;
  currentInterval: string;
  currentObserved: boolean;
  currentPassed: boolean;
  currentFailed: boolean;
  consecutiveFails: string;
}

export interface MandateSummary {
  vault: `0x${string}`;
  mandate: MandateListItem;
  snapshot: SnapshotJSON;
  state: number;
  stateName: string;
  counts?: Record<string, number>;
  lastEventTs?: number;
}

export const fetchMandates = (issuer?: string, init?: RequestInit) =>
  getJSON<MandateListItem[]>(`/mandates${issuer ? `?issuer=${issuer}` : ""}`, init);
export const fetchMandatesByMM = (mm: string, init?: RequestInit) =>
  getJSON<MandateListItem[]>(`/mandates?mm=${mm}`, init);
export const fetchAllMandates = (init?: RequestInit) =>
  getJSON<MandateListItem[]>(`/mandates`, init);
export const fetchSummary = (vault: string, init?: RequestInit) =>
  getJSON<MandateSummary>(`/mandates/${vault}/summary`, init);

export const fetchConfig = (init?: RequestInit) => getJSON<CovenantConfig>("/config", init);
export const fetchProof = (vault: string, init?: RequestInit) =>
  getJSON<ProofResponse>(`/proof/${vault}`, init);
export const fetchEvents = (vault: string, limit = 6, init?: RequestInit) =>
  getJSON<EventRow[]>(`/mandates/${vault}/events?limit=${limit}`, init);

const PRICE_PRECISION = 1e8; // DEMO_MARKET
const SIZE_PRECISION = 1e10;

export interface VaultOrder {
  id: number;
  isBid: boolean;
  price: number;
  size: number;
}
export interface VaultBook {
  mid: number | null;
  orders: VaultOrder[];
}

/**
 * The vault's own resting orders + a mid, read from the indexer's summary
 * (server-side reliable REST, no browser RPC / CORS). Empty orders => book hidden.
 */
export async function fetchVaultBook(vault: string, init?: RequestInit): Promise<VaultBook> {
  const s = await getJSON<{ snapshot?: { openOrders?: { id: number; isBid: boolean; price: number | string; remaining: number | string }[] } }>(
    `/mandates/${vault}/summary`,
    init,
  );
  const raw = s.snapshot?.openOrders ?? [];
  const orders: VaultOrder[] = raw.map((o) => ({
    id: Number(o.id),
    isBid: Boolean(o.isBid),
    price: Number(o.price) / PRICE_PRECISION,
    size: Number(o.remaining) / SIZE_PRECISION,
  }));
  const bidPrices = orders.filter((o) => o.isBid).map((o) => o.price);
  const askPrices = orders.filter((o) => !o.isBid).map((o) => o.price);
  const bestBid = bidPrices.length ? Math.max(...bidPrices) : null;
  const bestAsk = askPrices.length ? Math.min(...askPrices) : null;
  const mid =
    bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : (bestBid ?? bestAsk);
  return { mid, orders };
}

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
