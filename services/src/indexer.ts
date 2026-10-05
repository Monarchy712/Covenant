import { decodeEventLog, getAbiItem, type Log, type PublicClient } from "viem";
import { covenantFactoryAbi, covenantVaultAbi, kuruOrderBookAbi, testnet } from "@covenant/shared";
import { publicClient, notePressure } from "./clients.js";
import { config } from "./config.js";
import { type DB, getCursor, setCursor } from "./db.js";

const jsonB = (o: unknown) =>
  JSON.stringify(o, (_k, v) => (typeof v === "bigint" ? v.toString() : v));

/// Pure: split [from,to] into inclusive [start,end] windows no larger than `size` blocks.
/// The Monad testnet RPC caps eth_getLogs at 100 blocks, so `size` must be <= 100 (we use 90).
export function planChunks(from: number, to: number, size: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let s = from; s <= to; s += size) out.push([s, Math.min(s + size - 1, to)]);
  return out;
}

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

  /// `client` lets the backfill run on a dedicated RPC (defaults to the shared live client).
  /// `live=true` (the forward indexer) marks RPC pressure on transient errors so the backfill,
  /// which sets `live=false`, can back off and let live reads win.
  constructor(
    private db: DB,
    private onEvent?: (e: LiveEvent) => void,
    private client: PublicClient = publicClient,
    private live: boolean = true,
  ) {}

  /// One getLogs call for a <=chunkSize window, with rate-limit backoff and range-split fallback.
  private async getLogsRetry(
    address: `0x${string}` | `0x${string}`[],
    events: readonly unknown[],
    start: number,
    end: number,
  ): Promise<Log[]> {
    for (let attempt = 0; ; attempt++) {
      try {
        return (await this.client.getLogs({
          address: address as any,
          events: events as any,
          fromBlock: BigInt(start),
          toBlock: BigInt(end),
        })) as Log[];
      } catch (e: any) {
        // Match against everything viem exposes (shortMessage/message/details/name) — HTTP transport
        // failures surface as HttpRequestError with "HTTP request failed" and a 5xx status in details.
        const msg = String(e?.shortMessage ?? e?.message ?? "") + " " + String(e?.details ?? "") + " " + String(e?.name ?? "");
        // RPC rejected the range (too wide) -> split in half and recurse.
        if (/range|limit|too many|exceed|block range/i.test(msg) && end > start) {
          const mid = start + Math.floor((end - start) / 2);
          const [a, b] = await Promise.all([
            this.getLogsRetry(address, events, start, mid),
            this.getLogsRetry(address, events, mid + 1, end),
          ]);
          return [...a, ...b];
        }
        // transient (rate limit / network / HTTP transport) -> bounded exponential backoff, retry.
        // Includes viem's HttpRequestError ("HTTP request failed") + 5xx + connection resets, which
        // are common on the public RPC under a long backfill and MUST NOT kill the whole job.
        const transient =
          /429|rate|timeout|timed out|fetch failed|econn|socket|network|missing or invalid|http request failed|httprequesterror|internalrpcerror|status (code )?5\d\d|50[234]|522|524|econnreset|und_err|terminated|aborted|disconnect|connection|request failed/i.test(
            msg,
          );
        if (attempt < 9 && transient) {
          if (this.live) notePressure(); // tell the backfill to back off — live RPC is struggling
          await sleep(Math.min(8000, 300 * 2 ** attempt));
          continue;
        }
        throw e;
      }
    }
  }

  /// Fetch all logs over [from,to] as parallel <=chunkSize windows (bounded concurrency), so a
  /// large backfill span resolves in a few round-trips instead of one-at-a-time.
  async chunkLogs(
    address: `0x${string}` | `0x${string}`[],
    events: readonly unknown[],
    from: number,
    to: number,
    concurrency = config.indexerConcurrency,
    batchPauseMs = 0,
  ): Promise<Log[]> {
    const windows: [number, number][] = [];
    for (let s = from; s <= to; s += config.chunkSize) windows.push([s, Math.min(s + config.chunkSize - 1, to)]);
    const out: Log[] = [];
    const conc = Math.max(1, concurrency);
    for (let i = 0; i < windows.length; i += conc) {
      const batch = windows.slice(i, i + conc);
      const results = await Promise.all(batch.map(([s, e]) => this.getLogsRetry(address, events, s, e)));
      for (const r of results) out.push(...r);
      // spread the load so the backfill doesn't spike the RPC in bursts (0 for the forward indexer)
      if (batchPauseMs > 0 && i + conc < windows.length) await sleep(batchPauseMs);
    }
    return out;
  }

  private async ts(block: number): Promise<number> {
    const c = this.tsCache.get(block);
    if (c) return c;
    const b = await this.client.getBlock({ blockNumber: BigInt(block) });
    const t = Number(b.timestamp);
    this.tsCache.set(block, t);
    return t;
  }

  /// One sync pass across [cursor+1, head-lag].
  async sync(): Promise<{ from: number; to: number; head: number }> {
    const head = Number(await this.client.getBlockNumber());
    const tip = head - config.confirmationLag;
    const cursor = getCursor(this.db, "main");
    // Cold start (no cursor, e.g. a fresh volume): honor INDEXER_START_BLOCK if set, else start
    // NEAR HEAD rather than the factory block. This keeps the FORWARD indexer always-current on a
    // fresh DB instead of grinding ~millions of blocks from genesis; historical gaps are filled by
    // POST /admin/backfill, never by the forward loop. (Set INDEXER_START_BLOCK only to override.)
    const from =
      cursor !== null
        ? cursor + 1
        : config.indexerStartBlock ?? Math.max(testnet.factoryBlock, tip - config.indexerColdStartLookback);
    // advance at most maxSpanPerSync blocks per pass so the cursor moves incrementally
    // (prevents a single multi-hundred-thousand-block getLogs marathon before any progress).
    const to = Math.min(tip, from + config.maxSpanPerSync - 1);
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
    for (const log of logs) await this.recordVaultLog(log);
  }

  /// Handle ONE decoded vault log, routed to its vault by the log's emitting address. Shared by the
  /// forward per-vault path and the batched backfill (which queries all vaults in one getLogs).
  private async recordVaultLog(log: Log) {
    const m = this.mandates.get((log.address as string).toLowerCase());
    if (!m) return; // a vault we don't track (shouldn't happen — we query only known vaults)
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

  private async indexTrades(m: Mandate, from: number, to: number) {
    const ev = getAbiItem({ abi: kuruOrderBookAbi as any, name: "Trade" });
    const logs = await this.chunkLogs(m.market, [ev], from, to);
    for (const log of logs) await this.recordTradeLog(log);
  }

  /// Handle ONE decoded Trade log, attributed to the vault that is the maker. Shared by the forward
  /// per-market path and the batched backfill (which queries all markets in one getLogs); a Trade
  /// whose maker is not one of our vaults is ignored.
  private async recordTradeLog(log: Log) {
    const dec: any = decodeEventLog({ abi: kuruOrderBookAbi as any, ...log });
    const a = dec.args as any;
    // ATTRIBUTION: Kuru's Trade carries makerAddress; a fill belongs to a vault iff the maker IS
    // that vault. (Trade args are non-indexed, so we scan markets and attribute here.)
    const m = this.mandates.get((a.makerAddress as string).toLowerCase());
    if (!m) return;
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

  /// Index ONE explicit [from,to] range in BATCH — factory (discover vaults), then ALL known
  /// vaults' events in a single multi-address getLogs, then ALL their markets' Trade fills in one
  /// more. This collapses the per-vault getLogs multiplier (O(vaults × chunks) -> O(chunks)), which
  /// is what makes a multi-hundred-thousand-block historical backfill feasible on the public RPC.
  /// It does NOT touch the forward 'main' cursor. Uses the lower backfill concurrency.
  async indexSpanBatched(from: number, to: number): Promise<void> {
    const conc = config.backfillConcurrency;
    const pause = config.backfillBatchPauseMs;
    // 1) discover any vaults created in this range (idempotent) so we cover them below
    await this.indexFactory(from, to);
    const mandates = [...this.mandates.values()];
    if (mandates.length === 0) return;
    const vaults = mandates.map((m) => m.vault);
    const markets = [...new Set(mandates.map((m) => m.market.toLowerCase()))] as `0x${string}`[];
    // 2) all vault events in ONE multi-address query
    const vaultEvents = (covenantVaultAbi as any).filter((e: any) => e.type === "event");
    const vlogs = await this.chunkLogs(vaults, vaultEvents, from, to, conc, pause);
    for (const log of vlogs) await this.recordVaultLog(log);
    // 3) all markets' Trade fills in ONE multi-address query, attributed by maker
    const tradeEv = getAbiItem({ abi: kuruOrderBookAbi as any, name: "Trade" });
    const tlogs = await this.chunkLogs(markets, [tradeEv], from, to, conc, pause);
    for (const log of tlogs) await this.recordTradeLog(log);
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
