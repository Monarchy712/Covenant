import type { EventRow } from "./api";
import type { Tone } from "@/components/ui/Badge";

const PRICE_PRECISION = 1e8;
const SIZE_PRECISION = 1e10;
const num = (v: unknown) => Number(v ?? 0);

export interface FormattedEvent {
  tone: Tone;
  text: string;
}

/** Turn a raw indexed event into a human sentence + a semantic tone. */
export function formatEvent(ev: EventRow): FormattedEvent {
  let a: Record<string, unknown> = {};
  try {
    a = JSON.parse(ev.args) as Record<string, unknown>;
  } catch {
    /* leave empty */
  }
  const price18 = (v: unknown) => (num(v) / 1e18).toFixed(3);
  const priceU = (v: unknown) => (num(v) / PRICE_PRECISION).toFixed(3);
  const size = (v: unknown) => (num(v) / SIZE_PRECISION).toLocaleString("en-US");
  const usdc = (v: unknown) => (num(v) / 1e6).toLocaleString("en-US");

  switch (ev.name) {
    case "Trade": {
      const bought = Boolean(a.isBuy);
      return {
        tone: "accent",
        text: `Taker ${bought ? "bought" : "sold"} ${size(a.filledSize)} at ${price18(a.price)}`,
      };
    }
    case "OrderPlaced":
      return {
        tone: "neutral",
        text: `MM placed ${a.isBid ? "bid" : "ask"} ${size(a.size)} at ${priceU(a.price)}`,
      };
    case "OrderReplaced":
      return { tone: "neutral", text: `MM requoted at ${priceU(a.price)}` };
    case "OrderCancelled":
      return { tone: "idle", text: `MM cancelled order #${num(a.id)}` };
    case "IntervalFinalized":
      return num(a.paid)
        ? { tone: "pass", text: `Interval ${num(a.interval)} paid ${usdc(a.amount)} USDC` }
        : { tone: "fail", text: `Interval ${num(a.interval)} voided, no fee` };
    case "CheckpointObserved":
      return a.passed
        ? { tone: "pass", text: `Checkpoint passed, spread ${num(a.spreadBps) / 100}%` }
        : { tone: "fail", text: `Checkpoint failed at interval ${num(a.interval)}` };
    case "FeeAccrued":
      return { tone: "pass", text: `Fee accrued ${usdc(a.amount)} USDC` };
    case "FeeClaimed":
      return { tone: "accent", text: `MM claimed ${usdc(a.amount)} USDC` };
    case "InventoryDeposited":
      return { tone: "neutral", text: `Issuer deposited inventory` };
    case "FeesFunded":
      return { tone: "neutral", text: `Issuer funded the fee escrow` };
    case "Activated":
      return { tone: "pass", text: `Mandate activated` };
    case "MandateAccepted":
      return { tone: "accent", text: `Market maker accepted the mandate` };
    case "Paused":
      return { tone: "warn", text: `Mandate paused` };
    case "Unpaused":
      return { tone: "pass", text: `Mandate resumed` };
    default:
      return { tone: "neutral", text: ev.name };
  }
}
