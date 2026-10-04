import { config } from "./config.js"; // loads repo-root .env (side effect on import)
import { formatEther, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "@covenant/shared";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { publicClient, makeWallet, type Wallet } from "./clients.js";
import { openDb, type DB } from "./db.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface TargetWallet {
  role: string;
  address: `0x${string}`;
  target: bigint;
  threshold: bigint;
}

/// The service-wallet roster the treasury funds, resolved from PRIVATE_KEY_* + config targets.
/// This is the auto-top-up ALLOWLIST — the hosted module funds ONLY these addresses.
export function serviceWallets(): TargetWallet[] {
  const keyed: [string, `0x${string}` | undefined][] = [
    ["keeper", config.keeperKey],
    ["faucet", config.faucetKey],
    ["seeder", config.seederKey],
    ["mm", config.mmKey],
    ["taker", config.takerKey],
    ["demoIssuer", config.demoIssuerKey],
  ];
  const out: TargetWallet[] = [];
  const seen = new Set<string>();
  for (const [role, key] of keyed) {
    if (!key || key === ("0x..." as string)) continue;
    const address = privateKeyToAccount(key).address;
    const lc = address.toLowerCase();
    if (seen.has(lc)) continue; // de-dupe shared wallets (e.g. demoIssuer==deployer)
    seen.add(lc);
    const t = config.treasuryTargets[role] ?? { target: parseEther("5"), threshold: parseEther("2") };
    out.push({ role, address, target: t.target, threshold: t.threshold });
  }
  return out;
}

/// Persisted QA burner — CLI topup-all ONLY (never the hosted allowlist). Resolved from
/// QA_BURNER_ADDRESS, else the gitignored .secrets/burner.key (checked relative to cwd + repo root).
export function qaBurner(): TargetWallet | undefined {
  let address: `0x${string}` | undefined = process.env.QA_BURNER_ADDRESS as `0x${string}` | undefined;
  if (!address) {
    for (const p of [resolve(process.cwd(), ".secrets/burner.key"), resolve(process.cwd(), "../.secrets/burner.key")]) {
      if (existsSync(p)) {
        try {
          address = privateKeyToAccount(readFileSync(p, "utf8").trim() as `0x${string}`).address;
          break;
        } catch {
          /* ignore malformed */
        }
      }
    }
  }
  if (!address) return undefined;
  return { role: "qaBurner", address, target: config.qaBurnerTarget, threshold: config.qaBurnerTarget / 2n };
}

export class Treasury {
  readonly wallet: Wallet;
  readonly address: `0x${string}`;
  private allow: Set<string>;

  constructor(
    private db: DB,
    key: `0x${string}`,
  ) {
    this.wallet = makeWallet(key);
    this.address = this.wallet.account.address;
    this.allow = new Set(serviceWallets().map((w) => w.address.toLowerCase()));
  }

  balanceOf(addr: `0x${string}`): Promise<bigint> {
    return publicClient.getBalance({ address: addr });
  }

  spentLast24hWei(): bigint {
    const since = Math.floor(Date.now() / 1000) - 24 * 3600;
    const rows = this.db.prepare("SELECT amountWei FROM treasury_log WHERE ts>=?").all(since) as { amountWei: string }[];
    return rows.reduce((a, r) => a + BigInt(r.amountWei), 0n);
  }

