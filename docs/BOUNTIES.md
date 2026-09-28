# Bounties — Covenant

**Primary track: Onchain Finance & Trading** ($30,000) — "New asset primitives, market
structures, and the trading experiences that make them usable — all made possible by fast,
cheap settlement." Covenant is a **market-structure primitive**: an enforceable market-making
mandate on Kuru's on-chain order book, settled trustlessly on Monad.

Targeting two **Kuru** sponsor bounties (Onchain Finance & Trading, $5,000 each). Deadline
Oct 14, 2026 09:29 GMT+5:30.

---

## PRIMARY: Kuru — "Bring New Assets and Markets to Kuru" ($5,000)

> Build a new class of tradable markets on Kuru using its spot order book. Looking for founders
> creating assets or market categories not yet available onchain, along with the infrastructure
> needed to make them viable — issuance, settlement, liquidity, compliance, and user onboarding.

**Why Covenant fits (it solves "more than the trading interface"):** Covenant is the **liquidity +
settlement infrastructure** that makes a new token's Kuru market *viable*. A token issuer creates
a Kuru market (Router.deployProxy) and hires a market maker under a mandate the MM **cannot
break** — the CovenantVault owns the orders and inventory, enforces a net-sell cap + price band +
open-order cap **atomically**, and pays the MM only for KPI-proven liquidity. That's exactly the
"infrastructure to make markets viable" the bounty asks for.

Judging-criteria → evidence:
- **Asset class / customer:** token issuers who need trustworthy on-chain liquidity for a new
  market (and the MMs they hire). Not just a UI — a market-formation primitive.
- **Issuance / redemption / settlement mechanism:** on-chain, in `CovenantVault` — inventory
  custody in Kuru's MarginAccount, KPI-gated fee settlement, issuer withdraw/settle. Proven live
  end-to-end to SETTLED (`docs/E2E_RUN.md`).
- **Liquidity strategy / initial market formation:** the enforced market-making mandate *is* the
  liquidity strategy — continuous two-sided quotes inside a band, net-sell-capped so the MM can't
  dump. Demonstrated on a live hosted stack (`docs/SOAK_REPORT.md`).
- **Legal/operational viability:** the mandate is transparent and publicly verifiable (`/proof`),
  which is the on-chain analog of an MM agreement + compliance monitoring.
- **Continue after the hackathon:** the contracts + services + integration surface are built and
  live on testnet; frontend is the remaining piece.

## SECONDARY: Kuru — "Build the Next Consumer Trading App on Kuru" ($5,000)

> Build a focused spot trading product that routes trades through Kuru's onchain order book on Monad.

**Fit:** Covenant routes real trades through Kuru — the vault places/cancels/replaces orders via
Kuru `batchUpdate`, and the public trade panel executes Kuru market orders (`traderBuy`/`traderSell`).
Every fill is a real Kuru `Trade`. Target user is issuers + MMs (and the retail takers who trade
the resulting liquid market). Working integration proven with live tx hashes
(`TECHNICAL_SPIKE_REPORT.md`, `docs/E2E_RUN.md`). Weaker than the primary because our core user is
the issuer/MM, not the retail trader — claimed as secondary.

Deliverables ready: working product integrated with Kuru (live testnet), clear target user,
usage/trading evidence (E2E + soak tx hashes), and a continue-building plan.

---

## Other bounties — eligibility

Not currently eligible without a new integration (out of Covenant's scope): Perpl, Nansen,
Chainlink CRE, Mera, Dynamic, Privy, MetaMask Agent plugin, and the AI-credit bounties
(KIMI/Qwen/Hunyuan). Realistic **stretch** adds if time allows:
- **Best Use of Envio** ($1,000): replace the custom SQLite indexer with Envio HyperIndex/HyperSync.
- **Best Projects using Alchemy** ($1,000 credits): point the RPC at Alchemy if it serves Monad testnet.

## Kuru resources referenced
- Kuru testnet docs: https://kuru-testnet-docs.mintlify.site/
- Faucet: https://gist.github.com/devblixt/80740a416ddc6afd2618c365b1f6cf98
- Monad getting started: https://docs.monad.xyz/developer-essentials/getting-started
