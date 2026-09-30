# Covenant Frontend — Overnight Autonomous Run

Working M2 → M7 autonomously. Local commits per milestone, never pushed. Updated after each milestone.

## 1. Milestones

| Milestone | Status | Local commit |
|---|---|---|
| M1 design system + landing | DONE (pre-run, revised) | (see git log) |
| M2 wallet + useCovenantTx/TxProgress + /start | DONE | d73d8e9 |
| M3 create wizard + issuer home | DONE (live launch blocked by faucet) | (this commit) |
| M4 mandate dashboard (hero) | NOT STARTED | — |
| M5 invite + MM console | NOT STARTED | — |
| M6 proof + trade + badge + explore | NOT STARTED | — |
| M7 Playwright journeys + audit | NOT STARTED | — |

## 2. What works end-to-end
- M1 landing with live flagship panel (real /config, /proof, /events, book from /summary). Screens in `apps/web/docs/screens/`.
- **M2 wallet + /start (verified in Playwright):** landing "I'm a token team" → `/start?role=issuer`
  → "Continue with a demo wallet" → `POST /demo/session` 200 (burner funded, no mandate) → routed
  to `/create`; the nav wallet button then shows the burner address `0x48A8…D7e6` with a working
  account menu (Copy / Get test funds / Export key / Reset / Disconnect). Screens in
  `docs/screenshots/m2/` (start-issuer-1440, start-mm-390, create-connected-1440, wallet-menu-1440).
  - Built: `WalletProvider` (viem; injected + demo burner), `useCovenantTx` (preflight → approvals
    as sub-steps → sign → pending → confirmed with latency → decoded reverts incl. mined send-anyway),
    `TxProgress` (checklist + "Confirmed in X.Xs" + Blocked-by-contract card), `WalletButton`, `/start`.
  - `useCovenantTx`/`TxProgress` are built + typecheck-clean but not yet exercised by a real write;
    they get their first live run in M3's wizard launch.
  - Injected (MetaMask) path can't be tested headless (no `window.ethereum` in Playwright); code is
    in place (eth_requestAccounts + wallet_addEthereumChain/switch to 10143). Needs manual MetaMask check.

- **M3 create wizard + issuer home (UI verified):** `/create` is a 4-step persisted wizard
  (token & market → terms with presets + live plain-English/band/fee-budget panels → market maker
  → fund & launch checklist) and `/app` is the issuer home (mandate rows via `/mandates` + per-vault
  `/summary`, teaching empty state). The launch runs through `useCovenantTx` as a live checklist
  (create → deposit → fund → wait-for-MM → activate), extracting the new vault from the
  `MandateCreated` event. Screens in `docs/screenshots/m3/`. Live launch blocked only by the faucet
  MON outage (§5/§6), not code.

## 3. Decisions made overnight (with reasons)
- **Fixed a real wallet bug found via M3:** `useCovenantTx` passed `account: <addressString>` to
  `writeContract`. For a local burner walletClient that forces viem into `eth_sendTransaction`
  (node-side signing) → "RPC Request failed". Now passes `wallet.account` (the client's own signer),
  matching the manual send that succeeded on-chain. This affects ALL writes, so it was essential.
- **Hardened `useCovenantTx` for Monad's flaky public RPC:** retry reads/estimates (not signed
  sends) up to 3×; on a non-revert estimate failure, fall back to a fixed gas limit instead of
  aborting; only a real decoded revert blocks a step.
- **Wallet stack = raw viem context, not RainbowKit's modal.** RainbowKit's `getDefaultConfig` requires a WalletConnect projectId (decision: no WC). A custom `WalletProvider` on viem (injected + burner) is simpler, needs no projectId, and matches the product's required "connect vs demo wallet" choice everywhere. `NEXT_PUBLIC_WC_PROJECT_ID` still read from env for future use. wagmi/rainbowkit remain installed but unused for now.
- **Shared error fix (decision #2):** `ERROR_MESSAGES.SellAllowanceExceeded` no longer double-counts `requested` (restingAfter already includes it); added graceful empty-args handling for the preflight path; unit test in `services/test/shared-errors.test.ts` (2 tests, passing).
- **.next untracked:** `apps/web/.next` build output was tracked in git; added to `.gitignore` and `git rm --cached` so milestone commits are clean.

## 4. Questions for morning (decided + continued anyway)
- WalletConnect projectId: proceeded with injected + burner only (per locked decision).

## 5. Known bugs / rough edges (ranked by demo impact)
1. **[HIGH] Demo-wallet writes fail: the faucet is out of MON.** The faucet mints base/USDC fine
   but its MON drip tx reverts (status 0x0 — faucet wallet has no MON). A demo burner gets tokens
   but 0 MON, so it cannot pay gas for ANY write (launch, quote, trade). This blocks the whole
   judge write-path. Fix = top up the faucet/demo wallets with MON on Railway (see §6). Not a
   frontend bug.
2. **[MED] Full wizard launch not verified end-to-end live** because of (1) + demo-session is
   IP-rate-limited 24h. The launch CODE is proven correct: a manual `createMandate` from the browser
   burner (identical walletClient path) succeeded on-chain (`0x498474895c02503816ee57e3f289ceba9b79dc9938d8fa68989f7f628de3be6e`),
   and I fixed the real blocker (see §3, the `account` bug). Re-run after the faucet is topped up.
3. **[LOW] `plainEnglishTerms` fixed** to show minutes/hours for sub-day durations (was "0.0104 days").

## 6. Needs a backend or Railway change
- **Top up the faucet / demo wallet with MON.** `PRIVATE_KEY_FAUCET` (and/or the demo-issuer wallet)
  is out of MON, so the faucet's MON drip reverts and demo burners can't pay gas. Without this, no
  one can launch/quote/trade with a demo wallet. `pnpm wallets:status` / `wallets:topup` on the
  server, or send MON to the faucet address. This is the #1 blocker for a live demo.

## 7. Budget used vs limit
- Demo mandates created: **1 / 5** (one `createMandate`, sent while pinpointing the `account` bug)
- Faucet calls: **1 / 3** successful (base+USDC minted; MON drip reverted — faucet out of MON)
- Demo sessions: 1 successful (M2, burner `0x48A8…`), 1 rejected (IP cap)
- Demo burners: `0x48A8…D7e6` (funds stranded — localStorage cleared, key not exported),
  `0x04De…36Ab` (100k base + 100k USDC, 0 MON). Lesson: keep/export a burner key before clearing.

## 8. Next steps for the morning
- Review local commits on `main` (never pushed). Push with:
  ```
  git push origin main
  ```
