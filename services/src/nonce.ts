import type { PublicClient, WalletClient, Account } from "viem";

/// Per-wallet serial send queue with a locally tracked nonce. Each module owns ONE NonceManager
/// for its ONE wallet, so nonces are never shared/raced across modules. Sends run strictly
/// serially (each awaits the previous), which is the simplest safe design for a keeper/bot.
export class NonceManager {
  private next: number | null = null;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private pub: PublicClient,
    private wallet: WalletClient,
    private account: Account,
  ) {}

  /// Enqueue a send. `send(nonce)` must submit the tx with the given nonce and return its hash.
  async submit(send: (nonce: number) => Promise<`0x${string}`>): Promise<`0x${string}`> {
    const run = this.chain.then(async () => {
      if (this.next === null) {
        this.next = await this.pub.getTransactionCount({
          address: this.account.address,
          blockTag: "pending",
        });
      }
      const nonce = this.next!;
      try {
        const hash = await send(nonce);
        this.next = nonce + 1;
        return hash;
      } catch (e) {
        // On failure, resync the nonce from chain so we don't wedge the queue.
        this.next = await this.pub.getTransactionCount({
          address: this.account.address,
          blockTag: "pending",
        });
        throw e;
      }
    });
    // keep the chain alive regardless of individual failures
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
