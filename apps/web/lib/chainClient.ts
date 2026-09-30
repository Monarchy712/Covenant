import { createPublicClient, http } from "viem";
import { monadTestnet } from "@covenant/shared";

/** Read-only viem client for public on-chain reads (no wallet needed). */
export function publicClient(rpcUrl?: string) {
  return createPublicClient({
    chain: monadTestnet,
    transport: http(rpcUrl ?? monadTestnet.rpcUrls.default.http[0], { timeout: 8_000 }),
  });
}
