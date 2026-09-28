import express, { type Request, type Response } from "express";
import cors from "cors";
import { EventEmitter } from "node:events";
import { covenantVaultAbi, stateName, testnet } from "@covenant/shared";
import { publicClient } from "./clients.js";
import { config } from "./config.js";
import type { DB } from "./db.js";
import type { LiveEvent } from "./indexer.js";

const j = (o: unknown) => JSON.parse(JSON.stringify(o, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));

/// REST + SSE API for the frontend. `bus` receives every new indexed event; SSE forwards the
/// ones for the subscribed vault within ~1s.
export interface ApiConfig {
  houseMM?: string;
  flagshipVault?: string;
  flagshipMarket?: string;
  faucetEnabled: boolean;
}

export function startApi(
  db: DB,
  bus: EventEmitter,
  walletAddrs: Record<string, string>,
  extend?: (app: express.Express) => void,
  cfg: ApiConfig = { faucetEnabled: false },
): void {
  const app = express();
  const allowed = (process.env.ALLOWED_ORIGINS ?? "http://localhost:3000")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  app.use(cors({ origin: allowed.includes("*") ? true : allowed }));
  app.use(express.json());

  // GET /config — everything the UI needs to wire addresses without hardcoding.
  app.get("/config", (_req, res) => {
    res.json({
      chainId: testnet.chainId,
      rpcUrl: config.rpcUrl,
      explorer: "https://testnet.monadexplorer.com",
      factory: testnet.factory,
      houseMM: cfg.houseMM ?? null,
      flagshipVault: cfg.flagshipVault ?? testnet.vault,
      flagshipMarket: cfg.flagshipMarket ?? testnet.market,
      base: testnet.base,
      quote: testnet.quote,
      faucetEnabled: cfg.faucetEnabled,
    });
  });

  // GET /markets — demo markets known to the indexer.
  app.get("/markets", (_req, res) => {
    const rows = db.prepare("SELECT DISTINCT market, base, quote FROM mandates WHERE market IS NOT NULL").all() as any[];
    const set = new Map<string, any>();
    for (const r of rows) set.set(String(r.market).toLowerCase(), r);
    if (!set.has(testnet.market.toLowerCase())) set.set(testnet.market.toLowerCase(), { market: testnet.market, base: testnet.base, quote: testnet.quote });
    res.json([...set.values()]);
  });

  app.get("/health", async (_req, res) => {
    let head: number | null = null;
    let status: "ok" | "degraded" | "down" = "ok";
    try {
      head = Number(await publicClient.getBlockNumber());
    } catch {
      status = "down"; // RPC unreachable
    }
    const indexed = (db.prepare("SELECT lastBlock FROM cursor WHERE source='main'").get() as any)?.lastBlock ?? null;
    const lag = head !== null && indexed !== null ? head - indexed : null;
    const balances: Record<string, string> = {};
    let lowWallet = false;
    for (const [name, addr] of Object.entries(walletAddrs)) {
      if (!addr) continue;
      try {
        const bal = await publicClient.getBalance({ address: addr as `0x${string}` });
        balances[name] = bal.toString();
        if (bal < config.keeperMinBalanceWei) lowWallet = true;
      } catch {
        status = "down";
      }
    }
    // degraded: indexer far behind head, or a service wallet below the min balance.
    if (status === "ok" && ((lag !== null && lag > 50) || lowWallet)) status = "degraded";
    res.status(status === "down" ? 503 : 200).json({
      status,
      head,
      indexed,
      lag,
      lowWallet,
      balances,
      factory: testnet.factory,
    });
  });

  app.get("/mandates", (req, res) => {
    const { issuer, mm } = req.query;
    let sql = "SELECT * FROM mandates";
    const args: string[] = [];
    const where: string[] = [];
    if (issuer) (where.push("lower(issuer)=?"), args.push(String(issuer).toLowerCase()));
    if (mm) (where.push("lower(mm)=?"), args.push(String(mm).toLowerCase()));
    if (where.length) sql += " WHERE " + where.join(" AND ");
    res.json(db.prepare(sql).all(...args));
  });

  app.get("/mandates/:vault", async (req, res) => {
    const vault = req.params.vault as `0x${string}`;
    try {
      const snap: any = await publicClient.readContract({
        address: vault,
        abi: covenantVaultAbi,
        functionName: "snapshot",
      });
      res.json({ vault, state: Number(snap.state), stateName: stateName(Number(snap.state)), snapshot: j(snap) });
    } catch (e: any) {
      res.status(404).json({ error: "vault not found or not readable", detail: String(e?.shortMessage ?? e) });
    }
  });

  const page = (req: Request) => {
    const limit = Math.min(Number(req.query.limit ?? 100), 500);
    const offset = Number(req.query.offset ?? 0);
    return { limit, offset };
  };

  app.get("/mandates/:vault/events", (req, res) => {
    const { limit, offset } = page(req);
    res.json(
      db
        .prepare("SELECT * FROM events WHERE lower(vault)=? ORDER BY block DESC, logIndex DESC LIMIT ? OFFSET ?")
        .all(req.params.vault.toLowerCase(), limit, offset),
    );
  });
  app.get("/mandates/:vault/fills", (req, res) => {
    const { limit, offset } = page(req);
    res.json(
      db
        .prepare("SELECT * FROM fills WHERE lower(vault)=? ORDER BY block DESC LIMIT ? OFFSET ?")
        .all(req.params.vault.toLowerCase(), limit, offset),
    );
  });
  app.get("/mandates/:vault/checkpoints", (req, res) => {
    const { limit, offset } = page(req);
    res.json(
      db
        .prepare("SELECT * FROM checkpoints WHERE lower(vault)=? ORDER BY block DESC LIMIT ? OFFSET ?")
        .all(req.params.vault.toLowerCase(), limit, offset),
    );
  });
  app.get("/mandates/:vault/intervals", (req, res) => {
    res.json(
      db.prepare("SELECT * FROM intervals WHERE lower(vault)=? ORDER BY interval DESC").all(req.params.vault.toLowerCase()),
    );
  });
  app.get("/mandates/:vault/price", (req, res) => {
    const { limit, offset } = page(req);
    res.json(
      db
        .prepare("SELECT block, ts, mid FROM price_points WHERE lower(vault)=? ORDER BY block DESC LIMIT ? OFFSET ?")
        .all(req.params.vault.toLowerCase(), limit, offset),
    );
  });

  // GET /mandates/:vault/summary — one call for dashboard cards (mandate row + live snapshot + counts).
  app.get("/mandates/:vault/summary", async (req, res) => {
    const vault = req.params.vault as `0x${string}`;
    const v = vault.toLowerCase();
    const mandate = db.prepare("SELECT * FROM mandates WHERE lower(vault)=?").get(v);
    let snap: any = null;
    try {
      snap = j(await publicClient.readContract({ address: vault, abi: covenantVaultAbi, functionName: "snapshot" }));
    } catch { /* not readable */ }
    const counts = {
      fills: (db.prepare("SELECT COUNT(*) c FROM fills WHERE lower(vault)=?").get(v) as any).c,
      checkpoints: (db.prepare("SELECT COUNT(*) c FROM checkpoints WHERE lower(vault)=?").get(v) as any).c,
      paidIntervals: (db.prepare("SELECT COUNT(*) c FROM intervals WHERE lower(vault)=? AND paid=1").get(v) as any).c,
    };
    res.json({ vault, mandate, snapshot: snap, state: snap ? Number(snap.state) : null, stateName: snap ? stateName(Number(snap.state)) : null, counts });
  });

  // GET /proof/:vault — public proof page data with explorer links for every number.
  app.get("/proof/:vault", async (req, res) => {
    const vault = req.params.vault as `0x${string}`;
    const v = vault.toLowerCase();
    const ex = "https://testnet.monadexplorer.com";
    try {
      const snap: any = j(await publicClient.readContract({ address: vault, abi: covenantVaultAbi, functionName: "snapshot" }));
      const intervals = db.prepare("SELECT interval, paid, amount, finalizedBlock FROM intervals WHERE lower(vault)=? ORDER BY interval").all(v) as any[];
      const passed = (db.prepare("SELECT COUNT(*) c FROM checkpoints WHERE lower(vault)=? AND passed=1").get(v) as any).c;
      const observed = (db.prepare("SELECT COUNT(*) c FROM checkpoints WHERE lower(vault)=?").get(v) as any).c;
      res.json({
        vault,
        vaultUrl: `${ex}/address/${vault}`,
        state: Number(snap.state),
        stateName: stateName(Number(snap.state)),
        terms: snap.terms,
        netSoldInWindow: snap.netSoldInWindow,
        remainingAllowance: snap.remainingAllowance,
        cap: snap.terms.netSellCapPerWindow,
        accruedFees: snap.accruedFees,
        consecutiveFails: snap.consecutiveFails,
        compliance: { observed, passed, paidIntervals: intervals.filter((i) => i.paid).length, intervals },
      });
    } catch (e: any) {
      res.status(404).json({ error: "vault not readable", detail: String(e?.shortMessage ?? e) });
    }
  });

  // Server-Sent Events: DB-poll so reconnects can resume via Last-Event-ID (= events.rowid).
  // Each event carries `id: <rowid>`; heartbeat every 15s; ~1s poll latency.
  app.get("/stream/:vault", (req: Request, res: Response) => {
    const vault = req.params.vault.toLowerCase();
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write("retry: 3000\n\n"); // client reconnect backoff hint

    const lastHeader = req.headers["last-event-id"];
    let cursorId = lastHeader ? Number(lastHeader) : 0;
    if (!lastHeader) {
      // start from the current max so we only stream NEW events (no full backfill on fresh connect)
      cursorId = (db.prepare("SELECT COALESCE(MAX(rowid),0) m FROM events").get() as any).m;
    }

    const q = db.prepare("SELECT rowid AS id, name, txHash, block, ts, args FROM events WHERE lower(vault)=? AND rowid>? ORDER BY rowid LIMIT 200");
    const pump = () => {
      const rows = q.all(vault, cursorId) as any[];
      for (const r of rows) {
        cursorId = r.id;
        res.write(`id: ${r.id}\nevent: ${r.name}\ndata: ${JSON.stringify({ name: r.name, txHash: r.txHash, block: r.block, ts: r.ts, args: JSON.parse(r.args ?? "null") })}\n\n`);
      }
    };
    pump();
    const poll = setInterval(pump, 1000);
    const beat = setInterval(() => res.write(": heartbeat\n\n"), 15000);
    req.on("close", () => {
      clearInterval(poll);
      clearInterval(beat);
    });
  });

  // faucet / demo endpoints are registered by the faucet module if enabled.
  if (extend) extend(app);
  app.listen(config.port, () => console.log(`[api] listening on :${config.port}`));
}
