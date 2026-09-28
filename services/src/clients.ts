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
  // estimateGas is read-only + idempotent, so retry it on transient RPC errors (Monad's RPC
  // occasionally returns "Missing or invalid parameters"). A genuine revert carries revert data
  // and is re-thrown immediately (not retried). The signed send is NEVER retried here.
  let estimate = 0n;
  for (let attempt = 0; ; attempt++) {
    try {
      estimate = await publicClient.estimateGas({
        account: w.account,
        to: params.to,
        data: params.data,
        value: params.value ?? 0n,
      });
      break;
    } catch (e: any) {
      const msg = String(e?.shortMessage ?? e?.message ?? e);
      const isRevert = /revert|execution reverted|0x[0-9a-f]/i.test(String(e?.cause?.data ?? "")) || /revert/i.test(msg);
      if (isRevert || attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
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
