import { EventEmitter } from "node:events";
import { testnet } from "@covenant/shared";
import { config } from "./config.js";
import { openDb } from "./db.js";
import { Indexer, type LiveEvent } from "./indexer.js";
import { startApi } from "./api.js";
import { Keeper } from "./keeper.js";
import { registerFaucet } from "./faucet.js";
import { MmBot, TakerBot, SeederBot } from "./bots.js";
import { makeWallet } from "./clients.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/// ONE process; modules toggle via env flags (see config). Run: `pnpm dev:services`.
async function main() {
  const db = openDb();
  const bus = new EventEmitter();
  bus.setMaxListeners(0);

  const walletAddrs: Record<string, string> = {};
  const mkAddr = (pk?: `0x${string}`) => (pk ? makeWallet(pk).account.address : "");
  walletAddrs.keeper = mkAddr(config.keeperKey);
  walletAddrs.faucet = mkAddr(config.faucetKey);
  walletAddrs.seeder = mkAddr(config.seederKey);

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

  // --- API (default on) ---
  if (config.runApi) {
    startApi(db, bus, walletAddrs, (app) => {
      if (config.runFaucet && config.faucetKey) registerFaucet(app, db, makeWallet(config.faucetKey));
    });
  }

  // --- Keeper (opt-in) ---
  if (config.runKeeper && config.keeperKey) {
    const keeper = new Keeper(db, makeWallet(config.keeperKey));
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
        await sleep(20000);
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
        await bot.tick().catch(() => {});
        await sleep(7000 + Math.random() * 8000);
      }
    })();
  }

  console.log("[services] up. modules:", {
    indexer: config.runIndexer,
    api: config.runApi,
    keeper: config.runKeeper,
    faucet: config.runFaucet,
    seeder: config.runSeeder,
    mmBot: config.runMmBot,
    takerBot: config.runTakerBot,
  });
}

main().catch((e) => {
  console.error("fatal", e);
  process.exit(1);
});
