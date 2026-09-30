import { createPublicClient, http, parseUnits } from "viem";
import { monadTestnet, createMandate, decodeCovenantError } from "./dist/src/index.js";
const B = "https://covenantservices-production.up.railway.app";
const cfg = await (await fetch(`${B}/config`)).json();
const burner = "0x48A80953728F616E56668d94FB267E1F12F6D7e6";
const terms = {
  market: cfg.flagshipMarket, baseToken: cfg.base, quoteToken: cfg.quote,
  issuer: burner, mm: cfg.houseMM,
  netSellCapPerWindow: parseUnits("1000",18), windowLength: 3600n, bandBps: 200n,
  maxOpenPerSide: 5n, maxSpreadBps: 100n, minDepthPerSide: parseUnits("1",18),
  checkpointInterval: 60n, feePerInterval: parseUnits("50",6), duration: 900n, maxConsecutiveFails: 3n,
};
const action = createMandate(cfg.factory, terms);
const pc = createPublicClient({ chain: monadTestnet, transport: http() });
try {
  const sim = await pc.simulateContract({ ...action.call, account: burner });
  console.log("SIMULATE OK → vault:", sim.result);
} catch (e) {
  console.log("shortMessage:", (e.shortMessage||e.message||"").slice(0,220));
  console.log("cause.name:", e?.cause?.name, "| cause.reason:", e?.cause?.reason);
  const raw = e?.cause?.raw || e?.cause?.data?.data;
  if (raw) console.log("decoded:", decodeCovenantError(raw));
}
