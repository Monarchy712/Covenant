import {
  createPublicClient,
  createWalletClient,
  http,
  type Account,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "@covenant/shared";
import { config } from "./config.js";
import { NonceManager } from "./nonce.js";

export const publicClient: PublicClient = createPublicClient({
  chain: monadTestnet,
  transport: http(config.rpcUrl),
});

export interface Wallet {
  account: Account;
  client: WalletClient;
  nonce: NonceManager;
}

export function makeWallet(pk: `0x${string}`): Wallet {
  const account = privateKeyToAccount(pk);
  const client = createWalletClient({ account, chain: monadTestnet, transport: http(config.rpcUrl) });
  return { account, client, nonce: new NonceManager(publicClient, client, account) };
}

/// Gas: Monad charges the LIMIT, so estimate then set limit = estimate × 1.15. Logs
/// estimate/limit/used. Sends serially through the wallet's NonceManager.
export async function sendTx(
  w: Wallet,
  params: { to: `0x${string}`; data: `0x${string}`; value?: bigint; label: string },
): Promise<{ hash: `0x${string}`; gasUsed: bigint; gasLimit: bigint; estimate: bigint }> {
  const estimate = await publicClient.estimateGas({
    account: w.account,
    to: params.to,
    data: params.data,
    value: params.value ?? 0n,
  });
  const gasLimit = (estimate * config.gasLimitMultiplierBps) / 10_000n;

  const hash = await w.nonce.submit((nonce) =>
    w.client.sendTransaction({
      account: w.account,
      chain: monadTestnet,
      to: params.to,
      data: params.data,
      value: params.value ?? 0n,
      gas: gasLimit,
      nonce,
    }),
  );

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const gasUsed = receipt.gasUsed;
  console.log(
    `[tx] ${params.label} hash=${hash} estimate=${estimate} limit=${gasLimit} used=${gasUsed} status=${receipt.status}`,
  );
  if (receipt.status !== "success") throw new Error(`tx reverted: ${params.label} ${hash}`);
  return { hash, gasUsed, gasLimit, estimate };
}
