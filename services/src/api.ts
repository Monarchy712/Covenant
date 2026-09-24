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
export function startApi(
  db: DB,
  bus: EventEmitter,
  walletAddrs: Record<string, string>,
  extend?: (app: express.Express) => void,
): void {
  const app = express();
  app.use(cors({ origin: true }));
  app.use(express.json());

  app.get("/health", async (_req, res) => {
    const head = Number(await publicClient.getBlockNumber());
    const indexed = (db.prepare("SELECT lastBlock FROM cursor WHERE source='main'").get() as any)?.lastBlock ?? null;
    const balances: Record<string, string> = {};
    for (const [name, addr] of Object.entries(walletAddrs)) {
      if (!addr) continue;
      balances[name] = (await publicClient.getBalance({ address: addr as `0x${string}` })).toString();
    }
    res.json({ head, indexed, lag: indexed === null ? null : head - indexed, balances, factory: testnet.factory });
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

  // Server-Sent Events: push each new decoded event for this vault.
  app.get("/stream/:vault", (req: Request, res: Response) => {
    const vault = req.params.vault.toLowerCase();
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(`: connected to ${vault}\n\n`);
    const listener = (e: LiveEvent) => {
      if (e.vault !== vault) return;
      res.write(`event: ${e.name}\ndata: ${JSON.stringify(e)}\n\n`);
    };
    bus.on("event", listener);
    const ping = setInterval(() => res.write(": ping\n\n"), 15000);
    req.on("close", () => {
      clearInterval(ping);
      bus.off("event", listener);
    });
  });

  // faucet / demo endpoints are registered by the faucet module if enabled.
  if (extend) extend(app);
  app.listen(config.port, () => console.log(`[api] listening on :${config.port}`));
}
