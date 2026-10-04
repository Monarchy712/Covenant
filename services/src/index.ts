import { EventEmitter } from "node:events";
import { testnet } from "@covenant/shared";
import { config } from "./config.js";
import { openDb, getSetting, setSetting } from "./db.js";
import { Indexer, type LiveEvent } from "./indexer.js";
import { startApi } from "./api.js";
import { Keeper } from "./keeper.js";
import { registerFaucet } from "./faucet.js";
import { MmBot, TakerBot, SeederBot } from "./bots.js";
import { HouseMm } from "./houseMm.js";
import { makeWallet } from "./clients.js";
import { assertNoSharedWallets } from "./wallets.js";
import { Treasury, startTreasuryLoop } from "./treasury.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/// ONE process; modules toggle via env flags (see config). Run: `pnpm dev:services`.
async function main() {
  const db = openDb();
  const bus = new EventEmitter();
  bus.setMaxListeners(0);

  // Flagship-bots switch (persisted). FLAGSHIP_BOTS env, if set, seeds it at boot; the admin
  // endpoint POST /admin/flagship flips it live for recording. Default OFF => flagship idle.
  if (config.flagshipBotsDefault !== undefined) {
    const on = ["true", "on", "1"].includes(config.flagshipBotsDefault.toLowerCase());
    setSetting(db, "flagshipBots", on ? "on" : "off");
  }
  const flagshipEnabled = () => getSetting(db, "flagshipBots", "off") === "on";

  const walletAddrs: Record<string, string> = {};
  const mkAddr = (pk?: `0x${string}`) => (pk ? makeWallet(pk).account.address : "");
  walletAddrs.keeper = mkAddr(config.keeperKey);
  walletAddrs.faucet = mkAddr(config.faucetKey);
  walletAddrs.seeder = mkAddr(config.seederKey);
  walletAddrs.treasury = mkAddr(config.treasuryKey);

  // STARTUP CHECK (Part 1): refuse to start if two ENABLED modules share a wallet. The treasury
  // is included when RUN_TREASURY so nothing else ever sends from it (no nonce sharing).
  assertNoSharedWallets({
    keeper: config.runKeeper ? (config.keeperKey && (mkAddr(config.keeperKey) as `0x${string}`)) || undefined : undefined,
    faucet: config.runFaucet ? (config.faucetKey && (mkAddr(config.faucetKey) as `0x${string}`)) || undefined : undefined,
    seeder: config.runSeeder ? (config.seederKey && (mkAddr(config.seederKey) as `0x${string}`)) || undefined : undefined,
    "house-mm": config.runMmBot ? (config.mmKey && (mkAddr(config.mmKey) as `0x${string}`)) || undefined : undefined,
    "taker-bot": config.runTakerBot ? (config.takerKey && (mkAddr(config.takerKey) as `0x${string}`)) || undefined : undefined,
    treasury: config.runTreasury ? (config.treasuryKey && (mkAddr(config.treasuryKey) as `0x${string}`)) || undefined : undefined,
  });

  // --- Indexer (default on) ---
  let indexer: Indexer | null = null;
  if (config.runIndexer) {
    indexer = new Indexer(db, (e: LiveEvent) => bus.emit("event", e));
    indexer.loadMandates();
    console.log(`[indexer] backfilling from factory block ${testnet.factoryBlock}…`);
    (async () => {
      // continuous follow loop
      // eslint-disable-next-line no-constant-condition
      while (true) {
        try {
          const r = await indexer!.sync();
          if (r.to >= r.from) console.log(`[indexer] synced ${r.from}..${r.to} (head ${r.head})`);
        } catch (e: any) {
          console.error(`[indexer] sync error: ${String(e?.shortMessage ?? e?.message ?? e)}`);
        }
        await sleep(config.pollIntervalMs);
      }
    })();
  }

  // --- House MM (opt-in): auto-accepts invited mandates + quotes honestly ---
  let houseMm: HouseMm | null = null;
  if (config.runHouseMm && config.mmKey) {
    houseMm = new HouseMm(makeWallet(config.mmKey), testnet.factory, flagshipEnabled);
    console.log(`[houseMM] on (${houseMm.address}) — flagship ${flagshipEnabled() ? "ON" : "idle"}`);
    (async () => {
      while (true) {
        await houseMm!.tick().catch((e) => console.error(`[houseMM] ${e}`));
        await sleep(6000);
      }
    })();
  }

  // --- API (default on) ---
  if (config.runApi) {
    const houseMMAddr = config.mmKey ? makeWallet(config.mmKey).account.address : undefined;
    startApi(
      db,
      bus,
      walletAddrs,
      (app) => {
        if (config.runFaucet && config.faucetKey)
          registerFaucet(app, db, makeWallet(config.faucetKey), config.demoIssuerKey ? makeWallet(config.demoIssuerKey) : undefined, houseMMAddr);
      },
      { houseMM: houseMMAddr, faucetEnabled: config.runFaucet, flagshipVault: testnet.vault, flagshipMarket: testnet.market },
    );
  }

  // --- Keeper (opt-in) ---
  if (config.runKeeper && config.keeperKey) {
    const keeper = new Keeper(db, makeWallet(config.keeperKey), flagshipEnabled);
    console.log(`[keeper] on (${walletAddrs.keeper})`);
    (async () => {
      while (true) {
        await keeper.tickOnce().catch((e) => console.error(`[keeper] ${e}`));
        await sleep(5000);
      }
    })();
  }

  // --- Bots (opt-in, off in production) ---
  if (config.runSeeder && config.seederKey) {
    const seeder = new SeederBot(makeWallet(config.seederKey), testnet.market);
    (async () => {
      while (true) {
        await seeder.tick().catch(() => {});
        await sleep(30000); // cheap: only sends txs when an order was filled/removed
      }
    })();
  }
  if (config.runMmBot && config.mmKey) {
    const bot = new MmBot(makeWallet(config.mmKey), testnet.vault, testnet.market, config.mmBotMode);
    console.log(`[mmBot] on (${config.mmBotMode})`);
    (async () => {
      while (true) {
        await bot.tick().catch((e) => console.error(`[mmBot] ${e}`));
        await sleep(3000);
      }
    })();
  }
  if (config.runTakerBot && config.takerKey) {
    const bot = new TakerBot(makeWallet(config.takerKey), testnet.market);
    (async () => {
      while (true) {
        // The taker trades the flagship market, so only run it when the flagship switch is on
        // (burst/recording). This keeps the always-on demo stack from spending on the flagship.
        if (flagshipEnabled()) await bot.tick().catch(() => {});
        await sleep(config.takerIntervalMs + Math.random() * 4000);
      }
    })();
  }

  // --- Treasury auto-top-up (opt-in): keeps service wallets funded from one central wallet ---
  if (config.runTreasury && config.treasuryKey) {
    startTreasuryLoop(new Treasury(db, config.treasuryKey));
  }

  // Graceful shutdown: flush + close the DB (WAL checkpoint) so a Railway restart is clean.
  let shuttingDown = false;
  const shutdown = (sig: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[services] ${sig} — flushing DB and exiting`);
    try {
      db.pragma("wal_checkpoint(TRUNCATE)");
      db.close();
    } catch (e) {
      console.error("[services] shutdown flush error", e);
    }
    setTimeout(() => process.exit(0), 500); // let in-flight sends settle
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  console.log("[services] up. modules:", {
    indexer: config.runIndexer,
    api: config.runApi,
    keeper: config.runKeeper,
    faucet: config.runFaucet,
    seeder: config.runSeeder,
    mmBot: config.runMmBot,
    takerBot: config.runTakerBot,
    houseMm: config.runHouseMm,
    treasury: config.runTreasury,
  });
}

main().catch((e) => {
  console.error("fatal", e);
  process.exit(1);
});
