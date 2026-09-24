import { encodeFunctionData } from "viem";
import { covenantVaultAbi, MandateState } from "@covenant/shared";
import { publicClient, sendTx, type Wallet } from "./clients.js";
import { config } from "./config.js";
import type { DB } from "./db.js";

interface VaultSched {
  intervalIdx: number;
  samplesThisInterval: number;
  nextSampleAtMs: number;
  lastPokedWindow: number;
  finalizedAfterEnd: boolean;
  cancelledAfterEnd: boolean;
}

const MIN_SAMPLES_PER_INTERVAL = 2;

/// Restart-safe keeper. Every tick it re-derives what to do from each vault's on-chain snapshot,
/// so it never needs a persisted schedule. In-memory per-vault state only avoids redundant sends
/// within a run; on restart the worst case is one extra (idempotent) checkpoint/poke.
export class Keeper {
  private sched = new Map<string, VaultSched>();

  constructor(
    private db: DB,
    private wallet: Wallet,
  ) {}

  private call(vault: `0x${string}`, fn: string, label: string) {
    const data = encodeFunctionData({ abi: covenantVaultAbi, functionName: fn as any, args: [] });
    return sendTx(this.wallet, { to: vault, data, label: `keeper.${fn}(${vault.slice(0, 10)})` });
  }

  async tickOnce() {
    // low-balance alert
    const bal = await publicClient.getBalance({ address: this.wallet.account.address });
    if (bal < config.keeperMinBalanceWei) {
      console.error(`[keeper] LOW BALANCE ${bal} < ${config.keeperMinBalanceWei} (${this.wallet.account.address})`);
    }

    const vaults = this.db.prepare("SELECT vault FROM mandates").all() as { vault: `0x${string}` }[];
    for (const { vault } of vaults) {
      try {
        await this.handle(vault);
      } catch (e: any) {
        console.error(`[keeper] ${vault} error: ${String(e?.shortMessage ?? e?.message ?? e)}`);
      }
    }
  }

  private async handle(vault: `0x${string}`) {
    const snap: any = await publicClient.readContract({
      address: vault,
      abi: covenantVaultAbi,
      functionName: "snapshot",
    });
    const state = Number(snap.state);
    const s = this.getSched(vault);

    if (state === MandateState.ENDED) {
      const open = (snap.openOrders as any[]).length;
      if (open > 0 && !s.cancelledAfterEnd) {
        await this.call(vault, "cancelAllAfterEnd", "cancelAllAfterEnd");
        s.cancelledAfterEnd = true;
      } else if (open === 0 && !s.finalizedAfterEnd) {
        await this.call(vault, "finalize", "finalize");
        s.finalizedAfterEnd = true;
      }
      return;
    }
    if (state !== MandateState.ACTIVE && state !== MandateState.PAUSED) return;

    const activatedAt = Number(snap.activatedAt);
    const windowLen = Number(snap.terms.windowLength);
    const cpInterval = Number(snap.terms.checkpointInterval);
    const now = Math.floor(Date.now() / 1000);
    const elapsed = Math.max(0, now - activatedAt);

    // 1) poke promptly at each window boundary (minimizes governor drift). ACTIVE only.
    if (state === MandateState.ACTIVE && windowLen > 0) {
      const win = Math.floor(elapsed / windowLen);
      if (win > s.lastPokedWindow) {
        await this.call(vault, "poke", "poke");
        s.lastPokedWindow = win;
      }
    }

    // 2) random-sample checkpoints, >= MIN_SAMPLES per interval, unpredictable. ACTIVE only
    //    (checkpoint reverts while PAUSED by design).
    if (state === MandateState.ACTIVE && cpInterval > 0) {
      const interval = Math.floor(elapsed / cpInterval);
      if (interval !== s.intervalIdx) {
        s.intervalIdx = interval;
        s.samplesThisInterval = 0;
        s.nextSampleAtMs = 0; // sample ASAP at interval start
      }
      const intervalStart = activatedAt + interval * cpInterval;
      const intervalEnd = intervalStart + cpInterval;
      if (Date.now() >= s.nextSampleAtMs && s.samplesThisInterval < MIN_SAMPLES_PER_INTERVAL && now < intervalEnd) {
        await this.call(vault, "checkpoint", "checkpoint");
        s.samplesThisInterval += 1;
        // schedule the next random sample somewhere in the remaining interval
        const remainingMs = Math.max(1000, (intervalEnd - now) * 1000);
        s.nextSampleAtMs = Date.now() + Math.floor(Math.random() * remainingMs);
      }
    }
  }

  private getSched(vault: string): VaultSched {
    let s = this.sched.get(vault.toLowerCase());
    if (!s) {
      s = {
        intervalIdx: -1,
        samplesThisInterval: 0,
        nextSampleAtMs: 0,
        lastPokedWindow: -1,
        finalizedAfterEnd: false,
        cancelledAfterEnd: false,
      };
      this.sched.set(vault.toLowerCase(), s);
    }
    return s;
  }
}
