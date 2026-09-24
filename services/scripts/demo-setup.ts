import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/// pnpm demo:setup — deploys a fresh demo market + mandate (short windows/intervals) via the
/// Foundry DeployDemo script, then refreshes the shared deployments copy the frontend imports.
/// Prints every address; then start the MM bot with `RUN_MM_BOT=true MM_BOT_MODE=honest pnpm dev:services`.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../.."); // services/scripts -> repo root

function main() {
  const rpc = process.env.RPC_URL_TESTNET ?? "https://testnet-rpc.monad.xyz";
  console.log("[demo:setup] deploying demo mandate (10-min window, 2-min checkpoint)…");
  execSync(
    `forge script script/DeployDemo.s.sol --rpc-url ${rpc} --broadcast --gas-estimate-multiplier 115`,
    { cwd: repoRoot, stdio: "inherit", env: process.env },
  );

  const dep = readFileSync(resolve(repoRoot, "deployments/testnet.json"), "utf8");
  writeFileSync(resolve(repoRoot, "packages/shared/abi/deployments.testnet.json"), dep);
  const d = JSON.parse(dep);
  console.log("\n[demo:setup] DONE. Live demo mandate:");
  console.log(JSON.stringify(d, null, 2));
  console.log("\nNext:");
  console.log("  RUN_MM_BOT=true MM_BOT_MODE=honest RUN_TAKER_BOT=true pnpm dev:services");
  console.log("  (then flip MM_BOT_MODE=malicious to demo a failing/blocked MM)");
}

main();
