import { decodeErrorResult, toFunctionSelector } from "viem";
import { covenantVaultAbi } from "./abis.js";

/// Human-readable messages for each CovenantVault custom error. Reused by the frontend's
/// "Blocked by contract" card and the MM console preflight.
export const ERROR_MESSAGES: Record<string, (args: readonly unknown[]) => string> = {
  NotIssuer: () => "Only the issuer can do this.",
  NotMM: () => "Only the market maker can do this.",
  WrongState: (a) => `Not allowed in the current mandate state (${a[0]}).`,
  AlreadyInitialized: () => "This vault is already initialized.",
  TermsLocked: () => "Terms are locked — the mandate has been accepted.",
  TermsMismatch: () => "Terms changed since you reviewed them — refresh and re-accept.",
  SellAllowanceExceeded: (a) =>
    `Blocked: net-sell ${a[0]} + resting ${a[1]} + requested ${a[2]} exceeds the cap ${a[3]} for this window.`,
  OutsideBand: (a) => `Blocked: price ${a[0]} is outside the ±band around mid ${a[1]} (${a[2]} bps).`,
  EmptyBook: () => "No reference price yet — the other side of the book is empty (quote two-sided).",
  TooManyOpenOrders: (a) =>
    `Blocked: ${a[1]} ${a[0] ? "bids" : "asks"} would exceed the max ${a[2]} per side.`,
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
  return toFunctionSelector(`error ${sig}` as any).slice(0, 10) as `0x${string}`;
}
