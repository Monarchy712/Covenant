import { encodeFunctionData } from "viem";
import { covenantVaultAbi, kuruOrderBookAbi, mockErc20Abi, MandateState, testnet } from "@covenant/shared";
import { publicClient, sendTx, type Wallet } from "./clients.js";

// Demo-market precisions (must match script/DeployCovenant.s.sol).
const PRICE_PRECISION = 100_000_000n; // 1e8
const SIZE_PRECISION = 10_000_000_000n; // 1e10
const TICK = 100n;
const DEFAULT_MID_18 = 2n * 10n ** 18n; // 2.0 when the book is empty (bootstrapping)

const alignTick = (pu: bigint) => (pu / TICK) * TICK;
const mid18ToPriceUnits = (mid18: bigint) => alignTick((mid18 * PRICE_PRECISION) / 10n ** 18n);
const baseWholeToSize = (n: bigint) => n * SIZE_PRECISION;

async function bestMid18(market: `0x${string}`): Promise<bigint> {
  const [bid, ask] = (await publicClient.readContract({
    address: market,
    abi: kuruOrderBookAbi,
    functionName: "bestBidAsk",
  })) as [bigint, bigint];
  const MAX = (1n << 256n) - 1n;
  const haveBid = bid !== MAX && bid !== 0n;
  const haveAsk = ask !== MAX && ask !== 0n;
  if (haveBid && haveAsk) return (bid + ask) / 2n;
  if (haveBid) return bid;
  if (haveAsk) return ask;
  return DEFAULT_MID_18;
}

/// Reference MM bot — quotes THROUGH the vault. This is also the "SDK snippet" a real MM adapts:
/// read mid, compute a two-sided quote inside the band, cancel+replace atomically via quote().
export class MmBot {
  private lastMid18 = 0n;
  private lastQuoteMs = 0;
  private didOversizedSell = false;

  constructor(
    private wallet: Wallet,
    private vault: `0x${string}`,
    private market: `0x${string}`,
    private mode: "honest" | "malicious",
    private requoteBps = 20n, // requote when mid moves > 0.2%
    private requoteEveryMs = 8000,
    private spreadBps = 60n, // honest quoted spread ~0.6% (< maxSpread)
    private sizeBaseWhole = 50n,
  ) {}

  private async snap(): Promise<any> {
    return publicClient.readContract({ address: this.vault, abi: covenantVaultAbi, functionName: "snapshot" });
  }

  private quoteData(bidPu: bigint, askPu: bigint, size: bigint, cancelIds: number[]) {
    return encodeFunctionData({
      abi: covenantVaultAbi,
      functionName: "quote",
      args: [[Number(bidPu)], [size], [Number(askPu)], [size], cancelIds],
    });
  }

  async tick() {
    const s = await this.snap();
    if (Number(s.state) !== MandateState.ACTIVE) return;
    const mid = await bestMid18(this.market);
    const cancelIds = (s.openOrders as any[]).map((o) => Number(o.id));

    if (this.mode === "malicious") {
      // 1) one oversized sell — expected to revert SellAllowanceExceeded (logged, not fatal).
      if (!this.didOversizedSell) {
        this.didOversizedSell = true;
        const askPu = mid18ToPriceUnits((mid * 101n) / 100n);
        const huge = baseWholeToSize(BigInt(s.terms.netSellCapPerWindow) / 10n ** 18n + 100n);
        try {
          await sendTx(this.wallet, {
            to: this.vault,
            data: this.quoteData(mid18ToPriceUnits((mid * 99n) / 100n), askPu, huge, cancelIds),
            label: "mmBot.oversizedSell(EXPECT REVERT)",
          });
          console.log("[mmBot] oversized sell UNEXPECTEDLY succeeded");
        } catch (e: any) {
          console.log(`[mmBot] oversized sell blocked as expected: ${String(e?.shortMessage ?? e?.message ?? e).slice(0, 120)}`);
        }
        return;
      }
      // 2) widen the spread past maxSpread but stay INSIDE the band so the quote is accepted
      //    yet fails the checkpoint's spread KPI. half-spread = bandBps-20 bps (just inside band).
      const bandBps = BigInt(s.terms.bandBps);
      const half = bandBps > 20n ? bandBps - 20n : bandBps / 2n;
      const wideBid = mid18ToPriceUnits((mid * (10_000n - half)) / 10_000n);
      const wideAsk = mid18ToPriceUnits((mid * (10_000n + half)) / 10_000n);
      try {
        await sendTx(this.wallet, {
          to: this.vault,
          data: this.quoteData(wideBid, wideAsk, baseWholeToSize(this.sizeBaseWhole), cancelIds),
          label: "mmBot.wideSpread",
        });
      } catch (e: any) {
        console.log(`[mmBot] wideSpread quote reverted: ${String(e?.shortMessage ?? e).slice(0, 120)}`);
      }
      return;
    }

    // honest: requote only on a mid move > requoteBps or every requoteEveryMs (NOT every block).
    const moved =
      this.lastMid18 === 0n ||
      (mid > this.lastMid18 ? mid - this.lastMid18 : this.lastMid18 - mid) * 10_000n > this.lastMid18 * this.requoteBps;
    if (!moved && Date.now() - this.lastQuoteMs < this.requoteEveryMs) return;

    const half = this.spreadBps / 2n;
    const bidPu = mid18ToPriceUnits((mid * (10_000n - half)) / 10_000n);
    const askPu = mid18ToPriceUnits((mid * (10_000n + half)) / 10_000n);
    try {
      await sendTx(this.wallet, {
        to: this.vault,
        data: this.quoteData(bidPu, askPu, baseWholeToSize(this.sizeBaseWhole), cancelIds),
        label: "mmBot.quote",
      });
      this.lastMid18 = mid;
      this.lastQuoteMs = Date.now();
    } catch (e: any) {
      console.log(`[mmBot] quote reverted: ${String(e?.shortMessage ?? e).slice(0, 140)}`);
    }
  }
}

