import { describe, it, expect } from "vitest";
import { encodeErrorResult, parseUnits } from "viem";
import { covenantVaultAbi, decodeCovenantError, ERROR_MESSAGES } from "@covenant/shared";

/**
 * Regression test for the SellAllowanceExceeded decoded message.
 * The contract error is SellAllowanceExceeded(int256 netSold, uint256 restingAfter,
 * uint256 requested, uint256 cap), and the on-chain check is `netSold + restingAfter > cap`
 * where restingAfter ALREADY INCLUDES requested. The human message must therefore never add
 * `requested` a second time (the old message double-counted).
 */
describe("decodeCovenantError — SellAllowanceExceeded", () => {
  const data = encodeErrorResult({
    abi: covenantVaultAbi,
    errorName: "SellAllowanceExceeded",
    // 39.96 net sold, 5060 resting-after (incl. the 5000 requested), cap 1000
    args: [parseUnits("39.96", 18), parseUnits("5060", 18), parseUnits("5000", 18), parseUnits("1000", 18)],
  });

  it("decodes to the correct, non-double-counting decomposition", () => {
    const decoded = decodeCovenantError(data);
    expect(decoded).not.toBeNull();
    expect(decoded!.name).toBe("SellAllowanceExceeded");
    const msg = decoded!.message;
    // shows net-sold, resting-after, cap, and the requested amount — once each
    expect(msg).toContain("39.96");
    expect(msg).toContain("5,060");
    expect(msg).toContain("1,000");
    expect(msg).toContain("5,000");
    // must NOT double-count: the wrong sum 39.96 + 5060 + 5000 = 10,099.96 must not appear
    expect(msg).not.toContain("10,099");
    expect(msg.toLowerCase()).toContain("resting-after-this-order");
  });

  it("returns a generic message when called with no args (preflight path)", () => {
    const msg = ERROR_MESSAGES.SellAllowanceExceeded([]);
    expect(msg.toLowerCase()).toContain("net-sell cap");
    expect(msg).not.toContain("undefined");
  });
});
