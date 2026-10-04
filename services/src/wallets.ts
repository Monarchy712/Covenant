import { config } from "./config.js"; // loads repo-root .env (side effect on import)
import { formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { publicClient } from "./clients.js";

/// Service wallet roster. `key` is the env var; `moduleUse` lists the modules that spend from it.
/// SEEDER may reuse DEPLOYER (Part 1); FAUCET must be dedicated (not DEPLOYER).
interface WalletRow {
  role: string;
  pk?: `0x${string}`;
  moduleUse: string[];
}

function roster(): WalletRow[] {
  const g = (n: string) => {
    const v = process.env[n];
    return v && v !== "0x..." ? (v as `0x${string}`) : undefined;
  };
  return [
    { role: "KEEPER", pk: g("PRIVATE_KEY_KEEPER"), moduleUse: ["keeper"] },
    { role: "FAUCET", pk: g("PRIVATE_KEY_FAUCET"), moduleUse: ["faucet", "demo-session"] },
    {
      role: "SEEDER",
      pk: g("PRIVATE_KEY_SEEDER") ?? g("PRIVATE_KEY_DEPLOYER"),
      moduleUse: ["seeder"],
    },
    { role: "MM", pk: g("PRIVATE_KEY_MM"), moduleUse: ["house-mm"] },
    { role: "TAKER", pk: g("PRIVATE_KEY_TAKER"), moduleUse: ["taker-bot"] },
    { role: "DEMO_ISSUER", pk: g("PRIVATE_KEY_DEMO_ISSUER") ?? g("PRIVATE_KEY_DEPLOYER"), moduleUse: ["demo-session"] },
    { role: "DEPLOYER", pk: g("PRIVATE_KEY_DEPLOYER"), moduleUse: ["topup-source (not a service)"] },
  ];
}

const MIN = config.keeperMinBalanceWei;

export async function walletsStatus(): Promise<void> {
  const rows = roster();
  console.log(`service wallets (min balance warning < ${formatEther(MIN)} MON):\n`);
  const seen = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.pk) {
      console.log(`  ${r.role.padEnd(12)} (not set)`);
      continue;
    }
    const addr = privateKeyToAccount(r.pk).address;
    const bal = await publicClient.getBalance({ address: addr });
    const warn = bal < MIN ? "  ⚠ LOW" : "";
    console.log(`  ${r.role.padEnd(12)} ${addr}  ${formatEther(bal)} MON${warn}`);
    seen.set(addr.toLowerCase(), [...(seen.get(addr.toLowerCase()) ?? []), r.role]);
  }
  console.log("\nshared addresses:");
  let anyShare = false;
  for (const [addr, roles] of seen) {
    if (roles.length > 1) {
      anyShare = true;
      console.log(`  ${addr} shared by: ${roles.join(", ")}`);
    }
  }
  if (!anyShare) console.log("  none");
}

/// STARTUP CHECK — refuse to start if two ENABLED modules share a wallet address.
/// Called from index.ts before any module starts. Seeder==Deployer is fine because
/// Deployer is not itself a running module.
export function assertNoSharedWallets(enabled: Record<string, `0x${string}` | undefined>): void {
  const byAddr = new Map<string, string[]>();
  for (const [mod, addr] of Object.entries(enabled)) {
    if (!addr) continue;
    const k = addr.toLowerCase();
    byAddr.set(k, [...(byAddr.get(k) ?? []), mod]);
  }
  const clashes = [...byAddr.entries()].filter(([, mods]) => mods.length > 1);
  if (clashes.length > 0) {
    const msg = clashes.map(([addr, mods]) => `${addr} shared by [${mods.join(", ")}]`).join("; ");
    throw new Error(
      `WALLET CONFLICT: enabled modules share a wallet (nonce collision risk): ${msg}. ` +
        `Give each running module its own PRIVATE_KEY_* (FAUCET must differ from DEPLOYER/SEEDER).`,
    );
  }
}

// CLI entry: `tsx src/wallets.ts status`. Topping up is now the treasury's job:
// `pnpm treasury:topup-all` / `pnpm treasury:fund <addr> <amount>` (see src/treasury.ts).
const cmd = process.argv[2];
if (cmd === "status") walletsStatus().catch((e) => (console.error(e), process.exit(1)));
else if (cmd === "topup")
  console.error("`wallets:topup` is removed. Use `pnpm treasury:topup-all` (central treasury funding).");
