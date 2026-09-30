import { decodeErrorResult, toBytes, keccak256, formatUnits } from "viem";
import { covenantVaultAbi } from "./abis.js";

/// Base amounts (netSold/resting/requested/cap) are 18-dp; prices are 18-dp.
/// Trim to 2 dp for human messages; tolerate undefined (preflight passes no args).
const fmt18 = (x: unknown): string | null => {
  if (x === undefined || x === null) return null;
  try {
    const n = Number(formatUnits(BigInt(x as bigint), 18));
    return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  } catch {
    return String(x);
  }
};

/// Human-readable messages for each CovenantVault custom error. Reused by the frontend's
/// "Blocked by contract" card and the MM console preflight.
export const ERROR_MESSAGES: Record<string, (args: readonly unknown[]) => string> = {
  NotIssuer: () => "Only the issuer can do this.",
  NotMM: () => "Only the market maker can do this.",
  WrongState: (a) => `Not allowed in the current mandate state (${a[0]}).`,
  AlreadyInitialized: () => "This vault is already initialized.",
  TermsLocked: () => "Terms are locked — the mandate has been accepted.",
  TermsMismatch: () => "Terms changed since you reviewed them — refresh and re-accept.",
  // NOTE: the error's `restingAfter` (a[1]) ALREADY INCLUDES the `requested` (a[2]) amount,
  // so the on-chain check is `netSold + restingAfter > cap` — never add requested a second time.
  SellAllowanceExceeded: (a) => {
    const netSold = fmt18(a[0]);
    if (netSold === null) return "Blocked: this order would exceed the net-sell cap for the window.";
    const restingAfter = fmt18(a[1]);
    const requested = fmt18(a[2]);
    const cap = fmt18(a[3]);
    return (
      `Blocked: net-sold ${netSold} plus resting-after-this-order ${restingAfter} ` +
      `exceeds the ${cap} cap for this window (this order adds ${requested}).`
    );
  },
  OutsideBand: (a) => {
    const price = fmt18(a[0]);
    if (price === null) return "Blocked: the price is outside the allowed band around the mid.";
    return `Blocked: price ${price} is outside the ±band around mid ${fmt18(a[1])} (${a[2]} bps).`;
  },
  EmptyBook: () => "No reference price yet — the other side of the book is empty (quote two-sided).",
  TooManyOpenOrders: (a) => {
    if (a[1] === undefined) return "Blocked: too many resting orders on that side.";
    return `Blocked: ${a[1]} ${a[0] ? "bids" : "asks"} would exceed the max ${a[2]} per side.`;
  },
  OpenOrdersRemain: () => "Cancel all open orders before withdrawing.",
  InsufficientEscrow: () => "Not enough fee escrow.",
  LengthMismatch: () => "Price/size array lengths do not match.",
  NothingToClaim: () => "No fees available to claim.",
  NotActivatable: () => "Deposit inventory and fund at least one fee before activating.",
};

/// Decode a revert `data` blob into { name, args, message }. Returns null if it isn't a known
/// CovenantVault error (e.g. a bubbled Kuru error or a plain string revert).
export function decodeCovenantError(
  data: `0x${string}`,
): { name: string; args: readonly unknown[]; message: string } | null {
  try {
    const decoded = decodeErrorResult({ abi: covenantVaultAbi as any, data });
    const name = decoded.errorName;
    const args = (decoded.args ?? []) as readonly unknown[];
    const msg = ERROR_MESSAGES[name]?.(args) ?? `Reverted: ${name}`;
    return { name, args, message: msg };
  } catch {
    return null;
  }
}

/// bytes4 selector for a CovenantVault error name (for matching previewQuote() output).
export function errorSelector(name: string): `0x${string}` {
  const entry = (covenantVaultAbi as any).find(
    (e: any) => e.type === "error" && e.name === name,
  );
  if (!entry) throw new Error(`unknown error ${name}`);
  const sig = `${name}(${entry.inputs.map((i: any) => i.type).join(",")})`;
  // The 4-byte error selector is the first 4 bytes of keccak256 of the canonical signature.
  return keccak256(toBytes(sig)).slice(0, 10) as `0x${string}`;
}
