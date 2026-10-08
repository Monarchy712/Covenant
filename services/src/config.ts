import { config as dotenvConfig } from "dotenv";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEther } from "viem";
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
  // Central MON treasury — the ONLY wallet that funds the others (replaces DEPLOYER topup).
  // Nothing else ever sends from it (no nonce sharing).
  treasuryKey: process.env.PRIVATE_KEY_TREASURY as `0x${string}` | undefined,

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
  runTreasury: process.env.RUN_TREASURY === "true",

  // gas: Monad charges the LIMIT — always estimate then × this multiplier.
  gasLimitMultiplierBps: 11500n, // 1.15×

  // indexer
  confirmationLag: Number(process.env.CONFIRMATION_LAG ?? 3),
  chunkSize: Number(process.env.CHUNK_SIZE ?? 90), // discovered RPC max is 100; stay under
  // Parallel getLogs windows per batch during backfill (bounded so we don't trip RPC rate limits).
  indexerConcurrency: Number(process.env.INDEXER_CONCURRENCY ?? 10),
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 2000),
  // Where a fresh indexer starts (cursor null). Default = factory deploy block; set
  // INDEXER_START_BLOCK near head for a fast demo cold-start (older mandates read live).
  indexerStartBlock: process.env.INDEXER_START_BLOCK ? Number(process.env.INDEXER_START_BLOCK) : undefined,
  // Cold-start lookback (blocks) when there's no cursor AND no INDEXER_START_BLOCK: the forward
  // indexer begins this far behind the confirmed tip so it is immediately current on a fresh volume
  // instead of grinding from the factory block. History is filled separately via /admin/backfill.
  indexerColdStartLookback: Number(process.env.INDEXER_COLD_START_LOOKBACK ?? 500),
  // One-deploy escape hatch: clears the saved cursor on boot so the indexer restarts from
  // INDEXER_START_BLOCK (set it near head to jump to head and skip a huge stale gap — already
  // indexed events persist in the DB; only the un-indexed gap is skipped). Unset after one boot.
  indexerReset: process.env.INDEXER_RESET === "true",
  // Cap blocks advanced per sync() so the cursor moves incrementally. With parallel chunkLogs a
  // larger span still resolves in a few round-trips, so this can be bigger for a fast backfill.
  maxSpanPerSync: Number(process.env.MAX_SPAN_PER_SYNC ?? 60000),

  // --- Persistence guard: refuse to start if the DB isn't on a mounted volume in production ---
  // Default ON when NODE_ENV=production (the Docker image sets it). The guard compares the DB
  // directory's filesystem device to its parent's: a mounted Railway volume is a SEPARATE device,
  // ephemeral container storage is NOT — so a DB on ephemeral storage (which is WIPED on every
  // redeploy, the exact cause of the flagship-history loss) fails the check and the process exits.
  // Override with REQUIRE_DB_VOLUME=false only if the detection is wrong for your host.
  requireDbVolume:
    (process.env.REQUIRE_DB_VOLUME ?? (process.env.NODE_ENV === "production" ? "true" : "false")) === "true",

  // --- Historical backfill (POST /admin/backfill) ---
  // The backfill must NEVER starve live traffic (dashboard/MM-console snapshot reads). Defaults are
  // deliberately gentle, and it backs off further whenever live reads report RPC pressure.
  backfillSpan: Number(process.env.BACKFILL_SPAN ?? 3000),
  // Parallel getLogs windows for the backfill (low, so it leaves RPC headroom for live reads).
  backfillConcurrency: Number(process.env.BACKFILL_CONCURRENCY ?? 3),
  // Pause between outer steps (ms).
  backfillPauseMs: Number(process.env.BACKFILL_PAUSE_MS ?? 500),
  // Pause between each parallel batch WITHIN a step (ms) — spreads the load so bursts don't spike.
  backfillBatchPauseMs: Number(process.env.BACKFILL_BATCH_PAUSE_MS ?? 120),
  // Extra sleep applied before a step when live reads have recently reported RPC pressure (ms).
  backfillBackoffMs: Number(process.env.BACKFILL_BACKOFF_MS ?? 4000),
  // Optional dedicated RPC for the backfill so it never competes with live traffic. If unset, the
  // backfill shares the main RPC but yields to live reads via the pressure backoff above.
  backfillRpcUrl: process.env.BACKFILL_RPC_URL || undefined,

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
  demoDailyCap: Number(process.env.DEMO_DAILY_CAP ?? 50), // max demo mandates created per 24h (demo/judging default)

  // faucet limits
  faucetBaseAmount: 100_000n * 10n ** 18n, // 100k base
  faucetQuoteAmount: 100_000n * 10n ** 6n, // 100k USDC
  faucetMonDrip: 200_000_000_000_000_000n, // 0.2 MON
  faucetPerAddressCooldownMs: 24 * 3600 * 1000,
  // Allow a few demo wallets per IP in a 24h window (demos, judges behind one NAT/office IP).
  // Per-address stays 1/24h; the global daily MON budget is the real spend cap.
  faucetIpPer24h: Number(process.env.FAUCET_IP_PER_24H ?? 50),
  // Global MON/day drip budget (default 40 MON = 200 drips, demo/judging default; treasury covers it).
  faucetDailyMonBudget: parseEther(process.env.FAUCET_DAILY_MON_BUDGET_MON ?? "40"),
  // /health warns when the faucet wallet drops below this. MON drips now come from the treasury,
  // so the faucet only burns mint gas and the treasury auto-top-up keeps it at target 10 / refills
  // at threshold 3 — so this warn is set BELOW that threshold (1.5) to fire only when the treasury
  // top-up has actually failed and the faucet is truly draining, not on every normal pre-refill dip.
  faucetLowWarnWei: parseEther(process.env.FAUCET_LOW_WARN_MON ?? "1.5"),

  // --- Treasury safety limits (env overrides in whole MON) ---
  treasuryMaxPerTransferWei: parseEther(process.env.TREASURY_MAX_PER_TRANSFER_MON ?? "10"),
  treasuryMaxPerDayWei: parseEther(process.env.TREASURY_MAX_PER_DAY_MON ?? "60"),
  // The treasury always retains this for its own gas + Monad's reserve. Monad testnet has no
  // documented hard reserve-balance rule, so this is a conservative self-imposed floor (a transfer
  // that would drop the treasury below it is refused).
  treasuryMinReserveWei: parseEther(process.env.TREASURY_MIN_RESERVE_MON ?? "2"),
  treasuryTopupIntervalMs: Number(process.env.TREASURY_TOPUP_INTERVAL_MS ?? 180_000), // 3 min
  // Warn on /health when the treasury itself drops below this (time to refill).
  treasuryLowWarnWei: parseEther(process.env.TREASURY_LOW_WARN_MON ?? "15"),
  // Per-service-wallet funding targets, based on measured burn (checkpoints/quotes/mints are the
  // heavy spenders). Top up when below `threshold`, bringing the wallet up to `target`.
  // Roles map to the PRIVATE_KEY_* above; only these are auto-funded by the hosted module.
  treasuryTargets: {
    keeper: { target: parseEther("10"), threshold: parseEther("3") },
    faucet: { target: parseEther("10"), threshold: parseEther("3") },
    seeder: { target: parseEther("5"), threshold: parseEther("2") },
    mm: { target: parseEther("5"), threshold: parseEther("2") },
    taker: { target: parseEther("3"), threshold: parseEther("1") },
    demoIssuer: { target: parseEther("10"), threshold: parseEther("3") },
  } as Record<string, { target: bigint; threshold: bigint }>,
  // The persisted QA burner (CLI topup-all only — NEVER in the hosted auto-top-up allowlist).
  qaBurnerTarget: parseEther(process.env.TREASURY_QA_BURNER_TARGET_MON ?? "5"),
} as const;

export { reqEnv };
