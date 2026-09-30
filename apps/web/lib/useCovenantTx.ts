"use client";

import { useCallback, useState } from "react";
import {
  BaseError,
  ContractFunctionRevertedError,
  erc20Abi,
  type Abi,
  type Address,
} from "viem";
import { decodeCovenantError, ERROR_MESSAGES, withGasBuffer } from "@covenant/shared";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { explorerTxUrl } from "@covenant/shared";

export type StepStatus = "pending" | "approving" | "signing" | "confirming" | "done" | "error";

export interface TxStep {
  key: string;
  label: string;
  status: StepStatus;
  txHash?: `0x${string}`;
  explorerUrl?: string;
  latencyMs?: number;
}

export interface CovenantAction {
  approvals: { token: Address; spender: Address; amount: bigint }[];
  call: { address: Address; abi: Abi; functionName: string; args: readonly unknown[]; value?: bigint };
}

export interface TxStepSpec {
  key: string;
  label: string;
  action: CovenantAction;
  /** When true, send even if it would revert (the MM-console "Send anyway"). */
  sendAnyway?: boolean;
}

export interface TxError {
  name?: string;
  message: string;
  /** The mined-but-reverted tx, if any (send-anyway path). */
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
const FALLBACK_GAS = 900_000n; // send-anyway (can't estimate a reverting call)

function decodeRevert(err: unknown): { name?: string; message: string; raw?: `0x${string}` } {
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError) as
      | ContractFunctionRevertedError
      | null;
    if (revert) {
      const raw = (revert as unknown as { raw?: `0x${string}` }).raw;
      if (raw) {
        const d = decodeCovenantError(raw);
        if (d) return { name: d.name, message: d.message, raw };
      }
      const name = revert.data?.errorName;
      if (name) {
        const msg = ERROR_MESSAGES[name]?.(revert.data?.args ?? []) ?? `Reverted: ${name}`;
        return { name, message: msg };
      }
      if (revert.reason) return { message: revert.reason };
    }
    return { message: err.shortMessage || err.message };
  }
  return { message: (err as { message?: string })?.message ?? "Transaction failed." };
}

const isTransient = (err: unknown): boolean => {
  const m = ((err as { message?: string })?.message ?? "").toLowerCase();
  return /timeout|network|fetch failed|econn|rate limit|429|missing or invalid|internal json-rpc/.test(m);
};

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (isTransient(e)) return await fn();
    throw e;
  }
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

      // Build the visible step list: an approval step for each insufficient allowance,
      // then the call step.
      const steps: TxStep[] = [];
      type Plan = { step: TxStep; kind: "approve"; token: Address; spender: Address; amount: bigint } | { step: TxStep; kind: "call"; spec: TxStepSpec };
      const plan: Plan[] = [];
      for (const spec of specs) {
        for (const ap of spec.action.approvals) {
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
            needs = true; // if we can't read, attempt the approval
          }
          if (needs) {
            let sym = "token";
            try {
              sym = (await publicClient.readContract({ address: ap.token, abi: erc20Abi, functionName: "symbol" })) as string;
            } catch {
              /* keep default */
            }
            const st: TxStep = { key: `${spec.key}:approve:${ap.token}`, label: `Approve ${sym}`, status: "pending" };
            steps.push(st);
            plan.push({ step: st, kind: "approve", token: ap.token, spender: ap.spender, amount: ap.amount });
          }
        }
        const st: TxStep = { key: spec.key, label: spec.label, status: "pending" };
        steps.push(st);
        plan.push({ step: st, kind: "call", spec });
      }

      setState({ status: "running", steps });

      for (const item of plan) {
        const key = item.step.key;
        try {
          if (item.kind === "approve") {
            patch(key, { status: "signing" });
            const hash = await withRetry(() =>
              wallet.writeContract({
                address: item.token,
                abi: erc20Abi,
                functionName: "approve",
                args: [item.spender, item.amount],
                account: address,
                chain: wallet.chain,
                gas: 80_000n,
              } as never),
            );
            patch(key, { status: "confirming", txHash: hash, explorerUrl: explorerTxUrl(hash) });
            await publicClient.waitForTransactionReceipt({ hash });
            patch(key, { status: "done" });
          } else {
            const { spec } = item;
            const { call } = spec.action;
            const started = Date.now();
            let gas = FALLBACK_GAS;
            if (!spec.sendAnyway) {
              // Preflight via estimate; a revert here blocks before sending.
              try {
                const est = await withRetry(() =>
                  publicClient.estimateContractGas({ ...call, account: address } as never),
                );
                gas = withGasBuffer(est);
              } catch (err) {
                const d = decodeRevert(err);
                patch(key, { status: "error" });
                setState((s) => ({ ...s, status: "error", error: { ...d } }));
                return false;
              }
            }
            patch(key, { status: "signing" });
            const hash = await withRetry(() =>
              wallet.writeContract({ ...call, account: address, chain: wallet.chain, gas } as never),
            );
            patch(key, { status: "confirming", txHash: hash, explorerUrl: explorerTxUrl(hash) });
            const receipt = await publicClient.waitForTransactionReceipt({ hash });
            const latencyMs = Date.now() - started;
            if (receipt.status === "reverted") {
              // Reproduce the revert to decode it (the "Blocked by contract" moment).
              let d: { name?: string; message: string } = { message: "Transaction reverted on-chain." };
              try {
                await publicClient.simulateContract({ ...call, account: address } as never);
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
            patch(key, { status: "done", txHash: hash, explorerUrl: explorerTxUrl(hash), latencyMs });
          }
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

  return { state, run, reset };
}
