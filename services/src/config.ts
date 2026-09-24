import "dotenv/config";

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

  // module on/off flags (default: indexer + api on; keeper/bots/faucet opt-in)
  runIndexer: process.env.RUN_INDEXER !== "false",
  runApi: process.env.RUN_API !== "false",
  runKeeper: process.env.RUN_KEEPER === "true",
  runFaucet: process.env.RUN_FAUCET === "true",
  runSeeder: process.env.RUN_SEEDER === "true",
  runMmBot: process.env.RUN_MM_BOT === "true",
  mmBotMode: (process.env.MM_BOT_MODE ?? "honest") as "honest" | "malicious",
  runTakerBot: process.env.RUN_TAKER_BOT === "true",

  // gas: Monad charges the LIMIT — always estimate then × this multiplier.
  gasLimitMultiplierBps: 11500n, // 1.15×

  // indexer
  confirmationLag: Number(process.env.CONFIRMATION_LAG ?? 3),
  chunkSize: Number(process.env.CHUNK_SIZE ?? 90), // discovered RPC max is 100; stay under
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 2000),

  // keeper
  keeperMinBalanceWei: BigInt(process.env.KEEPER_MIN_BALANCE_WEI ?? 100_000_000_000_000_000n), // 0.1 MON

  // faucet limits
  faucetBaseAmount: 100_000n * 10n ** 18n, // 100k base
  faucetQuoteAmount: 100_000n * 10n ** 6n, // 100k USDC
  faucetMonDrip: 200_000_000_000_000_000n, // 0.2 MON
  faucetPerAddressCooldownMs: 24 * 3600 * 1000,
  faucetDailyMonBudget: 5_000_000_000_000_000_000n, // 5 MON/day total
} as const;

export { reqEnv };
