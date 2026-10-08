"use client";

import { useCallback, useState } from "react";
import {
  BaseError,
  ContractFunctionRevertedError,
  erc20Abi,
  type Abi,
  type Address,
  type TransactionReceipt,
} from "viem";
import {
  decodeCovenantError,
  ERROR_MESSAGES,
  withGasBuffer,
  explorerTxUrl,
} from "@covenant/shared";
import { useWallet } from "@/lib/wallet/WalletProvider";

export type StepStatus = "pending" | "approving" | "signing" | "confirming" | "waiting" | "done" | "error";

export interface TxStep {
  key: string;
  label: string;
  status: StepStatus;
  detail?: string;
  txHash?: `0x${string}`;
  explorerUrl?: string;
  latencyMs?: number;
}

export interface CovenantAction {
  approvals: { token: Address; spender: Address; amount: bigint }[];
  call: { address: Address; abi: Abi; functionName: string; args: readonly unknown[]; value?: bigint };
}

/** A transaction step: resolves an action (optionally from prior-step context). */
export interface TxCallSpec {
  key: string;
  label: string;
  getAction: () => CovenantAction | Promise<CovenantAction>;
  sendAnyway?: boolean;
  onReceipt?: (receipt: TransactionReceipt) => void | Promise<void>;
}
/** A non-tx step that polls until a condition holds (e.g. MM acceptance). */
export interface TxWaitSpec {
  key: string;
  label: string;
  poll: () => Promise<boolean>;
  timeoutMs?: number;
}
export type TxStepSpec = TxCallSpec | TxWaitSpec;
const isWait = (s: TxStepSpec): s is TxWaitSpec => "poll" in s;

export interface TxError {
  name?: string;
  message: string;
  txHash?: `0x${string}`;
  explorerUrl?: string;
  latencyMs?: number;
}

export interface TxRunState {
  status: "idle" | "running" | "success" | "error";
  steps: TxStep[];
  error?: TxError;
}

const IDLE: TxRunState = { status: "idle", steps: [] };
// Monad charges the gas LIMIT; this is only used when a flaky RPC blocks estimation.
// Generous enough to cover createMandate (clone deploy + init).
const FALLBACK_GAS = 2_500_000n;

function decodeRevert(err: unknown): { name?: string; message: string } {
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError) as
      | ContractFunctionRevertedError
      | null;
    if (revert) {
      const raw = (revert as unknown as { raw?: `0x${string}` }).raw;
      if (raw) {
        const d = decodeCovenantError(raw);
        if (d) return { name: d.name, message: d.message };
      }
      const name = revert.data?.errorName;
      if (name) return { name, message: ERROR_MESSAGES[name]?.(revert.data?.args ?? []) ?? `Reverted: ${name}` };
      if (revert.reason) return { message: revert.reason };
    }
    return { message: err.shortMessage || err.message };
  }
  return { message: (err as { message?: string })?.message ?? "Transaction failed." };
}

/** A real on-chain revert (business logic) vs. a flaky-RPC/network failure. */
function isRealRevert(err: unknown): boolean {
  return err instanceof BaseError && !!err.walk((e) => e instanceof ContractFunctionRevertedError);
}

const isTransient = (err: unknown): boolean => {
  if (isRealRevert(err)) return false;
  const m = ((err as { message?: string })?.message ?? "").toLowerCase();
  return /timeout|network|fetch failed|econn|rate limit|429|missing or invalid|internal json-rpc|rpc request failed|http request|bad request|40\d|50\d|returned an error|failed to fetch|load failed/.test(
    m,
  );
};

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (isRealRevert(e) || !isTransient(e)) throw e;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw last;
}

