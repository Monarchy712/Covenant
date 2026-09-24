import { decodeEventLog, getAbiItem, type Log } from "viem";
import { covenantFactoryAbi, covenantVaultAbi, kuruOrderBookAbi, testnet } from "@covenant/shared";
import { publicClient } from "./clients.js";
import { config } from "./config.js";
import { type DB, getCursor, setCursor } from "./db.js";

const jsonB = (o: unknown) =>
  JSON.stringify(o, (_k, v) => (typeof v === "bigint" ? v.toString() : v));

interface Mandate {
  vault: `0x${string}`;
  market: `0x${string}`;
}

/// Backfills from the factory deployment block, then follows the head `confirmationLag` blocks
/// behind. Idempotent: every insert is INSERT OR IGNORE on a (txHash,logIndex) unique key.
export interface LiveEvent {
  vault: string;
  source: string;
  name: string;
  txHash: string;
  block: number;
  args: unknown;
}

export class Indexer {
  private mandates = new Map<string, Mandate>();
  private tsCache = new Map<number, number>();

  constructor(
    private db: DB,
    private onEvent?: (e: LiveEvent) => void,
  ) {}

  async chunkLogs(
    address: `0x${string}` | `0x${string}`[],
    events: readonly unknown[],
    from: number,
    to: number,
  ): Promise<Log[]> {
    const out: Log[] = [];
    let start = from;
    while (start <= to) {
      let end = Math.min(start + config.chunkSize - 1, to);
      try {
        const logs = await publicClient.getLogs({
          address: address as any,
          events: events as any,
          fromBlock: BigInt(start),
          toBlock: BigInt(end),
        });
        out.push(...logs);
        start = end + 1;
      } catch (e: any) {
        const msg = String(e?.message ?? e);
        if (/range|limit|too many|429|rate/i.test(msg) && end > start) {
          // shrink the window and retry
          end = start + Math.max(0, Math.floor((end - start) / 2));
          config.chunkSize && void 0;
          await sleep(300);
          continue;
        }
        if (/429|rate/i.test(msg)) {
          await sleep(1000);
          continue;
        }
        throw e;
      }
    }
    return out;
  }

  private async ts(block: number): Promise<number> {
    const c = this.tsCache.get(block);
    if (c) return c;
    const b = await publicClient.getBlock({ blockNumber: BigInt(block) });
    const t = Number(b.timestamp);
    this.tsCache.set(block, t);
    return t;
  }

  /// One sync pass across [cursor+1, head-lag].
  async sync(): Promise<{ from: number; to: number; head: number }> {
    const head = Number(await publicClient.getBlockNumber());
    const to = head - config.confirmationLag;
    const cursor = getCursor(this.db, "main");
    const from = cursor === null ? testnet.factoryBlock : cursor + 1;
    if (to < from) return { from, to, head };

    // 1) discover new mandates from the factory
    await this.indexFactory(from, to);
    // 2) index each vault's events + its market's Trade fills
    for (const m of this.mandates.values()) {
      await this.indexVault(m, from, to);
      await this.indexTrades(m, from, to);
    }
    setCursor(this.db, "main", to);
    return { from, to, head };
  }

  /// Load previously-known mandates from DB (restart safety) before the first sync.
  loadMandates(): void {
    const rows = this.db.prepare("SELECT vault, market FROM mandates").all() as any[];
    for (const r of rows) this.mandates.set(r.vault.toLowerCase(), { vault: r.vault, market: r.market });
  }

  private async indexFactory(from: number, to: number) {
    const ev = getAbiItem({ abi: covenantFactoryAbi as any, name: "MandateCreated" });
    const logs = await this.chunkLogs(testnet.factory, [ev], from, to);
    for (const log of logs) {
      const dec: any = decodeEventLog({ abi: covenantFactoryAbi as any, ...log });
      const a = dec.args as any;
      const vault = a.vault as `0x${string}`;
      this.db
        .prepare(
          "INSERT OR IGNORE INTO mandates(vault,issuer,mm,market,createdBlock,createdTx) VALUES(?,?,?,?,?,?)",
        )
        .run(vault, a.issuer, a.mm, a.market, Number(log.blockNumber), log.transactionHash);
      this.mandates.set(vault.toLowerCase(), { vault, market: a.market });
      await this.record(log, vault, "factory", dec.eventName, a);
    }
  }