  /// Safety-checked single transfer. Enforces per-transfer cap, 24h cap, and the reserve floor.
  /// `enforceAllowlist` (hosted auto path) refuses any address not in the service-wallet set.
  async fund(
    to: `0x${string}`,
    amountWei: bigint,
    role: string,
    source: "cli" | "auto",
    enforceAllowlist = false,
  ): Promise<`0x${string}`> {
    if (amountWei <= 0n) throw new Error("amount must be > 0");
    if (enforceAllowlist && !this.allow.has(to.toLowerCase()))
      throw new Error(`refused: ${to} is not a service wallet (auto-top-up allowlist only)`);
    if (amountWei > config.treasuryMaxPerTransferWei)
      throw new Error(`per-transfer cap: ${formatEther(amountWei)} > ${formatEther(config.treasuryMaxPerTransferWei)} MON`);
    const spent = this.spentLast24hWei();
    if (spent + amountWei > config.treasuryMaxPerDayWei)
      throw new Error(`daily cap: would spend ${formatEther(spent + amountWei)} > ${formatEther(config.treasuryMaxPerDayWei)} MON in 24h`);
    const bal = await this.balanceOf(this.address);
    if (bal - amountWei < config.treasuryMinReserveWei)
      throw new Error(
        `reserve floor: sending ${formatEther(amountWei)} would drop the treasury below ${formatEther(config.treasuryMinReserveWei)} MON (has ${formatEther(bal)})`,
      );

    // Explicit gas limit for a plain value transfer (Monad charges the limit; 50k is a safe
    // margin over the 21k base). The treasury is a dedicated wallet with its own NonceManager.
    const hash = await this.wallet.nonce.submit((nonce) =>
      this.wallet.client.sendTransaction({
        account: this.wallet.account,
        chain: monadTestnet,
        to,
        value: amountWei,
        gas: 50_000n,
        nonce,
      }),
    );
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`treasury transfer reverted: ${hash}`);
    this.db
      .prepare("INSERT INTO treasury_log(ts,toAddr,role,amountWei,txHash,source) VALUES(?,?,?,?,?,?)")
      .run(Math.floor(Date.now() / 1000), to.toLowerCase(), role, amountWei.toString(), hash, source);
    console.log(`[treasury] +${formatEther(amountWei)} MON -> ${role} ${to}  tx=${hash}`);
    return hash;
  }

  /// Bring each below-threshold wallet up to its target (capped by the per-transfer limit).
  async topup(
    targets: TargetWallet[],
    source: "cli" | "auto",
    enforceAllowlist = false,
  ): Promise<{ role: string; address: string; before: string; funded: string; txHash?: string; note?: string }[]> {
    const out = [];
    for (const t of targets) {
      const bal = await this.balanceOf(t.address);
      if (bal >= t.threshold) {
        out.push({ role: t.role, address: t.address, before: formatEther(bal), funded: "0", note: "ok" });
        continue;
      }
      let need = t.target - bal;
      if (need > config.treasuryMaxPerTransferWei) need = config.treasuryMaxPerTransferWei;
      try {
        const hash = await this.fund(t.address, need, t.role, source, enforceAllowlist);
        out.push({ role: t.role, address: t.address, before: formatEther(bal), funded: formatEther(need), txHash: hash });
      } catch (e: unknown) {
        out.push({
          role: t.role,
          address: t.address,
          before: formatEther(bal),
          funded: "0",
          note: `SKIPPED: ${String((e as Error)?.message ?? e).slice(0, 120)}`,
        });
      }
    }
    return out;
  }
}

/// Hosted auto-top-up loop (RUN_TREASURY=true). Tops up ONLY service wallets (allowlist), every
/// `treasuryTopupIntervalMs`. Never funds arbitrary / QA addresses automatically.
export function startTreasuryLoop(treasury: Treasury): void {
  console.log(
    `[treasury] auto-top-up on (${treasury.address}) — every ${Math.round(config.treasuryTopupIntervalMs / 1000)}s, ` +
      `caps: ${formatEther(config.treasuryMaxPerTransferWei)}/tx, ${formatEther(config.treasuryMaxPerDayWei)}/day, reserve ${formatEther(config.treasuryMinReserveWei)} MON`,
  );
  (async () => {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        const res = await treasury.topup(serviceWallets(), "auto", true);
        const funded = res.filter((r) => r.txHash);
        if (funded.length) console.log(`[treasury] auto-topped ${funded.map((f) => `${f.role}+${f.funded}`).join(", ")}`);
      } catch (e: unknown) {
        console.error(`[treasury] loop error: ${String((e as Error)?.message ?? e)}`);
      }
      await sleep(config.treasuryTopupIntervalMs);
    }
  })();
}

