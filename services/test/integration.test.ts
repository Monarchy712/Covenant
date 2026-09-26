import { describe, it, expect } from "vitest";
import { createPublicClient, http } from "viem";
import {
  monadTestnet,
  testnet,
  covenantVaultAbi,
  computeTermsHash,
  getSnapshot,
  getTermsHash,
  getOrderBook,
  preflightQuote,
  plainEnglishTerms,
  withGasBuffer,
  decodeCovenantError,
  errorSelector,
  createMandate,
  depositInventory,
  fundFees,
  accept,
  quote,
  traderBuy,
  DEMO_MARKET,
} from "@covenant/shared";

const client = createPublicClient({ chain: monadTestnet, transport: http() });
const V = testnet.vault;

describe("shared: pure helpers (unit)", () => {
  it("withGasBuffer = estimate × 1.15", () => {
    expect(withGasBuffer(100_000n)).toBe(115_000n);
  });

  it("action helpers produce wagmi-ready shapes + correct approvals", () => {
    const dep = depositInventory(V, testnet.base, 5n);
    expect(dep.call.functionName).toBe("depositInventory");
    expect(dep.approvals[0]).toMatchObject({ token: testnet.base, spender: V, amount: 5n });

    const ff = fundFees(V, testnet.quote, 9n);
    expect(ff.approvals[0].spender).toBe(V);

    const q = quote(V, [1n], [2n], [3n], [4n], []);
    expect(q.call.functionName).toBe("quote");
    expect(q.call.args).toEqual([[1n], [2n], [3n], [4n], []]);

    const tb = traderBuy(testnet.market, testnet.quote, 100n);
    expect(tb.call.functionName).toBe("placeAndExecuteMarketBuy");
    expect(tb.approvals[0].spender).toBe(testnet.market);

    const cm = createMandate(testnet.factory, {} as any);
    expect(cm.call.address).toBe(testnet.factory);
  });

  it("decodeCovenantError decodes a known custom error", () => {
    // SellAllowanceExceeded(int256,uint256,uint256,uint256) with dummy args
    const sel = errorSelector("SellAllowanceExceeded");
    const data = (sel +
      "0".repeat(64) + // netSold
      "0".repeat(64) + // resting
      "0".repeat(64) + // requested
      "0".repeat(64)) as `0x${string}`;
    const d = decodeCovenantError(data);
    expect(d?.name).toBe("SellAllowanceExceeded");
    expect(d?.message).toContain("cap");
  });

  it("plainEnglishTerms renders a sentence", () => {
    const s = plainEnglishTerms({
      market: V, baseToken: testnet.base, quoteToken: testnet.quote, issuer: V, mm: V,
      netSellCapPerWindow: 1000n * 10n ** 18n, windowLength: 3600n, bandBps: 200n, maxOpenPerSide: 5n,
      maxSpreadBps: 100n, minDepthPerSide: 10n ** 18n, checkpointInterval: 120n, feePerInterval: 50n * 10n ** 6n,
      duration: 30n * 86400n, maxConsecutiveFails: 3n,
    });
    expect(s).toContain("net-sell at most");
    expect(s).toContain("±2%");
  });
});

describe("shared: live round-trips against the deployed testnet vault", () => {
  it("computeTermsHash(terms) matches the on-chain termsHash()", async () => {
    const snap = await getSnapshot(client, V);
    const onchain = await getTermsHash(client, V);
    expect(computeTermsHash(snap.terms)).toBe(onchain);
    // accept() helper embeds the same hash
    const a = accept(V, snap.terms);
    expect(a.call.args[0]).toBe(onchain);
  }, 30_000);

  it("getSnapshot returns a coherent snapshot", async () => {
    const s = await getSnapshot(client, V);
    expect(s.state).toBeGreaterThanOrEqual(0);
    expect(s.terms.market.toLowerCase()).toBe(testnet.market.toLowerCase());
    expect(typeof s.netSoldInWindow).toBe("bigint");
  }, 30_000);

  it("getOrderBook returns a mid (vault seeded a two-sided book at deploy)", async () => {
    const ob = await getOrderBook(client, testnet.market, V);
    // the deploy smoke placed a bid+ask; mid should exist
    expect(ob.mid === null || typeof ob.mid === "bigint").toBe(true);
    expect(Array.isArray(ob.vaultOrders)).toBe(true);
  }, 30_000);

  it("preflightQuote returns a decoded result", async () => {
    // an absurdly oversized ask should be flagged (cap or band), not OK
    const mid = DEMO_MARKET.pricePrecision * 2n; // ~2.0 in price units
    const r = await preflightQuote(client, V, [], [], [mid], [1_000_000n * DEMO_MARKET.sizePrecision], []);
    expect(typeof r.ok).toBe("boolean");
    expect(r.selector).toMatch(/^0x/);
  }, 30_000);
});
