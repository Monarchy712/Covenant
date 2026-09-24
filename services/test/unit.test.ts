import { describe, it, expect, vi } from "vitest";
import { encodeErrorResult } from "viem";
import { covenantVaultAbi, decodeCovenantError, errorSelector } from "@covenant/shared";
import { planChunks } from "../src/indexer.js";
import { NonceManager } from "../src/nonce.js";

describe("planChunks", () => {
  it("splits into <=size inclusive windows", () => {
    expect(planChunks(0, 9, 5)).toEqual([
      [0, 4],
      [5, 9],
    ]);
    expect(planChunks(100, 289, 90)).toEqual([
      [100, 189],
      [190, 279],
      [280, 289],
    ]);
  });
  it("never exceeds the RPC 100-block cap with size 90", () => {
    for (const [s, e] of planChunks(1000, 5000, 90)) expect(e - s + 1).toBeLessThanOrEqual(100);
  });
  it("handles a single-block range", () => {
    expect(planChunks(7, 7, 90)).toEqual([[7, 7]]);
  });
});

describe("error decoder", () => {
  it("decodes SellAllowanceExceeded into a human message", () => {
    const data = encodeErrorResult({
      abi: covenantVaultAbi as any,
      errorName: "SellAllowanceExceeded",
      args: [100n, 50n, 40n, 150n],
    });
    const dec = decodeCovenantError(data);
    expect(dec?.name).toBe("SellAllowanceExceeded");
    expect(dec?.message).toContain("exceeds the cap");
  });
  it("decodes OutsideBand", () => {
    const data = encodeErrorResult({
      abi: covenantVaultAbi as any,
      errorName: "OutsideBand",
      args: [123n, 100n, 200n],
    });
    expect(decodeCovenantError(data)?.name).toBe("OutsideBand");
  });
  it("returns null for unknown data", () => {
    expect(decodeCovenantError("0xdeadbeef")).toBeNull();
  });
  it("errorSelector matches the encoded revert selector", () => {
    const sel = errorSelector("EmptyBook");
    const data = encodeErrorResult({ abi: covenantVaultAbi as any, errorName: "EmptyBook" });
    expect(data.slice(0, 10)).toBe(sel);
  });
});

describe("NonceManager", () => {
  it("assigns sequential nonces and serializes sends", async () => {
    const pub = { getTransactionCount: vi.fn().mockResolvedValue(7) } as any;
    const nm = new NonceManager(pub, {} as any, { address: "0x0000000000000000000000000000000000000001" } as any);
    const seen: number[] = [];
    const send = (n: number) =>
      new Promise<`0x${string}`>((r) => setTimeout(() => (seen.push(n), r(`0x${n.toString(16)}` as any)), 5));
    await Promise.all([nm.submit(send), nm.submit(send), nm.submit(send)]);
    expect(seen).toEqual([7, 8, 9]); // sequential, serialized
    expect(pub.getTransactionCount).toHaveBeenCalledTimes(1); // fetched once, then tracked locally
  });

  it("resyncs the nonce from chain after a failed send", async () => {
    const pub = { getTransactionCount: vi.fn().mockResolvedValueOnce(3).mockResolvedValueOnce(3) } as any;
    const nm = new NonceManager(pub, {} as any, { address: "0x1" } as any);
    await expect(nm.submit(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    // next send re-fetches (2nd call) and uses the resynced nonce
    let used = -1;
    await nm.submit(async (n) => ((used = n), "0xaa"));
    expect(used).toBe(3);
    expect(pub.getTransactionCount).toHaveBeenCalledTimes(2);
  });
});