/// Taker bot — occasional small random buys/sells so fills, the gauge and checkpoints move.
export class TakerBot {
  private approved = false;
  constructor(
    private wallet: Wallet,
    private market: `0x${string}`,
  ) {}

  private async approveOnce() {
    if (this.approved) return;
    for (const token of [testnet.base, testnet.quote]) {
      await sendTx(this.wallet, {
        to: token,
        data: encodeFunctionData({ abi: mockErc20Abi, functionName: "approve", args: [this.market, (1n << 255n)] }),
        label: "takerBot.approve",
      });
    }
    this.approved = true;
  }

  async tick() {
    await this.approveOnce();
    const buy = Math.random() < 0.5;
    try {
      if (buy) {
        const quoteAmt = BigInt(3 + Math.floor(Math.random() * 8)) * PRICE_PRECISION; // ~3..10 base worth
        await sendTx(this.wallet, {
          to: this.market,
          data: encodeFunctionData({
            abi: kuruOrderBookAbi,
            functionName: "placeAndExecuteMarketBuy",
            args: [quoteAmt, 0n, false, false],
          }),
          label: "takerBot.buy",
        });
      } else {
        const size = baseWholeToSize(BigInt(2 + Math.floor(Math.random() * 6)));
        await sendTx(this.wallet, {
          to: this.market,
          data: encodeFunctionData({
            abi: kuruOrderBookAbi,
            functionName: "placeAndExecuteMarketSell",
            args: [size, 0n, false, false],
          }),
          label: "takerBot.sell",
        });
      }
    } catch (e: any) {
      console.log(`[takerBot] ${buy ? "buy" : "sell"} reverted: ${String(e?.shortMessage ?? e).slice(0, 120)}`);
    }
  }
}

/// Seeder bot — keeps a thin two-sided book OUTSIDE the vault so a mid always exists (an empty
/// book blocks the vault's band check). Deposits a little margin once, then maintains a bid+ask.
/// For the hackathon demo the honest MM bot also keeps the book two-sided; the seeder is the
/// safety net. Kept minimal: it re-posts via addBuyOrder/addSellOrder after a margin deposit.
export class SeederBot {
  constructor(
    private wallet: Wallet,
    private market: `0x${string}`,
  ) {}
  async tick() {
    const mid = await bestMid18(this.market);
    const bidPu = mid18ToPriceUnits((mid * 97n) / 100n);
    const askPu = mid18ToPriceUnits((mid * 103n) / 100n);
    // thin size
    const size = baseWholeToSize(1n);
    try {
      await sendTx(this.wallet, {
        to: this.market,
        data: encodeFunctionData({ abi: kuruOrderBookAbi, functionName: "addBuyOrder", args: [Number(bidPu), size, true] }),
        label: "seeder.bid",
      });
      await sendTx(this.wallet, {
        to: this.market,
        data: encodeFunctionData({ abi: kuruOrderBookAbi, functionName: "addSellOrder", args: [Number(askPu), size, true] }),
        label: "seeder.ask",
      });
    } catch (e: any) {
      console.log(`[seeder] reverted (needs margin deposit): ${String(e?.shortMessage ?? e).slice(0, 120)}`);
    }
  }
}
