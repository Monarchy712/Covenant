import { encodeFunctionData } from "viem";
import { covenantFactoryAbi, covenantVaultAbi, MandateState } from "@covenant/shared";
import { publicClient, sendTx, type Wallet } from "./clients.js";
import { config } from "./config.js";
import { MmBot } from "./bots.js";

/// Safe-bounds for terms the house MM is willing to accept (demo-sized).
const BOUNDS = {
  bandBpsMin: 50n, // >= 0.5%
  bandBpsMax: 1000n, // <= 10%
  maxSpreadBpsMin: 20n,
  maxSpreadBpsMax: 1000n,
  feePerIntervalMax: 1000n * 10n ** 6n, // <= 1000 quote/interval
  durationMin: 60n, // >= 1 min
  durationMax: 60n * 24n * 3600n, // <= 60 days (covers the long-lived flagship)
  checkpointMin: 30n,
  netCapMax: 1_000_000n * 10n ** 18n, // <= 1M base
  maxOpenPerSideMax: 10n,
};

/// House MM — lets a judge finish the issuer flow alone. Watches the factory for mandates that
/// invited the house MM address, validates terms against safe bounds, auto-accepts with
/// accept(termsHash), and then quotes honestly through each ACTIVE vault (reusing MmBot).
export class HouseMm {
  private bots = new Map<string, MmBot>();
  private declined = new Set<string>();

  constructor(
    private wallet: Wallet,
    private factory: `0x${string}`,
    // Returns true when the flagship should be quoted. Default keeps the flagship IDLE so the
    // always-on house MM only serves user-created demo mandates (cost control).
    private flagshipEnabled: () => boolean = () => false,
  ) {}

  get address() {
    return this.wallet.account.address;
  }

  private validate(t: any): string | null {
    if (BigInt(t.bandBps) < BOUNDS.bandBpsMin || BigInt(t.bandBps) > BOUNDS.bandBpsMax) return "bandBps out of range";
    if (BigInt(t.maxSpreadBps) < BOUNDS.maxSpreadBpsMin || BigInt(t.maxSpreadBps) > BOUNDS.maxSpreadBpsMax) return "maxSpreadBps out of range";
    if (BigInt(t.maxSpreadBps) >= BigInt(t.bandBps) * 2n) return "maxSpread too wide vs band";
    if (BigInt(t.feePerInterval) === 0n || BigInt(t.feePerInterval) > BOUNDS.feePerIntervalMax) return "fee out of range";
    if (BigInt(t.duration) < BOUNDS.durationMin || BigInt(t.duration) > BOUNDS.durationMax) return "duration out of range";
    if (BigInt(t.checkpointInterval) < BOUNDS.checkpointMin) return "checkpoint too short";
    if (BigInt(t.netSellCapPerWindow) === 0n || BigInt(t.netSellCapPerWindow) > BOUNDS.netCapMax) return "netCap out of range";
    if (BigInt(t.maxOpenPerSide) < 1n || BigInt(t.maxOpenPerSide) > BOUNDS.maxOpenPerSideMax) return "maxOpenPerSide out of range";
    return null;
  }

  async tick() {
    const vaults = (await publicClient.readContract({
      address: this.factory,
      abi: covenantFactoryAbi,
      functionName: "mandatesForMM",
      args: [this.address],
    })) as `0x${string}`[];

    const flagshipOn = this.flagshipEnabled();
    for (const vault of vaults) {
      if (this.declined.has(vault.toLowerCase())) continue;
      // Leave the flagship ACTIVE but idle unless the switch is on (unobserved intervals are
      // neutral on-chain, so this never breaches the mandate).
      if (vault.toLowerCase() === config.flagshipVault && !flagshipOn) continue;
      let snap: any;
      try {
        snap = await publicClient.readContract({ address: vault, abi: covenantVaultAbi, functionName: "snapshot" });
      } catch {
        continue;
      }
      const state = Number(snap.state);

      if (state === MandateState.CREATED) {
        const reason = this.validate(snap.terms);
        if (reason) {
          this.declined.add(vault.toLowerCase());
          console.log(`[houseMM] DECLINE ${vault}: ${reason}`);
          continue;
        }
        const th = (await publicClient.readContract({ address: vault, abi: covenantVaultAbi, functionName: "termsHash" })) as `0x${string}`;
        try {
          await sendTx(this.wallet, {
            to: vault,
            data: encodeFunctionData({ abi: covenantVaultAbi, functionName: "accept", args: [th] }),
            label: `houseMM.accept ${vault.slice(0, 10)}`,
          });
          console.log(`[houseMM] ACCEPTED ${vault}`);
        } catch (e: any) {
          console.log(`[houseMM] accept reverted ${vault}: ${String(e?.shortMessage ?? e).slice(0, 100)}`);
        }
      } else if (state === MandateState.ACTIVE) {
        let bot = this.bots.get(vault.toLowerCase());
        if (!bot) {
          bot = new MmBot(this.wallet, vault, snap.terms.market as `0x${string}`, "honest", 20n, config.mmRequoteMs);
          this.bots.set(vault.toLowerCase(), bot);
          console.log(`[houseMM] quoting ${vault}`);
        }
        await bot.tick().catch((e) => console.log(`[houseMM] quote ${vault}: ${String(e?.shortMessage ?? e).slice(0, 100)}`));
      }
    }
  }
}
