import express, { type Request, type Response } from "express";
import cors from "cors";
import { EventEmitter } from "node:events";
import { covenantVaultAbi, stateName, testnet } from "@covenant/shared";
import { publicClient, notePressure } from "./clients.js";
import { config } from "./config.js";
import { getSetting, setSetting, type DB } from "./db.js";
import type { LiveEvent } from "./indexer.js";
import type { BackfillController } from "./backfill.js";

const j = (o: unknown) => JSON.parse(JSON.stringify(o, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));

/// REST + SSE API for the frontend. `bus` receives every new indexed event; SSE forwards the
/// ones for the subscribed vault within ~1s.
export interface ApiConfig {
  houseMM?: string;
  flagshipVault?: string;
  flagshipMarket?: string;
  faucetEnabled: boolean;
  backfill?: BackfillController;
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

  // GET / — friendly index so the bare URL isn't a scary "Cannot GET /".
  app.get("/", (_req, res) => {
    res.json({
      name: "Covenant backend",
      status: "up",
      docs: "https://github.com/Monarchy712/Covenant",
      endpoints: ["/health", "/config", "/markets", "/mandates", "/mandates/:vault", "/mandates/:vault/summary", "/proof/:vault", "/stream/:vault (SSE)", "POST /faucet", "POST /demo/session"],
    });
  });

  const flagshipVault = (cfg.flagshipVault ?? testnet.vault).toLowerCase();
  const lastActiveTs = (v: string): number | null =>
    ((db.prepare("SELECT MAX(ts) t FROM events WHERE lower(vault)=?").get(v) as any)?.t ?? null);