export function useCovenantTx() {
  const { getWalletClient, publicClient, address, mode, isMonad, ensureMonad } = useWallet();
  const [state, setState] = useState<TxRunState>(IDLE);

  const reset = useCallback(() => setState(IDLE), []);
  const patch = useCallback((key: string, p: Partial<TxStep>) => {
    setState((s) => ({ ...s, steps: s.steps.map((st) => (st.key === key ? { ...st, ...p } : st)) }));
  }, []);

  const run = useCallback(
    async (specs: TxStepSpec[], opts?: { onSuccess?: () => void }): Promise<boolean> => {
      const wallet = getWalletClient();
      if (!wallet || !address) {
        setState({ status: "error", steps: [], error: { message: "Connect a wallet first." } });
        return false;
      }
      if (mode === "injected" && !isMonad) {
        try {
          await ensureMonad();
        } catch {
          setState({ status: "error", steps: [], error: { message: "Switch to Monad testnet to continue." } });
          return false;
        }
      }

      setState({ status: "running", steps: specs.map((s) => ({ key: s.key, label: s.label, status: "pending" })) });

      for (const spec of specs) {
        const key = spec.key;
        try {
          if (isWait(spec)) {
            patch(key, { status: "waiting" });
            const timeout = spec.timeoutMs ?? 40_000;
            const started = Date.now();
            let ok = false;
            while (Date.now() - started < timeout) {
              if (await spec.poll()) {
                ok = true;
                break;
              }
              await new Promise((r) => setTimeout(r, 2500));
            }
            if (!ok) {
              patch(key, { status: "error" });
              setState((s) => ({ ...s, status: "error", error: { message: `${spec.label}: timed out.` } }));
              return false;
            }
            patch(key, { status: "done" });
            continue;
          }

          const action = await spec.getAction();
          // Approvals folded into this step as a transient status.
          for (const ap of action.approvals) {
            let needs = true;
            try {
              const allowance = (await publicClient.readContract({
                address: ap.token,
                abi: erc20Abi,
                functionName: "allowance",
                args: [address, ap.spender],
              })) as bigint;
              needs = allowance < ap.amount;
            } catch {
              needs = true;
            }
            if (needs) {
              patch(key, { status: "approving", detail: "Approving spend" });
              // Signed sends are never retried (nonce safety); reads/estimates are.
              // Do NOT pass `account` here: the walletClient already holds the signer
              // (a local burner key, or the injected address). Passing the address as a
              // string would force eth_sendTransaction (node-side signing) and fail.
              const hash = await wallet.writeContract({
                address: ap.token,
                abi: erc20Abi,
                functionName: "approve",
                args: [ap.spender, ap.amount],
                account: wallet.account,
                chain: wallet.chain,
                gas: 80_000n,
              } as never);
              await publicClient.waitForTransactionReceipt({ hash });
            }
          }

          const { call } = action;
          const started = Date.now();
          let gas = FALLBACK_GAS;
          if (!spec.sendAnyway) {
            try {
              const est = await withRetry(() =>
                publicClient.estimateContractGas({ ...call, account: address } as never),
              );
              gas = withGasBuffer(est);
            } catch (err) {
              // A real revert blocks before sending; a flaky-RPC estimate does not —
              // fall back to a fixed limit and let the send/receipt decide.
              if (isRealRevert(err)) {
                const d = decodeRevert(err);
                patch(key, { status: "error", detail: undefined });
                setState((s) => ({ ...s, status: "error", error: { ...d } }));
                return false;
              }
              gas = FALLBACK_GAS;
            }
          }
          patch(key, { status: "signing", detail: undefined });
          const writeArgs = { ...call, account: wallet.account, chain: wallet.chain, gas } as never;
          let hash: `0x${string}`;
          try {
            hash = (await wallet.writeContract(writeArgs)) as `0x${string}`;
          } catch (err) {
            // A "Send anyway" quote is a known-reverting tx, so re-sending it on a transient RPC
            // error (e.g. Monad's "Missing or invalid parameters") is safe — it reverts either way,
            // and this is the demo's "Blocked by contract" moment, which must not die on an RPC blip.
            if (!(spec.sendAnyway && isTransient(err))) throw err;
            await new Promise((r) => setTimeout(r, 700));
            hash = (await wallet.writeContract(writeArgs)) as `0x${string}`;
          }
          patch(key, { status: "confirming", txHash: hash, explorerUrl: explorerTxUrl(hash) });
          const receipt = await publicClient.waitForTransactionReceipt({ hash });
          const latencyMs = Date.now() - started;

          if (receipt.status === "reverted") {
            let d: { name?: string; message: string } = { message: "Transaction reverted on-chain." };
            try {
              // Replay the call at the exact block it reverted to recover the decoded
              // reason + args (the state that produced the revert).
              await publicClient.simulateContract({
                ...call,
                account: address,
                blockNumber: receipt.blockNumber,
              } as never);
            } catch (err) {
              d = decodeRevert(err);
            }
            patch(key, { status: "error", txHash: hash, explorerUrl: explorerTxUrl(hash), latencyMs });
            setState((s) => ({
              ...s,
              status: "error",
              error: { ...d, txHash: hash, explorerUrl: explorerTxUrl(hash), latencyMs },
            }));
            return false;
          }

          if (spec.onReceipt) await spec.onReceipt(receipt);
          patch(key, { status: "done", txHash: hash, explorerUrl: explorerTxUrl(hash), latencyMs });
        } catch (err) {
          const d = decodeRevert(err);
          patch(key, { status: "error" });
          setState((s) => ({ ...s, status: "error", error: { ...d } }));
          return false;
        }
      }

      setState((s) => ({ ...s, status: "success" }));
      opts?.onSuccess?.();
      return true;
    },
    [getWalletClient, publicClient, address, mode, isMonad, ensureMonad, patch],
  );

  /** Convenience for single-action screens (pause, quote, claim, …). */
  const runAction = useCallback(
    (action: CovenantAction, label: string, opts?: { sendAnyway?: boolean; onSuccess?: () => void }) =>
      run([{ key: "action", label, getAction: () => action, sendAnyway: opts?.sendAnyway }], {
        onSuccess: opts?.onSuccess,
      }),
    [run],
  );

  return { state, run, runAction, reset };
}
