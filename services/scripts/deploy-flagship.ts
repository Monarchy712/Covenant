import { config } from "../src/config.js"; // loads .env (side effect)
import { encodeFunctionData, type Address } from "viem";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  testnet,
  covenantFactoryAbi,
  covenantVaultAbi,
  mockErc20Abi,
  type Terms,
} from "@covenant/shared";
import { makeWallet, publicClient, sendTx } from "../src/clients.js";

/// deploy-flagship — creates the long-lived LANDING-PAGE flagship mandate on the existing factory
/// + market, funds a full 30-day fee escrow, seeds an initial resting two-sided book, and
/// activates it. It reuses the deployed tokens/market (no fresh deploy) so the current seeder
/// book stays relevant. After this, leave the flagship ACTIVE + IDLE (flagship bots OFF); the
/// resting book + on-chain snapshot keep the landing page honest, and unobserved intervals are
/// neutral (no breach). Flip the bots on for the video/judging via POST /admin/flagship or
/// FLAGSHIP_BOTS=on.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const V = covenantVaultAbi;
const E = mockErc20Abi;
const F = covenantFactoryAbi;

// Flagship terms (issuer-chosen): 30-day life, 10-min KPI interval, 1-hr net-sell window.
const DURATION = 30n * 24n * 3600n; // 2,592,000s -> ~Oct 28 (covers Oct 25 judging)
const CHECKPOINT = 600n; // 10 min
const WINDOW = 3600n; // 1 hr
const FEE_PER_INTERVAL = 50n * 10n ** 6n; // 50 quote / interval
const SP = 10_000_000_000n; // sizePrecision 1e10
// Initial resting quote ~2.0 mid, 0.6% spread (< 1% maxSpread), inside the ±2% band.
const BID_PX = 199_400_000n; // 1.994
const ASK_PX = 200_600_000n; // 2.006
const QTY = 100n * SP;

async function tx(w: ReturnType<typeof makeWallet>, to: Address, abi: any, fn: string, args: any[], label: string) {
  const { hash } = await sendTx(w, { to, data: encodeFunctionData({ abi, functionName: fn, args }), label });
  console.log(`[flagship] ${label}: ${hash}`);
  return hash;
}
const read = (to: Address, fn: string, args: any[] = [], abi: any = V) =>
  publicClient.readContract({ address: to, abi, functionName: fn, args });

async function main() {
  const issuerKey = (process.env.PRIVATE_KEY_DEMO_ISSUER ?? process.env.PRIVATE_KEY_DEPLOYER) as `0x${string}`;
  const mmKey = process.env.PRIVATE_KEY_MM as `0x${string}`;
  if (!issuerKey || !mmKey) throw new Error("need PRIVATE_KEY_DEPLOYER (or DEMO_ISSUER) and PRIVATE_KEY_MM in .env");
  const issuer = makeWallet(issuerKey);
  const mm = makeWallet(mmKey);
  const { factory, market, base, quote } = testnet;
  console.log(`issuer=${issuer.account.address} mm=${mm.account.address}`);
  console.log(`reusing factory=${factory} market=${market} base=${base} quote=${quote}`);

  const intervals = DURATION / CHECKPOINT;
  const escrow = intervals * FEE_PER_INTERVAL; // full 30-day escrow
  const invBase = 5_000n * 10n ** 18n;
  const invQuote = 5_000n * 10n ** 6n;
  console.log(`[flagship] escrow = ${intervals} intervals x ${FEE_PER_INTERVAL} = ${escrow} (${Number(escrow) / 1e6} quote)`);

  const startBlock = Number(await publicClient.getBlockNumber());

  // 1) create the mandate (inviting the house MM)
  const terms: Terms = {
    market, baseToken: base, quoteToken: quote,
    issuer: issuer.account.address as Address, mm: mm.account.address as Address,
    netSellCapPerWindow: 1000n * 10n ** 18n, windowLength: WINDOW, bandBps: 200n, maxOpenPerSide: 5n,
    maxSpreadBps: 100n, minDepthPerSide: 10n ** 18n, checkpointInterval: CHECKPOINT,
    feePerInterval: FEE_PER_INTERVAL, duration: DURATION, maxConsecutiveFails: 3n,
  };
  await tx(issuer, factory, F, "createMandate", [terms], "createMandate");
  const list = (await read(factory, "mandatesOf", [issuer.account.address], F)) as Address[];
  const vault = list.at(-1)!;
  console.log(`[flagship] vault=${vault}`);

  // 2) accept (pins the on-chain terms hash)
  const th = (await read(vault, "termsHash")) as `0x${string}`;
  await tx(mm, vault, V, "accept", [th], "accept(termsHash)");

  // 3) mint + approve + deposit inventory + fund the full escrow + activate
  await tx(issuer, base, E, "mint", [issuer.account.address, invBase], "mint base->issuer");
  await tx(issuer, quote, E, "mint", [issuer.account.address, escrow + invQuote], "mint quote->issuer");
  await tx(issuer, base, E, "approve", [vault, invBase], "approve base");
  await tx(issuer, quote, E, "approve", [vault, escrow + invQuote], "approve quote");
  await tx(issuer, vault, V, "depositInventory", [base, invBase], "depositInventory base");
  await tx(issuer, vault, V, "depositInventory", [quote, invQuote], "depositInventory quote");
  await tx(issuer, vault, V, "fundFees", [escrow], "fundFees (full 30-day escrow)");
  await tx(issuer, vault, V, "activate", [], "activate");

  // 4) seed an initial resting two-sided book so the landing page is never empty while idle
  try {
    await tx(mm, vault, V, "quote", [[BID_PX], [QTY], [ASK_PX], [QTY], []], "seed resting quote");
  } catch (e: any) {
    console.log(`[flagship] initial quote reverted (book may need a fresher mid): ${String(e?.shortMessage ?? e).slice(0, 140)}`);
  }

  // 5) rewrite deployments + the shared copy the frontend imports
  const depPath = resolve(repoRoot, "deployments/testnet.json");
  const dep = JSON.parse(readFileSync(depPath, "utf8"));
  dep.vault = vault;
  dep.flagshipVault = vault;
  dep.flagshipBlock = startBlock;
  const out = JSON.stringify(dep, null, 2) + "\n";
  writeFileSync(depPath, out);
  writeFileSync(resolve(repoRoot, "packages/shared/abi/deployments.testnet.json"), out);

  const snap: any = await read(vault, "snapshot");
  console.log("\n[flagship] DONE.");
  console.log(JSON.stringify({ vault, state: Number(snap.state), openOrders: (snap.openOrders as any[]).length, flagshipBlock: startBlock }, null, 2));
  console.log(`\nSet on Railway:  FLAGSHIP_VAULT=${vault}   INDEXER_START_BLOCK=${startBlock}`);
  console.log("Rebuild shared (pnpm build:shared) so the API serves the new flagship, then redeploy.");
}

main().catch((e) => {
  console.error("fatal", e);
  process.exit(1);
});