  // GET /config — everything the UI needs to wire addresses without hardcoding.
  app.get("/config", (_req, res) => {
    const botsOn = getSetting(db, "flagshipBots", "off") === "on";
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
      // The landing page reads this to show an honest state when the flagship is idle:
      // `botsOn=false` + a "last active" timestamp instead of pretending the book is live.
      flagship: { vault: flagshipVault, botsOn, lastActiveTs: lastActiveTs(flagshipVault) },
    });
  });

  // POST /admin/flagship {on:boolean} — the one-command switch to run/stop the flagship bots
  // (house MM + keeper + taker) for recording. Persisted, so a restart keeps the last setting.
  app.post("/admin/flagship", (req, res) => {
    if (!config.adminToken || req.headers["x-admin-token"] !== config.adminToken)
      return res.status(401).json({ ok: false, error: "unauthorized" });
    const on = req.body?.on === true || req.body?.on === "true" || req.body?.on === "on";
    setSetting(db, "flagshipBots", on ? "on" : "off");
    res.json({ ok: true, flagshipBots: on ? "on" : "off", note: on ? "flagship bots ON — MM/keeper/taker will act within a few seconds" : "flagship bots OFF — mandate stays ACTIVE but idle" });
  });

  // POST /admin/backfill {fromBlock, toBlock} — fill a historical gap (e.g. restore flagship
  // compliance history after an ephemeral-DB wipe). Runs a resumable background job that does NOT
  // disturb the forward indexer. Gated by ADMIN_TOKEN. Progress is in /health (`backfill`).
  app.post("/admin/backfill", (req, res) => {
    if (!config.adminToken || req.headers["x-admin-token"] !== config.adminToken)
      return res.status(401).json({ ok: false, error: "unauthorized" });
    if (!cfg.backfill) return res.status(503).json({ ok: false, error: "backfill not available (indexer disabled)" });
    const fromBlock = Number(req.body?.fromBlock);
    const toBlock = Number(req.body?.toBlock);
    const r = cfg.backfill.start(fromBlock, toBlock);
    if (!r.ok) return res.status(409).json({ ok: false, error: r.error, status: cfg.backfill.status() });
    res.json({ ...r, note: "backfill started in background; poll /health.backfill for progress" });
  });

  // GET /markets — demo markets known to the indexer.
  app.get("/markets", (_req, res) => {
    const rows = db.prepare("SELECT DISTINCT market, base, quote FROM mandates WHERE market IS NOT NULL").all() as any[];
    const set = new Map<string, any>();
    for (const r of rows) set.set(String(r.market).toLowerCase(), r);
    if (!set.has(testnet.market.toLowerCase())) set.set(testnet.market.toLowerCase(), { market: testnet.market, base: testnet.base, quote: testnet.quote });
    res.json([...set.values()]);
  });

  // Liveness must reflect the PROCESS, not external-RPC reachability — otherwise a slow/unreachable
  // RPC (common under a long backfill) would flip /health to 503, fail the platform healthcheck, and
  // restart the container in a loop. So /health ALWAYS returns 200 (the process is serving + the DB
  // is readable); the `status` field still reports degraded/down for monitoring. RPC reads are time-
  // boxed so the endpoint can never hang past the healthcheck timeout.
  const withTimeout = <T>(p: Promise<T>, ms = 2500): Promise<T | null> =>
    Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms))]);
  app.get("/health", async (_req, res) => {
    let status: "ok" | "degraded" | "down" = "ok";
    const headRaw = await withTimeout(publicClient.getBlockNumber());
    const head: number | null = headRaw !== null ? Number(headRaw) : null;
    if (head === null) {
      status = "degraded"; // RPC slow/unreachable right now — NOT a liveness failure
      notePressure(); // tell the backfill to back off
    }
    const indexed = (db.prepare("SELECT lastBlock FROM cursor WHERE source='main'").get() as any)?.lastBlock ?? null;
    const lag = head !== null && indexed !== null ? head - indexed : null;
    const balances: Record<string, string> = {};
    let lowWallet = false;
    // Parallel + time-boxed so /health stays fast even when the RPC is saturated.
    await Promise.all(
      Object.entries(walletAddrs).map(async ([name, addr]) => {
        if (!addr) return;
        const bal = await withTimeout(publicClient.getBalance({ address: addr as `0x${string}` }));
        if (bal === null) {
          if (status === "ok") status = "degraded";
          notePressure();
          return;
        }
        balances[name] = bal.toString();
        if (bal < config.keeperMinBalanceWei) lowWallet = true;
      }),
    );
    // Treasury: its own (higher) low-water warning so you know when to refill it.
    let treasury: { address: string; balance: string; low: boolean } | null = null;
    const treasuryAddr = walletAddrs.treasury;
    if (treasuryAddr && balances.treasury !== undefined) {
      const low = BigInt(balances.treasury) < config.treasuryLowWarnWei;
      treasury = { address: treasuryAddr, balance: balances.treasury, low };
    }
    // Faucet: warn below its own threshold (pays mint gas; MON drips come from the treasury).
    let faucet: { address: string; balance: string; low: boolean } | null = null;
    const faucetAddr = walletAddrs.faucet;
    if (faucetAddr && balances.faucet !== undefined) {
      const low = BigInt(balances.faucet) < config.faucetLowWarnWei;
      faucet = { address: faucetAddr, balance: balances.faucet, low };
    }
    // degraded: indexer far behind head, a service wallet below min, or treasury/faucet running low.
    if (status === "ok" && ((lag !== null && lag > 50) || lowWallet || treasury?.low || faucet?.low)) status = "degraded";
    // ALWAYS 200 for liveness (see note above). If the process is dead the fetch fails and the
    // healthcheck still catches it; a transient RPC blip must not restart the container.
    res.status(200).json({
      status,
      head,
      indexed,
      lag,
      lowWallet,
      balances,
      treasury,
      faucet,
      factory: testnet.factory,
      // dbPath should be under the mounted volume (/data/...) so the DB survives a redeploy.
      dbPath: config.dbPath,
      // historical backfill job progress (null when none has run this process)
      backfill: cfg.backfill?.status() ?? null,
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
      notePressure(); // a failed live snapshot read => RPC pressure => backfill backs off
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
    } catch {
      notePressure(); /* failed live read => back the backfill off */
    }
    const counts = {
      fills: (db.prepare("SELECT COUNT(*) c FROM fills WHERE lower(vault)=?").get(v) as any).c,
      checkpoints: (db.prepare("SELECT COUNT(*) c FROM checkpoints WHERE lower(vault)=?").get(v) as any).c,
      paidIntervals: (db.prepare("SELECT COUNT(*) c FROM intervals WHERE lower(vault)=? AND paid=1").get(v) as any).c,
    };
    res.json({ vault, mandate, snapshot: snap, state: snap ? Number(snap.state) : null, stateName: snap ? stateName(Number(snap.state)) : null, counts, lastEventTs: lastActiveTs(v) });
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
      notePressure();
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
