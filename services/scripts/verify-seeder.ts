import { config } from "../src/config.js"; // loads .env
import { encodeFunctionData, type Address } from "viem";
import { covenantVaultAbi, kuruOrderBookAbi, mockErc20Abi, testnet } from "@covenant/shared";
import { makeWallet, publicClient, sendTx } from "../src/clients.js";
import { SeederBot } from "../src/bots.js";

/// Verify the seeder-fix on live testnet: with the vault (house MM) quoting TIGHT and the seeder
/// quoting OUTSIDE, the vault is top-of-book and a small taker buy fills the VAULT (Trade.maker ==
/// vault), which the hosted indexer records in /mandates/:vault/fills within seconds.
const BASE_URL = process.env.API_URL ?? "https://covenantservices-production.up.railway.app";
const PP = 100_000_000n; // 1e8
const SP = 10_000_000_000n; // 1e10
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fillsCount(vault: string): Promise<number> {
  const r = await fetch(`${BASE_URL}/mandates/${vault}/fills?limit=500`).then((x) => x.json()).catch(() => []);
  return Array.isArray(r) ? r.length : 0;
}

async function main() {
  const mm = makeWallet(process.env.PRIVATE_KEY_MM as `0x${string}`);
  const taker = makeWallet(process.env.PRIVATE_KEY_TAKER as `0x${string}`);
  const seeder = makeWallet((process.env.PRIVATE_KEY_SEEDER ?? process.env.PRIVATE_KEY_DEPLOYER) as `0x${string}`);
  const vault = testnet.vault as Address;
  const market = testnet.market as Address;
  console.log(`flagship vault=${vault} market=${market}`);
  console.log(`mm=${mm.account.address} seeder=${seeder.account.address} taker=${taker.account.address}`);

  // current mid + cancel ids
  const snap: any = await publicClient.readContract({ address: vault, abi: covenantVaultAbi, functionName: "snapshot" });
  const cancelIds = (snap.openOrders as any[]).map((o) => Number(o.id));
  const [bb, ba] = (await publicClient.readContract({ address: market, abi: kuruOrderBookAbi, functionName: "bestBidAsk" })) as [bigint, bigint];
  const MAX = (1n << 256n) - 1n;
  const mid18 = bb !== MAX && ba !== MAX && bb !== 0n && ba !== 0n ? (bb + ba) / 2n : 2n * 10n ** 18n;
  const align = (pu: bigint) => (pu / 100n) * 100n;
  const toPu = (m18: bigint) => align((m18 * PP) / 10n ** 18n);
  const vaultBid = toPu((mid18 * 9970n) / 10000n); // -30 bps
  const vaultAsk = toPu((mid18 * 10030n) / 10000n); // +30 bps
  const seedBid = toPu((mid18 * (10000n - config.seederOffsetBps)) / 10000n);
  const seedAsk = toPu((mid18 * (10000n + config.seederOffsetBps)) / 10000n);
  console.log(`mid=${Number(mid18) / 1e18}  vaultAsk=${Number(vaultAsk) / 1e8}  seedAsk=${Number(seedAsk) / 1e8} (offset ${config.seederOffsetBps}bps)`);
  if (seedAsk <= vaultAsk || seedBid >= vaultBid) throw new Error("MISCONFIG: seeder offset is not outside the vault spread");

  // 1) vault quotes TIGHT (cancel old, place ±30bps)
  const QTY = 100n * SP;
  await sendTx(mm, { to: vault, data: encodeFunctionData({ abi: covenantVaultAbi, functionName: "quote", args: [[Number(vaultBid)], [QTY], [Number(vaultAsk)], [QTY], cancelIds] }), label: "mm.quote tight" });

  // 2) seeder posts OUTSIDE (real new code path)
  await new SeederBot(seeder, market).tick();

  // 3) assert the vault is top-of-book (best ask == vault ask, strictly below the seeder ask)
  const [, ba2] = (await publicClient.readContract({ address: market, abi: kuruOrderBookAbi, functionName: "bestBidAsk" })) as [bigint, bigint];
  const bestAskPu = align((ba2 * PP) / 10n ** 18n);
  console.log(`best ask now = ${Number(bestAskPu) / 1e8} (vault ${Number(vaultAsk) / 1e8}, seeder ${Number(seedAsk) / 1e8})`);
  const vaultIsTop = bestAskPu <= vaultAsk;
  console.log(`  vault at top of ask? ${vaultIsTop ? "YES ✅" : "NO ❌"} · seeder strictly outside? ${bestAskPu < seedAsk ? "YES ✅" : "NO ❌"}`);

  // 4) small taker buy -> should fill the vault
  const before = await fillsCount(vault.toLowerCase());
  await sendTx(taker, { to: testnet.quote, data: encodeFunctionData({ abi: mockErc20Abi, functionName: "approve", args: [market, 2n ** 255n] }), label: "taker.approve" });
  await sendTx(taker, { to: market, data: encodeFunctionData({ abi: kuruOrderBookAbi, functionName: "placeAndExecuteMarketBuy", args: [5n * vaultAsk, 0n, false, false] }), label: "taker.buy small" });

  // 5) confirm it appears in the hosted vault fills within seconds
  let after = before;
  for (let i = 0; i < 15; i++) {
    await sleep(2000);
    after = await fillsCount(vault.toLowerCase());
    if (after > before) break;
  }
  console.log(`\n/mandates/${vault}/fills : ${before} -> ${after}  ${after > before ? "VAULT FILL RECORDED ✅" : "no new vault fill ❌"}`);
  console.log(vaultIsTop && after > before ? "\nRESULT: PASS — seeder is outside; taker hit the vault." : "\nRESULT: CHECK — see flags above.");
}

main().catch((e) => { console.error("fatal", String(e?.shortMessage ?? e)); process.exit(1); });
