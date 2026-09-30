# Covenant Frontend — Overnight Autonomous Run

Working M2 → M7 autonomously. Local commits per milestone, never pushed. Updated after each milestone.

## 1. Milestones

| Milestone | Status | Local commit |
|---|---|---|
| M1 design system + landing | DONE (pre-run, revised) | (see git log) |
| M2 wallet + useCovenantTx/TxProgress + /start | DONE | (this commit) |
| M3 create wizard + issuer home | NOT STARTED | — |
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

## 3. Decisions made overnight (with reasons)
- **Wallet stack = raw viem context, not RainbowKit's modal.** RainbowKit's `getDefaultConfig` requires a WalletConnect projectId (decision: no WC). A custom `WalletProvider` on viem (injected + burner) is simpler, needs no projectId, and matches the product's required "connect vs demo wallet" choice everywhere. `NEXT_PUBLIC_WC_PROJECT_ID` still read from env for future use. wagmi/rainbowkit remain installed but unused for now.
- **Shared error fix (decision #2):** `ERROR_MESSAGES.SellAllowanceExceeded` no longer double-counts `requested` (restingAfter already includes it); added graceful empty-args handling for the preflight path; unit test in `services/test/shared-errors.test.ts` (2 tests, passing).
- **.next untracked:** `apps/web/.next` build output was tracked in git; added to `.gitignore` and `git rm --cached` so milestone commits are clean.

## 4. Questions for morning (decided + continued anyway)
- WalletConnect projectId: proceeded with injected + burner only (per locked decision).

## 5. Known bugs / rough edges (ranked by demo impact)
- (none yet)

## 6. Needs a backend or Railway change
- (none yet)

## 7. Budget used vs limit
- Demo mandates created: 0 / 5
- Faucet calls: 0 / 3
- Demo sessions (issuer role, no mandate): 1 (verifying the /start flow)
- Demo burner: ONE generated (`0x48A8…D7e6`), reused across tests

## 8. Next steps for the morning
- Review local commits on `main` (never pushed). Push with:
  ```
  git push origin main
  ```
