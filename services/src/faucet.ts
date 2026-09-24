import type { Express, Request, Response } from "express";
import { encodeFunctionData, isAddress } from "viem";
import { mockErc20Abi, testnet } from "@covenant/shared";
import { publicClient, sendTx, type Wallet } from "./clients.js";
import { config } from "./config.js";
import type { DB } from "./db.js";

/// Testnet-only faucet + demo sessions. Rate-limited per address AND per IP (once/24h), with
/// fixed amounts and a daily MON budget cap. Never holds user keys — it only funds addresses.
export function registerFaucet(app: Express, db: DB, faucet: Wallet) {
  function spentMonLast24h(): bigint {
    const since = Math.floor(Date.now() / 1000) - 24 * 3600;
    const rows = db.prepare("SELECT monAmount FROM faucet_log WHERE ts>=?").all(since) as { monAmount: string }[];
    return rows.reduce((a, r) => a + BigInt(r.monAmount), 0n);
  }
  function recentlyFunded(key: string, col: "address" | "ip"): boolean {
    const since = Math.floor(Date.now() / 1000) - config.faucetPerAddressCooldownMs / 1000;
    const row = db.prepare(`SELECT ts FROM faucet_log WHERE ${col}=? AND ts>=? LIMIT 1`).get(key, since);
    return !!row;
  }

  async function fund(address: `0x${string}`, ip: string) {
    if (!isAddress(address)) throw { code: 400, msg: "bad address" };
    if (recentlyFunded(address.toLowerCase(), "address")) throw { code: 429, msg: "address funded in last 24h" };
    if (recentlyFunded(ip, "ip")) throw { code: 429, msg: "ip funded in last 24h" };
    if (spentMonLast24h() + config.faucetMonDrip > config.faucetDailyMonBudget)
      throw { code: 429, msg: "daily MON budget exhausted" };

    const hashes: Record<string, string> = {};
    // mint base + quote (mocks are openly mintable — confirmed in the spike)
    hashes.base = (
      await sendTx(faucet, {
        to: testnet.base,
        data: encodeFunctionData({ abi: mockErc20Abi, functionName: "mint", args: [address, config.faucetBaseAmount] }),
        label: "faucet.mintBase",
      })
    ).hash;
    hashes.quote = (
      await sendTx(faucet, {
        to: testnet.quote,
        data: encodeFunctionData({ abi: mockErc20Abi, functionName: "mint", args: [address, config.faucetQuoteAmount] }),
        label: "faucet.mintQuote",
      })
    ).hash;
    // MON drip
    hashes.mon = await faucet.nonce.submit((nonce) =>
      faucet.client.sendTransaction({
        account: faucet.account,
        chain: publicClient.chain,
        to: address,
        value: config.faucetMonDrip,
        gas: 21_000n,
        nonce,
      }),
    );

    db.prepare("INSERT INTO faucet_log(address,ip,ts,monAmount) VALUES(?,?,?,?)").run(
      address.toLowerCase(),
      ip,
      Math.floor(Date.now() / 1000),
      config.faucetMonDrip.toString(),
    );
    return hashes;
  }

  app.post("/faucet", async (req: Request, res: Response) => {
    try {
      const address = (req.body?.address ?? "") as `0x${string}`;
      const ip = (req.headers["x-forwarded-for"]?.toString().split(",")[0] ?? req.ip ?? "unknown").trim();
      const hashes = await fund(address, ip);
      res.json({ ok: true, hashes, base: config.faucetBaseAmount.toString(), quote: config.faucetQuoteAmount.toString(), mon: config.faucetMonDrip.toString() });
    } catch (e: any) {
      res.status(e?.code ?? 500).json({ ok: false, error: e?.msg ?? String(e?.shortMessage ?? e) });
    }
  });

  app.post("/demo/session", async (req: Request, res: Response) => {
    try {
      const address = (req.body?.address ?? "") as `0x${string}`;
      const ip = (req.headers["x-forwarded-for"]?.toString().split(",")[0] ?? req.ip ?? "unknown").trim();
      const hashes = await fund(address, ip);
      // The frontend generates the burner in-browser; we just fund it and hand back a demo context.
      res.json({
        ok: true,
        hashes,
        demo: {
          factory: testnet.factory,
          market: testnet.market,
          vault: testnet.vault, // the live demo mandate (see demo:setup)
          base: testnet.base,
          quote: testnet.quote,
          suggestedRoles: ["trader", "observer"],
        },
      });
    } catch (e: any) {
      res.status(e?.code ?? 500).json({ ok: false, error: e?.msg ?? String(e?.shortMessage ?? e) });
    }
  });
}
