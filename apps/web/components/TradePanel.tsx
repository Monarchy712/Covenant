"use client";

import { useState } from "react";
import Link from "next/link";
import { traderBuy, traderSell } from "@covenant/shared";
import { ArrowsDownUpIcon } from "@phosphor-icons/react";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { TxProgress } from "@/components/TxProgress";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { useCovenantTx } from "@/lib/useCovenantTx";
import { cn } from "@/lib/cn";

const PRICE_PRECISION = 100_000_000; // 1e8
const SIZE_PRECISION = 10_000_000_000; // 1e10

/**
 * Public trade panel: market buy/sell against the book (demo wallet). A taker fill
 * shows up in the vault's gauge + feed within seconds (the seeder quotes outside the
 * vault, so taker orders hit the vault first).
 */
export function TradePanel({
  market,
  base,
  quote,
  onFill,
}: {
  market: `0x${string}`;
  base: `0x${string}`;
  quote: `0x${string}`;
  onFill?: () => void;
}) {
  const { address, startDemo } = useWallet();
  const tx = useCovenantTx();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState(10);

  const trade = () => {
    const action =
      side === "buy"
        ? traderBuy(market, quote, BigInt(Math.round(amount * PRICE_PRECISION)))
        : traderSell(market, base, BigInt(Math.round(amount * SIZE_PRECISION)));
    void tx.run([{ key: "trade", label: side === "buy" ? "Buy base off the book" : "Sell base into the book", getAction: () => action }], {
      onSuccess: onFill,
    });
  };

  return (
    <Panel>
      <PanelHeader title="Trade this market" hint="Your fill moves the vault's gauge and feed" />
      <div className="p-4">
        <div className="mb-3 grid grid-cols-2 gap-1 rounded-sm border border-hairline p-1">
          {(["buy", "sell"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSide(s)}
              className={cn(
                "rounded-[4px] py-1.5 text-[14px] font-medium capitalize transition-colors",
                side === s ? (s === "buy" ? "bg-pass-soft text-pass" : "bg-fail-soft text-fail") : "text-ink-subtle hover:text-ink",
              )}
            >
              {s}
            </button>
          ))}
        </div>
        <label className="mb-1 block text-[12px] text-ink-subtle">
          {side === "buy" ? "USDC to spend" : "Base to sell"}
        </label>
        <input
          type="number"
          value={amount}
          min={0}
          onChange={(e) => setAmount(Number(e.target.value))}
          className="mb-3 h-9 w-full rounded-sm border border-hairline bg-surface-2 px-3 text-[15px] text-ink outline-none focus:border-accent"
        />
        {address ? (
          <Button onClick={trade} disabled={tx.state.status === "running" || amount <= 0} className="w-full">
            <ArrowsDownUpIcon size={14} weight="bold" aria-hidden />
            {side === "buy" ? "Buy base" : "Sell base"}
          </Button>
        ) : (
          <Button onClick={() => startDemo("trader")} className="w-full">
            Use a demo wallet to trade
          </Button>
        )}
        <p className="mt-2 text-[12px] leading-relaxed text-ink-subtle">
          Testnet only. A market order fills against the vault&rsquo;s resting liquidity;
          the volume counts against the mandate&rsquo;s net-sell cap.
        </p>
        {tx.state.status !== "idle" && <TxProgress state={tx.state} className="mt-3" />}
      </div>
    </Panel>
  );
}

export function TradePanelFallback() {
  return (
    <Panel className="p-4 text-[14px] text-ink-subtle">
      Trading will open once the market is loaded.{" "}
      <Link href="/start?role=trader" className="text-accent hover:text-accent-hover">
        Start as a trader
      </Link>
      .
    </Panel>
  );
}
