import { config } from "../src/config.js"; // loads .env (side effect)
import { encodeFunctionData, type Address } from "viem";
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DOCS = resolve(dirname(fileURLToPath(import.meta.url)), "../../docs/E2E_RUN.md");
const MARGIN_ABI = [
  { type: "function", name: "getBalance", stateMutability: "view", inputs: [{ name: "u", type: "address" }, { name: "t", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
] as const;
import {
  KURU,
  testnet,
  covenantFactoryAbi,
  covenantVaultAbi,
  mockErc20Abi,
  kuruOrderBookAbi,
  decodeCovenantError,
  type Terms,
} from "@covenant/shared";
import { makeWallet, publicClient, sendTx } from "../src/clients.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rows: string[] = [];
const rec = (label: string, hash: string) => {
  rows.push(`| ${label} | \`${hash}\` |`);
  console.log(`[e2e] ${label}: ${hash}`);
};

// SHORT mandate so the full lifecycle (incl. duration elapse) runs in ~5 min.
const CHECKPOINT = 45n;
const WINDOW = 90n;
const DURATION = 200n;
const SP = 10_000_000_000n; // sizePrecision 1e10
const PP = 100_000_000n; // pricePrecision 1e8
// price top-of-book (the earlier smoke vault still rests near 1.995/2.005 on this market)
const BID_PX = 199_600_000n; // 1.996
const ASK_PX = 200_400_000n; // 2.004  -> spread 40 bps <= 100
const QTY = 100n * SP;

const V = covenantVaultAbi;
const E = mockErc20Abi;

async function tx(w: ReturnType<typeof makeWallet>, to: Address, abi: any, fn: string, args: any[], label: string) {
  const data = encodeFunctionData({ abi, functionName: fn, args });
  const { hash } = await sendTx(w, { to, data, label });
  rec(label, hash);
  return hash;
}
const read = (to: Address, fn: string, args: any[] = [], abi: any = V) =>
  publicClient.readContract({ address: to, abi, functionName: fn, args });

async function main() {
  const issuer = makeWallet(process.env.PRIVATE_KEY_DEPLOYER as `0x${string}`);
  const mm = makeWallet(process.env.PRIVATE_KEY_MM as `0x${string}`);
  const taker = makeWallet(process.env.PRIVATE_KEY_TAKER as `0x${string}`);
  const factory = testnet.factory;
  const market = testnet.market;
  const base = testnet.base;
  const quote = testnet.quote;
  console.log(`issuer=${issuer.account.address} mm=${mm.account.address} taker=${taker.account.address}`);
  console.log(`reusing factory=${factory} market=${market}`);

  // 1) fresh mandate (short terms) through the existing factory
  const terms: Terms = {
    market, baseToken: base, quoteToken: quote,
    issuer: issuer.account.address as Address, mm: mm.account.address as Address,
    netSellCapPerWindow: 1000n * 10n ** 18n, windowLength: WINDOW, bandBps: 200n, maxOpenPerSide: 5n,
    maxSpreadBps: 100n, minDepthPerSide: 10n ** 18n, checkpointInterval: CHECKPOINT,
    feePerInterval: 50n * 10n ** 6n, duration: DURATION, maxConsecutiveFails: 3n,
  };
  await tx(issuer, factory, covenantFactoryAbi, "createMandate", [terms], "createMandate");
  const list = (await read(factory, "mandatesOf", [issuer.account.address], covenantFactoryAbi)) as Address[];
  const vault = list.at(-1)!;
  console.log(`vault=${vault}`);

  // 2) accept, pinning the on-chain terms hash
  const th = (await read(vault, "termsHash")) as `0x${string}`;
  await tx(mm, vault, V, "accept", [th], "accept(termsHash)");

  // 3) mint + approve + deposit + fund + activate
  await tx(issuer, base, E, "mint", [issuer.account.address, 10_000n * 10n ** 18n], "mint base->issuer");
  await tx(issuer, quote, E, "mint", [issuer.account.address, 10_000n * 10n ** 6n], "mint quote->issuer");
  await tx(issuer, quote, E, "mint", [taker.account.address, 100_000n * 10n ** 6n], "mint quote->taker");
  await tx(issuer, base, E, "approve", [vault, 5_000n * 10n ** 18n], "approve base");
  await tx(issuer, quote, E, "approve", [vault, 2_000n * 10n ** 6n], "approve quote");
  await tx(issuer, vault, V, "depositInventory", [base, 1_000n * 10n ** 18n], "depositInventory base");
  await tx(issuer, vault, V, "depositInventory", [quote, 1_000n * 10n ** 6n], "depositInventory quote");
  await tx(issuer, vault, V, "fundFees", [500n * 10n ** 6n], "fundFees");
  await tx(issuer, vault, V, "activate", [], "activate");

  // 4) honest quote + taker fill
  await tx(mm, vault, V, "quote", [[BID_PX], [QTY], [ASK_PX], [QTY], []], "quote honest");
  await tx(taker, quote, E, "approve", [market, 2n ** 255n], "taker approve quote");
  await tx(taker, market, kuruOrderBookAbi, "placeAndExecuteMarketBuy", [40n * ASK_PX, 0n, false, false], "taker buy 40");

  // 5) >=1 PAID interval: checkpoint, wait a full interval, checkpoint (finalizes interval 0)
  await tx(taker, vault, V, "checkpoint", [], "checkpoint #1 (pass obs)");
  console.log(`[e2e] wait ${CHECKPOINT}s for interval 0 to elapse…`);
  await sleep(Number(CHECKPOINT + 6n) * 1000);
  await tx(taker, vault, V, "checkpoint", [], "checkpoint #2 (finalize interval 0)");
  const accruedPaid = (await read(vault, "accruedFees")) as bigint;
  console.log(`[e2e] accruedFees after paid interval = ${accruedPaid}`);

  // 6) pause / unpause
  await tx(issuer, vault, V, "pause", [], "pause");
  await tx(issuer, vault, V, "unpause", [], "unpause");

  // 7) malicious oversized sell -> blocked; decode SellAllowanceExceeded from revert data
  let decoded = "";
  try {
    await publicClient.call({
      account: mm.account,
      to: vault,
      data: encodeFunctionData({ abi: V, functionName: "quote", args: [[], [], [ASK_PX], [5_000n * SP], []] }),
    });
    console.log("[e2e] WARN: oversized sell did not revert");
  } catch (e: any) {
    const data = e?.cause?.data ?? e?.data ?? e?.cause?.cause?.data;
    const d = typeof data === "string" && data.startsWith("0x") ? decodeCovenantError(data as `0x${string}`) : null;
    decoded = d ? `${d.name} — ${d.message}` : "revert (undecoded)";
    console.log(`[e2e] oversized sell BLOCKED -> ${decoded}`);
  }

  // 8) malicious widen-spread -> failing interval (bid 1.96 / ask 2.04 => ~4% spread > 1% max)
  await tx(mm, vault, V, "quote", [[196_000_000n], [QTY], [204_000_000n], [QTY], []], "quote WIDE (malicious)");
  await tx(taker, vault, V, "checkpoint", [], "checkpoint wide (fail obs)");

  // 9) wait for duration to elapse -> ENDED (lazy)
  console.log(`[e2e] wait ~${DURATION}s for duration to elapse…`);
  await sleep(Number(DURATION) * 1000);
  const stEnded = (await read(vault, "currentState")) as number;
  console.log(`[e2e] state after duration = ${stEnded} (4=ENDED)`);

  // 10) settle: cancelAllAfterEnd -> finalize -> claim -> withdraw -> SETTLED
  await tx(taker, vault, V, "cancelAllAfterEnd", [], "cancelAllAfterEnd");
  await tx(taker, vault, V, "finalize", [], "finalize");
  const accrued = (await read(vault, "accruedFees")) as bigint;
  const mmBefore = (await read(quote, "balanceOf", [mm.account.address], E)) as bigint;
  if (accrued > 0n) await tx(mm, vault, V, "claimFees", [], "claimFees");
  const mmAfter = (await read(quote, "balanceOf", [mm.account.address], E)) as bigint;

  const issBaseBefore = (await read(base, "balanceOf", [issuer.account.address], E)) as bigint;
  const issQuoteBefore = (await read(quote, "balanceOf", [issuer.account.address], E)) as bigint;
  await tx(issuer, vault, V, "withdraw", [], "withdraw");
  const issBaseAfter = (await read(base, "balanceOf", [issuer.account.address], E)) as bigint;
  const issQuoteAfter = (await read(quote, "balanceOf", [issuer.account.address], E)) as bigint;

  const vaultBaseMargin = (await read(KURU.marginAccount as Address, "getBalance", [vault, base], MARGIN_ABI).catch(() => -1n)) as bigint;
  const stFinal = (await read(vault, "currentState")) as number;

  const asserts = [
    `state == SETTLED(5): ${stFinal === 5} (got ${stFinal})`,
    `MM gained exactly accrued fees: ${mmAfter - mmBefore === accrued} (gain ${mmAfter - mmBefore}, accrued ${accrued})`,
    `issuer base increased: ${issBaseAfter > issBaseBefore} (+${issBaseAfter - issBaseBefore})`,
    `issuer quote increased (proceeds + unused escrow): ${issQuoteAfter > issQuoteBefore} (+${issQuoteAfter - issQuoteBefore})`,
    `vault base margin drained to ~0: ${vaultBaseMargin === 0n} (got ${vaultBaseMargin})`,
  ];
  console.log("[e2e] ASSERTIONS:\n" + asserts.map((a) => "  - " + a).join("\n"));

  const md = `# E2E_RUN.md — live settlement proof (Monad testnet, chain 10143)

\`pnpm e2e:full\` — full lifecycle THROUGH SETTLEMENT on real testnet. Short demo mandate:
checkpoint ${CHECKPOINT}s, window ${WINDOW}s, duration ${DURATION}s. Reused the deployed
factory + market + mock tokens; created a fresh mandate.

- factory: \`${factory}\`
- vault (this run): \`${vault}\`
- market: \`${market}\`  base \`${base}\`  quote \`${quote}\`
- issuer \`${issuer.account.address}\`  mm \`${mm.account.address}\`  taker \`${taker.account.address}\`

## Transactions (in order)
| Step | Tx |
|---|---|
${rows.join("\n")}

## Blocked oversized sell (decoded from revert data)
${decoded || "(not captured)"}

## Final assertions (exact balances)
${asserts.map((a) => "- " + a).join("\n")}

Fee paid to MM this run: **${accrued}** quote units. accruedFees after paid interval: ${accruedPaid}.
`;
  writeFileSync(DOCS, md);
  console.log("[e2e] wrote docs/E2E_RUN.md");
}

main().catch((e) => {
  console.error("[e2e] FATAL", e?.shortMessage ?? e?.message ?? e);
  process.exit(1);
});