// ---------------------------------------------------------------------------
// CLI: pnpm treasury:status | treasury:fund <address> <amountMON> | treasury:topup-all
// ---------------------------------------------------------------------------
async function cliStatus(): Promise<void> {
  if (!config.treasuryKey || config.treasuryKey === ("0x..." as string)) {
    console.error("PRIVATE_KEY_TREASURY not set.");
    process.exit(1);
  }
  const db = openDb();
  const t = new Treasury(db, config.treasuryKey);
  const bal = await t.balanceOf(t.address);
  const spent = t.spentLast24hWei();
  const low = bal < config.treasuryLowWarnWei;
  console.log(`\nTreasury ${t.address}`);
  console.log(`  balance:      ${formatEther(bal)} MON${low ? "   ⚠ LOW — refill soon" : ""}`);
  console.log(`  spent (24h):  ${formatEther(spent)} / ${formatEther(config.treasuryMaxPerDayWei)} MON`);
  console.log(`  reserve:      ${formatEther(config.treasuryMinReserveWei)} MON  ·  max/tx ${formatEther(config.treasuryMaxPerTransferWei)} MON\n`);
  const roster = [...serviceWallets(), ...(qaBurner() ? [qaBurner()!] : [])];
  console.log("service wallets (balance / threshold / target):");
  for (const w of roster) {
    const b = await t.balanceOf(w.address);
    const flag = b < w.threshold ? "  ⚠ below threshold" : "";
    console.log(`  ${w.role.padEnd(11)} ${w.address}  ${formatEther(b)} / ${formatEther(w.threshold)} / ${formatEther(w.target)} MON${flag}`);
  }
  console.log("");
}

async function cliFund(addr: string, amountMon: string): Promise<void> {
  if (!config.treasuryKey) throw new Error("PRIVATE_KEY_TREASURY not set.");
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) throw new Error(`bad address: ${addr}`);
  const db = openDb();
  const t = new Treasury(db, config.treasuryKey);
  const wei = parseEther(amountMon);
  const hash = await t.fund(addr as `0x${string}`, wei, "manual", "cli");
  console.log(`funded ${addr} with ${amountMon} MON — tx ${hash}`);
}

async function cliTopupAll(): Promise<void> {
  if (!config.treasuryKey) throw new Error("PRIVATE_KEY_TREASURY not set.");
  const db = openDb();
  const t = new Treasury(db, config.treasuryKey);
  const targets = [...serviceWallets(), ...(qaBurner() ? [qaBurner()!] : [])];
  console.log(`topping up ${targets.length} wallets below threshold from ${t.address}…\n`);
  const res = await t.topup(targets, "cli"); // CLI: allowlist not enforced (includes QA burner)
  for (const r of res) {
    if (r.txHash) console.log(`  ${r.role.padEnd(11)} +${r.funded} MON  tx=${r.txHash}`);
    else console.log(`  ${r.role.padEnd(11)} ${r.note} (has ${r.before} MON)`);
  }
  const total = res.reduce((a, r) => a + parseEther(r.funded), 0n);
  console.log(`\ndone. total sent: ${formatEther(total)} MON`);
}

const cmd = process.argv[2];
if (cmd === "status") cliStatus().then(() => process.exit(0)).catch((e) => (console.error(e), process.exit(1)));
else if (cmd === "fund") cliFund(process.argv[3], process.argv[4]).then(() => process.exit(0)).catch((e) => (console.error(String(e?.message ?? e)), process.exit(1)));
else if (cmd === "topup-all") cliTopupAll().then(() => process.exit(0)).catch((e) => (console.error(String(e?.message ?? e)), process.exit(1)));
