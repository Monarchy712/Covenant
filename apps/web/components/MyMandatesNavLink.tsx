"use client";

import Link from "next/link";
import { useWallet } from "@/lib/wallet/WalletProvider";

/** Nav link to the issuer's mandate list. Shown only when a wallet is connected,
 *  since "My mandates" is meaningless without an address to filter by. */
export function MyMandatesNavLink({ className }: { className?: string }) {
  const { mode, address } = useWallet();
  if (mode === "none" || !address) return null;
  return (
    <Link href="/app" className={className}>
      My mandates
    </Link>
  );
}
