import { config as dotenvConfig } from "dotenv";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { testnet } from "@covenant/shared";

// Robustly load the repo-root .env regardless of cwd (services/ vs root vs Docker).
(() => {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.ENV_PATH,
    resolve(process.cwd(), ".env"),
    resolve(here, "../../.env"), // services/src -> repo root
    resolve(here, "../../../.env"),
  ].filter(Boolean) as string[];
  for (const p of candidates) {
    if (existsSync(p)) {
      dotenvConfig({ path: p });
      return;
    }
  }
  dotenvConfig(); // fall back to default
})();

function reqEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

export const config = {
  rpcUrl: process.env.RPC_URL_TESTNET ?? "https://testnet-rpc.monad.xyz",
  dbPath: process.env.DB_PATH ?? "./covenant.db",
  port: Number(process.env.PORT ?? 8080),

  // per-module wallets (optional at import time; each module asserts its own)
  keeperKey: process.env.PRIVATE_KEY_KEEPER as `0x${string}` | undefined,
  faucetKey: process.env.PRIVATE_KEY_FAUCET as `0x${string}` | undefined,
  seederKey: (process.env.PRIVATE_KEY_SEEDER ?? process.env.PRIVATE_KEY_DEPLOYER) as
    | `0x${string}`
    | undefined,
  mmKey: process.env.PRIVATE_KEY_MM as `0x${string}` | undefined,
  takerKey: process.env.PRIVATE_KEY_TAKER as `0x${string}` | undefined,
  // demo-issuer falls back to DEPLOYER (NOT the seeder) so the seeder bot and demo-session
  // never share a wallet/nonce. Set PRIVATE_KEY_DEMO_ISSUER to override.
  demoIssuerKey: (process.env.PRIVATE_KEY_DEMO_ISSUER ?? process.env.PRIVATE_KEY_DEPLOYER) as
    | `0x${string}`
    | undefined,

  adminToken: process.env.ADMIN_TOKEN ?? "",

  // module on/off flags (default: indexer + api on; keeper/bots/faucet opt-in)
  runIndexer: process.env.RUN_INDEXER !== "false",
  runApi: process.env.RUN_API !== "false",
  runKeeper: process.env.RUN_KEEPER === "true",
  runFaucet: process.env.RUN_FAUCET === "true",
  runSeeder: process.env.RUN_SEEDER === "true",
  runMmBot: process.env.RUN_MM_BOT === "true",
  mmBotMode: (process.env.MM_BOT_MODE ?? "honest") as "honest" | "malicious",
  runTakerBot: process.env.RUN_TAKER_BOT === "true",
  runHouseMm: process.env.RUN_HOUSE_MM === "true",

  // gas: Monad charges the LIMIT — always estimate then × this multiplier.
  gasLimitMultiplierBps: 11500n, // 1.15×

  // indexer
  confirmationLag: Number(process.env.CONFIRMATION_LAG ?? 3),
  chunkSize: Number(process.env.CHUNK_SIZE ?? 90), // discovered RPC max is 100; stay under
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 2000),
  // Where a fresh indexer starts (cursor null). Default = factory deploy block; set
  // INDEXER_START_BLOCK near head for a fast demo cold-start (older mandates read live).
  indexerStartBlock: process.env.INDEXER_START_BLOCK ? Number(process.env.INDEXER_START_BLOCK) : undefined,
  // Cap blocks advanced per sync() so the cursor moves incrementally (no single 1M-block pass).
  maxSpanPerSync: Number(process.env.MAX_SPAN_PER_SYNC ?? 20000),

  // keeper
  keeperMinBalanceWei: BigInt(process.env.KEEPER_MIN_BALANCE_WEI ?? 100_000_000_000_000_000n), // 0.1 MON

  // --- Flagship (landing-page reference mandate) cost controls ---
  // The flagship stays ACTIVE but IDLE by default; house MM + keeper + taker only touch it when
  // the flagship-bots switch is on (env seeds it at boot; POST /admin/flagship flips it live).
  flagshipVault: (process.env.FLAGSHIP_VAULT ?? testnet.vault).toLowerCase() as `0x${string}`,
  flagshipBotsDefault: process.env.FLAGSHIP_BOTS, // "on"|"off"|undefined (undefined => keep persisted)
  // House-MM requote cadence. Throttled high (60s) so an always-on demo session is cheap; the
  // MM still requotes immediately when the mid drifts past requoteBps.
  mmRequoteMs: Number(process.env.MM_REQUOTE_MS ?? 60_000),
  // Taker cadence (flagship burst only). Default ~10s for a lively demo; raise for a cheap burst.
  takerIntervalMs: Number(process.env.TAKER_INTERVAL_MS ?? 10_000),
  // Seeder half-offset from the LIVE mid, in bps. Must sit strictly OUTSIDE any vault's quotes so
  // takers hit the vault first: >= max(3x the vault's half-spread, the band's inner half).
  // House MM quotes ~±30bps (spread 60), band is ±200bps -> inner half 100bps; 120 clears both and
  // stays inside the band edge (a plausible reference book). The seeder's only job is a live mid.
  seederOffsetBps: BigInt(process.env.SEEDER_OFFSET_BPS ?? 120n),

  // --- Demo sessions (/demo/session role=mm) — bounded so each judge session is cheap ---
  demoDurationSec: BigInt(process.env.DEMO_DURATION_SEC ?? 900n), // 15 min
  demoCheckpointSec: BigInt(process.env.DEMO_CHECKPOINT_SEC ?? 180n), // 3 min
  demoWindowSec: BigInt(process.env.DEMO_WINDOW_SEC ?? 300n), // 5 min
  demoDailyCap: Number(process.env.DEMO_DAILY_CAP ?? 8), // max demo mandates created per 24h

  // faucet limits
  faucetBaseAmount: 100_000n * 10n ** 18n, // 100k base
  faucetQuoteAmount: 100_000n * 10n ** 6n, // 100k USDC
  faucetMonDrip: 200_000_000_000_000_000n, // 0.2 MON
  faucetPerAddressCooldownMs: 24 * 3600 * 1000,
  faucetDailyMonBudget: 5_000_000_000_000_000_000n, // 5 MON/day total
} as const;

export { reqEnv };
