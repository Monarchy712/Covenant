import type { Express, Request, Response } from "express";
import { encodeFunctionData, isAddress, type Address } from "viem";
import { mockErc20Abi, covenantFactoryAbi, covenantVaultAbi, testnet, type Terms } from "@covenant/shared";
import { publicClient, sendTx, type Wallet } from "./clients.js";
import { config } from "./config.js";
import type { DB } from "./db.js";

/// Create + fund + activate a fresh SHORT demo mandate inviting `mmAddress`, using the demo-issuer
/// wallet. Returns the new vault. Used by role=mm demo sessions and /demo/reset.
async function createDemoMandate(demoIssuer: Wallet, mmAddress: Address): Promise<Address> {
  const terms: Terms = {
    market: testnet.market, baseToken: testnet.base, quoteToken: testnet.quote,
    issuer: demoIssuer.account.address as Address, mm: mmAddress,
    netSellCapPerWindow: 1000n * 10n ** 18n, windowLength: 90n, bandBps: 200n, maxOpenPerSide: 5n,
    maxSpreadBps: 100n, minDepthPerSide: 10n ** 18n, checkpointInterval: 45n,
    feePerInterval: 50n * 10n ** 6n, duration: 3600n, maxConsecutiveFails: 3n,
  };
  const F = covenantFactoryAbi, V = covenantVaultAbi, E = mockErc20Abi;
  await sendTx(demoIssuer, { to: testnet.factory, data: encodeFunctionData({ abi: F, functionName: "createMandate", args: [terms as any] }), label: "demo.createMandate" });
  const list = (await publicClient.readContract({ address: testnet.factory, abi: F, functionName: "mandatesOf", args: [demoIssuer.account.address] })) as Address[];
  const vault = list.at(-1)!;
  // fund the demo-issuer, approve, deposit, fundFees, activate
  await sendTx(demoIssuer, { to: testnet.base, data: encodeFunctionData({ abi: E, functionName: "mint", args: [demoIssuer.account.address, 2000n * 10n ** 18n] }), label: "demo.mintBase" });
  await sendTx(demoIssuer, { to: testnet.quote, data: encodeFunctionData({ abi: E, functionName: "mint", args: [demoIssuer.account.address, 2000n * 10n ** 6n] }), label: "demo.mintQuote" });
  await sendTx(demoIssuer, { to: testnet.base, data: encodeFunctionData({ abi: E, functionName: "approve", args: [vault, 2000n * 10n ** 18n] }), label: "demo.approveBase" });
  await sendTx(demoIssuer, { to: testnet.quote, data: encodeFunctionData({ abi: E, functionName: "approve", args: [vault, 2000n * 10n ** 6n] }), label: "demo.approveQuote" });
  await sendTx(demoIssuer, { to: vault, data: encodeFunctionData({ abi: V, functionName: "depositInventory", args: [testnet.base, 1000n * 10n ** 18n] }), label: "demo.depositBase" });
  await sendTx(demoIssuer, { to: vault, data: encodeFunctionData({ abi: V, functionName: "depositInventory", args: [testnet.quote, 1000n * 10n ** 6n] }), label: "demo.depositQuote" });
  await sendTx(demoIssuer, { to: vault, data: encodeFunctionData({ abi: V, functionName: "fundFees", args: [500n * 10n ** 6n] }), label: "demo.fundFees" });
  await sendTx(demoIssuer, { to: vault, data: encodeFunctionData({ abi: V, functionName: "activate", args: [] }), label: "demo.activate" });
  return vault;
}

/// Testnet-only faucet + demo sessions. Rate-limited per address AND per IP (once/24h), with
/// fixed amounts and a daily MON budget cap. Never holds user keys — it only funds addresses.
export function registerFaucet(app: Express, db: DB, faucet: Wallet, demoIssuer?: Wallet, houseMM?: string) {
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

  // Role-based demo session. The backend NEVER holds the burner key — it only funds it.
  app.post("/demo/session", async (req: Request, res: Response) => {
    try {
      const address = (req.body?.address ?? "") as `0x${string}`;
      const role = String(req.body?.role ?? "trader");
      if (!["issuer", "mm", "trader"].includes(role)) throw { code: 400, msg: "role must be issuer|mm|trader" };
      const ip = (req.headers["x-forwarded-for"]?.toString().split(",")[0] ?? req.ip ?? "unknown").trim();
      const hashes = await fund(address, ip);
      const common = { factory: testnet.factory, market: testnet.market, base: testnet.base, quote: testnet.quote };

      if (role === "issuer") {
        // Judge runs the wizard; offer the house MM to invite.
        res.json({ ok: true, role, hashes, demo: { ...common, houseMM: houseMM ?? null } });
      } else if (role === "mm") {
        if (!demoIssuer) throw { code: 503, msg: "demo-issuer wallet not configured" };
        const vault = await createDemoMandate(demoIssuer, address);
        res.json({ ok: true, role, hashes, demo: { ...common, vault, invitePath: `/invite/${vault}` } });
      } else {
        // trader: a live mandate + market for the trade panel.
        res.json({ ok: true, role, hashes, demo: { ...common, vault: testnet.vault } });
      }
    } catch (e: any) {
      res.status(e?.code ?? 500).json({ ok: false, error: e?.msg ?? String(e?.shortMessage ?? e) });
    }
  });

  // Admin: fresh flagship demo mandate (inviting the house MM). Gated by ADMIN_TOKEN.
  app.post("/demo/reset", async (req: Request, res: Response) => {
    if (!config.adminToken || req.headers["x-admin-token"] !== config.adminToken)
      return res.status(401).json({ ok: false, error: "unauthorized" });
    if (!demoIssuer || !houseMM) return res.status(503).json({ ok: false, error: "demo-issuer or houseMM not configured" });
    try {
      const vault = await createDemoMandate(demoIssuer, houseMM as Address);
      res.json({ ok: true, flagshipVault: vault, note: "house MM will auto-accept + quote within a few seconds" });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.shortMessage ?? e) });
    }
  });
}
