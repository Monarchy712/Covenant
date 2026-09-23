# covenant-kuru-spike

Technical spike answering ONE question: **can a smart-contract vault (not an EOA)
control a Kuru market-making position on Monad strongly enough to enforce a
market-making mandate?** — own inventory and orders, discover/read its own orders,
measure its own fills on-chain, and enforce a sell cap + price band atomically.

This is a *spike*, not the Covenant product. See `docs/KURU_ARCHITECTURE.md` for the
Kuru findings and `TECHNICAL_SPIKE_REPORT.md` / `DAY_1_DECISION.md` for the verdict.

> **AI coding disclosure:** this spike was built with Claude Code (Anthropic). All
> code, docs, and analysis in this repo were produced in an AI-assisted session, as
> required by the hackathon's AI-disclosure rule.

## Tooling

```
forge --version   # forge 1.7.1 (commit 4072e487, 2026-05-08)
cast --version    # cast  1.7.1
solc              # 0.8.26 (via foundry.toml, evm_version = cancun)
```

## Networks (verified live in Phase 0)

| Network | chain id | RPC | Explorer |
|---|---|---|---|
| Monad testnet | 10143 (`0x279f`) | https://testnet-rpc.monad.xyz | https://testnet.monadexplorer.com |
| Monad mainnet | 143 (`0x8f`) | https://rpc.monad.xyz | https://monadvision.com |

## Env vars

Copy `.env.example` → `.env` and fill the private keys. `.env` is gitignored; never
commit secrets.

```
RPC_URL_TESTNET, RPC_URL_MAINNET
PRIVATE_KEY_DEPLOYER   # DEPLOYER/ISSUER 0xa34118bD1A2A789A962A4471C59c3964fb716123
PRIVATE_KEY_MM         # MM (operator)   0x687dFEcC7eAaFA4DC28f72Bfb9cdB77cAe18a641
PRIVATE_KEY_TAKER      # TAKER           0x7A0A94615094Ef0673f2D0F031D43fB9ED78cc0B
PRIVATE_KEY_ATTACKER   # ATTACKER        0x6d11172f538b60BE3a69c745944767Ac94019df7
```
All four wallets held 5 MON each on testnet as of 2026-09-23; testnet gas price ~102 gwei.

## Kuru testnet addresses (verified with `cast code`, Phase 1)

| Contract | Address |
|---|---|
| Router | `0x7EFbE105Ca7415dE98F96622173458ac1c054630` |
| MarginAccount | `0xd029C2D98ff85D8F64799017fE00a59B1159CE02` |
| KuruForwarder | `0x681bB1508E14433b148a2549ba2726454aDc9BB4` |
| MonadDeployer | `0xDacd06372cEb638640c9D8466A023b7362324e1A` |
| KuruUtils | `0xE0841E0F06c5770C1D4930EC6C507ee33199C88C` |
| Testnet USDC | `0x3bA3d39AFcf8bb994f7964B3e0171Ea2Ba361570` |
| MON/USDC market | `0xa241896A7Dbe8a550D2E5fF7A914bB1989ceD2D9` |

## Commands

```bash
forge build
forge test -vvv                                    # local + mock unit tests
forge test --fork-url $RPC_URL_TESTNET -vvv        # fork tests against real Kuru
# Phase 9 real testnet broadcast (spends MON):
forge script script/<Script>.s.sol --rpc-url $RPC_URL_TESTNET --broadcast
```

## Layout

```
src/interfaces/   IKuruOrderBook / IKuruMarginAccount / IKuruRouter (OBSERVED signatures)
src/mocks/        MockBase (18dec) / MockUSDC (6dec) — NEVER mixed with real Kuru ifaces
src/              KuruIntegrationSpike.sol — the contract-owned vault under test
test/             lifecycle / order-id / fills / governor / band / adversarial / gas
docs/             KURU_ARCHITECTURE.md
```
