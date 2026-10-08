"use client";

// Tracks which vaults were created by a demo session (role=mm), so the invite page knows to
// auto-fund + activate them via /demo/activate after the MM accepts. A real (non-demo) invite is
// never marked, so we never call /demo/activate on a mandate the backend demo-issuer can't fund.
const KEY = (vault: string) => `covenant.demo.mmvault.${vault.toLowerCase()}`;

export function markDemoVault(vault: string): void {
  try {
    localStorage.setItem(KEY(vault), "1");
  } catch {
    /* ignore (private mode) */
  }
}

export function isDemoVault(vault: string): boolean {
  try {
    return localStorage.getItem(KEY(vault)) === "1";
  } catch {
    return false;
  }
}