  private async indexVault(m: Mandate, from: number, to: number) {
    const events = (covenantVaultAbi as any).filter((e: any) => e.type === "event");
    const logs = await this.chunkLogs(m.vault, events, from, to);
    for (const log of logs) {
      const dec: any = decodeEventLog({ abi: covenantVaultAbi as any, ...log });
      const a = dec.args as any;
      const block = Number(log.blockNumber);
      await this.record(log, m.vault, "vault", dec.eventName, a);

      switch (dec.eventName) {
        case "OrderPlaced":
          this.db
            .prepare(
              "INSERT OR IGNORE INTO orders(vault,orderId,isBid,price,size,placedBlock) VALUES(?,?,?,?,?,?)",
            )
            .run(m.vault, Number(a.id), a.isBid ? 1 : 0, String(a.price), String(a.size), block);
          break;
        case "OrderCancelled":
          this.db
            .prepare("UPDATE orders SET cancelledBlock=? WHERE vault=? AND orderId=?")
            .run(block, m.vault, Number(a.id));
          break;
        case "CheckpointObserved":
          this.db
            .prepare(
              "INSERT OR IGNORE INTO checkpoints(txHash,logIndex,block,ts,vault,interval,passed,spreadBps,bidDepth,askDepth,mid) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            )
            .run(
              log.transactionHash,
              log.logIndex,
              block,
              await this.ts(block),
              m.vault,
              Number(a.interval),
              a.passed ? 1 : 0,
              String(a.spreadBps),
              String(a.bidDepth),
              String(a.askDepth),
              String(a.mid),
            );
          this.db
            .prepare("INSERT OR IGNORE INTO price_points(vault,block,ts,mid) VALUES(?,?,?,?)")
            .run(m.vault, block, await this.ts(block), String(a.mid));
          break;
        case "IntervalFinalized":
          this.db
            .prepare(
              "INSERT OR IGNORE INTO intervals(vault,interval,paid,amount,finalizedBlock) VALUES(?,?,?,?,?)",
            )
            .run(m.vault, Number(a.interval), a.paid ? 1 : 0, String(a.amount), block);
          if (a.paid)
            this.db
              .prepare("INSERT OR IGNORE INTO fee_accruals(vault,interval,amount,block) VALUES(?,?,?,?)")
              .run(m.vault, Number(a.interval), String(a.amount), block);
          break;
        case "WindowRolled":
          this.db
            .prepare("INSERT OR IGNORE INTO windows(vault,windowIndex,soldAtWindowStart,block) VALUES(?,?,?,?)")
            .run(m.vault, Number(a.windowIndex), String(a.soldAtWindowStart), block);
          break;
      }
    }
  }

  private async indexTrades(m: Mandate, from: number, to: number) {
    const ev = getAbiItem({ abi: kuruOrderBookAbi as any, name: "Trade" });
    const logs = await this.chunkLogs(m.market, [ev], from, to);
    for (const log of logs) {
      const dec: any = decodeEventLog({ abi: kuruOrderBookAbi as any, ...log });
      const a = dec.args as any;
      // ATTRIBUTION: Kuru's Trade carries makerAddress; a fill belongs to this vault iff the
      // maker is the vault. (Trade args are non-indexed, so we scan the market and filter here.)
      if ((a.makerAddress as string).toLowerCase() !== m.vault.toLowerCase()) continue;
      const block = Number(log.blockNumber);
      this.db
        .prepare(
          "INSERT OR IGNORE INTO fills(txHash,logIndex,block,ts,vault,market,orderId,maker,taker,isBuyTaker,price,filledSize,updatedSize) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          log.transactionHash,
          log.logIndex,
          block,
          await this.ts(block),
          m.vault,
          m.market,
          Number(a.orderId),
          a.makerAddress,
          a.takerAddress,
          a.isBuy ? 1 : 0,
          String(a.price),
          String(a.filledSize),
          String(a.updatedSize),
        );
      this.db
        .prepare("INSERT OR IGNORE INTO price_points(vault,block,ts,mid) VALUES(?,?,?,?)")
        .run(m.vault, block, await this.ts(block), String(a.price));
      await this.record(log, m.vault, "kuru", "Trade", a);
    }
  }

  private async record(log: Log, vault: string, source: string, name: string, args: unknown) {
    const res = this.db
      .prepare(
        "INSERT OR IGNORE INTO events(txHash,logIndex,block,ts,vault,source,name,args) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(
        log.transactionHash,
        log.logIndex,
        Number(log.blockNumber),
        await this.ts(Number(log.blockNumber)),
        vault,
        source,
        name,
        jsonB(args),
      );
    // Push to SSE only for genuinely new rows (not re-indexed duplicates).
    if (res.changes > 0 && this.onEvent) {
      this.onEvent({
        vault: vault.toLowerCase(),
        source,
        name,
        txHash: log.transactionHash!,
        block: Number(log.blockNumber),
        args: JSON.parse(jsonB(args)),
      });
    }
  }

  vaults(): string[] {
    return [...this.mandates.keys()];
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
