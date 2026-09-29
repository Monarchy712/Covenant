import "../src/config.js"; // loads .env
import { covenantVaultAbi, testnet, stateName } from "@covenant/shared";
import { publicClient } from "../src/clients.js";

/// Quick on-chain read of the flagship (or any vault via argv[2]) — state, fees, book, net-sell.
const V = (process.argv[2] ?? testnet.vault) as `0x${string}`;

(async () => {
  const s: any = await publicClient.readContract({ address: V, abi: covenantVaultAbi, functionName: "snapshot" });
  console.log(`vault ${V}`);
  console.log(`  state           ${Number(s.state)} (${stateName(Number(s.state))})`);
  console.log(`  accruedFees     ${Number(s.accruedFees) / 1e6} USDC`);
  console.log(`  consecutiveFails ${Number(s.consecutiveFails)}`);
  console.log(`  openOrders      ${s.openOrders.length}`);
  console.log(`  netSoldInWindow ${(Number(s.netSoldInWindow) / 1e18).toFixed(3)} base`);
  console.log(`  remainingAllow  ${(Number(s.remainingAllowance) / 1e18).toFixed(3)} base`);
  console.log(`  duration        ${Number(s.terms.duration) / 86400} days · checkpoint ${Number(s.terms.checkpointInterval)}s · window ${Number(s.terms.windowLength)}s`);
  const now = Math.floor(Date.now() / 1000);
  console.log(`  feePerInterval  ${Number(s.terms.feePerInterval) / 1e6} USDC`);
  console.log(`  activatedAt     ${Number(s.activatedAt)}  (elapsed ${((now - Number(s.activatedAt)) / 60).toFixed(1)} min)`);
  console.log(`  intervals paid ~ ${Number(s.accruedFees) / Number(s.terms.feePerInterval)}`);
})().catch((e) => { console.error(String(e?.shortMessage ?? e)); process.exit(1); });
