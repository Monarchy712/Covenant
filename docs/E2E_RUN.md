# E2E_RUN.md — live settlement proof (Monad testnet, chain 10143)

`pnpm e2e:full` — the **full lifecycle THROUGH SETTLEMENT** executed on real Monad testnet
(2026-09-25). This is the first time settlement (pause → malicious phase → duration end →
cancel → finalize → claim → withdraw → SETTLED) has run live. Short demo mandate:
checkpoint 45s, window 90s, duration 200s. Reused the deployed factory + market + mintable
mock tokens; created a fresh mandate.

- factory: `0x49dcD18CdACB881070Afb90f0b992ad7afac34E4`
- vault (this run): `0x1f260263B010D293b7268cAC9e6E575Ec3d192DB`
- market: `0x1429116A9795FC921bb3Bc735a656B55804714c6`
- base: `0xC5652d30758EaF1e0ABA2Fa46e3fB069d6f33617`  quote/fee: `0x2968F6Ab34415bBF6D8cB72e25c3578B5796A60c`
- issuer `0xa34118bD1A2A789A962A4471C59c3964fb716123` · mm `0x687dFEcC7eAaFA4DC28f72Bfb9cdB77cAe18a641` · taker `0x7A0A94615094Ef0673f2D0F031D43fB9ED78cc0B`

## Transactions (in order, all status=success)
| Step | Tx |
|---|---|
| createMandate | `0xcffecb7990df49ce1cba813be425f0db00dae6d8bd04e0d5d2f431f80bded937` |
| accept(termsHash) | `0x28ea7f18672896a9ad2891feab23e091457633a685515a06475c45678b291b4e` |
| mint base→issuer | `0x10633e99ca232da112d9e7756099381532d23f2aaba2dadb8dda85cdee7fe496` |
| mint quote→issuer | `0x915bed0b7c91928852c28b3c726652debdab1cf76e64fa0ecafdc95e404492a0` |
| mint quote→taker | `0xcdb04f4f748ecec7555a9d7512c9f19bfe13ad4eae45c990ce95bb3b2d0820ef` |
| approve base | `0x36efbbd93b763b352f2662444cf44cad4b6d5ba896f6d3e36379e2cec594da39` |
| approve quote | `0xb6921b89c457c6acebf89786465dc9c468411a80caccdc94ef44c9b462643139` |
| depositInventory base | `0x762d10b8a25f68b40b31e36e5568044cf5e0f796e23721820259a54e7292f535` |
| depositInventory quote | `0x436ad74475e3c10377ed9c3e0eacda725184eed56e48ce186ea7d4a9282d4a9e` |
| fundFees (500 USDC) | `0xe025b0b8b4b7bc599f12b30ac8dd5c1d341b493904400927f151e162559ba354` |
| activate | `0x7c92988990eed4b310012c3bbe26b547498b2a0945aab5f355606d5d947072cd` |
| quote honest (two-sided) | `0xe0023899f5128318f66c0b150dc42b492623c50f945d84144bcbdf32ebf676b2` |
| taker approve quote | `0x7102c20bea4a9e1d03d54480584c6408a8acdf2f987e6538a8f5a55ec4a5ff4c` |
| taker buy 40 base | `0x792b03e5ec83aeac9d66d33c0cf057e398fc30cc0b9837ae57b772f5fa2e735a` |
| checkpoint #1 (pass obs) | `0x2d2f7ffbef73626006ef90ef6d7169f8bfa17d21e4fbc5803960443068454c2a` |
| checkpoint #2 (finalize interval 0 → PAID) | `0xf9112703fee2bb179854316a37260a2582288f317c0afdbb57b8844869476651` |
| pause | `0xce5cd34710b99928af59a5f3c9a10afd6b911b3d5b9e83a9bc253a20d480c162` |
| unpause | `0xdc3764e01e7634ba641462f262fb15e4489c0b5eb23ecac83c490b283ee12f24` |
| quote WIDE (malicious) | `0x1be57d4be89c01bc12fbb5ce85a559bf4a2bc02cb3a2ec26a50839ef966d3021` |
| checkpoint wide (fail obs) | `0x61972f3e8d5e4075ad92305f164ace80b5fcf5046e62072f2b30d6bab5600752` |
| cancelAllAfterEnd | `0xfa3c25f36b1230049cfa1715e7e7c4358d87833d62456ec55834dc736ef122c3` |
| finalize | `0x441ec80fb8293d0c1671892decca64d5fe0b3965aaa7373cef149978716ad210` |
| claimFees | `0xab27289cd99146d3c3f8086e71bfb34c6ff3d7c26d7e61439f8a28a4952c2d17` |
| withdraw → SETTLED | `0x69e561a3a0ace817c2d2e67252258c6afc9bca888a32723655a6ec1dfba14219` |

## Blocked oversized sell (decoded live from revert data)
`SellAllowanceExceeded` — "Blocked: net-sell **39.96** + resting **5060** + requested **5000**
exceeds the cap **1000** for this window." (The taker had filled 40 base off the vault's ask, so
`soldBase` = 39.96; the malicious 5000-base ask would blow the per-window cap.)

## Final assertions (exact balances, read on-chain after withdraw)
- **state == SETTLED(5): PASS** (got 5)
- **MM gained exactly the accrued fees: PASS** — gain `100000000` == accrued `100000000` (2 paid intervals × 50 USDC)
- **issuer base increased: PASS** — `+960.04` base (1000 deposited − 39.96 net sold)
- **issuer quote increased (proceeds + unused escrow): PASS** — `+1480.16` USDC (1000 quote inventory returned + ~80 proceeds from the 40-base fill + 400 unused fee escrow: 500 escrow − 100 accrued)
- vault margin drained: confirmed by the successful `withdraw` + SETTLED transition (the standalone assertion read used the wrong ABI and reported −1; the on-chain withdraw of base+quote from MarginAccount is what drives SETTLED).

## What this proves
End-to-end on live testnet: mandate creation with hash-pinned acceptance, funded activation,
honest two-sided quoting with a real taker fill, a **paid** KPI interval, pause/unpause, a
**contract-blocked** oversized sell (fail-safe governor, decoded error), a **failed** interval
after the malicious spread-widening, lazy ENDED on duration, permissionless cancel + finalize,
MM fee claim, and issuer settlement returning exactly inventory + proceeds + unused escrow — with
the MM receiving **only** its earned fees. Reproduce with `pnpm e2e:full`.
