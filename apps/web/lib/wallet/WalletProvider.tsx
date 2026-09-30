"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  type Address,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { monadTestnet } from "@covenant/shared";
import { postDemoSession, RateLimitError, type DemoSession, type DemoRole } from "@/lib/api";

export type { DemoSession, DemoRole };

const CHAIN_ID = 10143;
const CHAIN_HEX = "0x279f"; // 10143
const BURNER_KEY = "covenant.burner.pk.v1";

export type WalletMode = "none" | "injected" | "burner";

interface WalletContextValue {
  mode: WalletMode;
  address: Address | null;
  chainId: number | null;
  isMonad: boolean;
  ready: boolean;
  connecting: boolean;
  /** Connect an injected wallet (MetaMask) and ensure Monad testnet. */
  connectInjected: () => Promise<void>;
  /** Ensure the injected wallet is on Monad testnet (add + switch). */
  ensureMonad: () => Promise<void>;
  /** Generate/reuse the in-browser demo burner and fund it via the backend. */
  startDemo: (role?: DemoRole) => Promise<DemoSession>;
  /** Wipe the demo burner (a fresh key is made on next startDemo). */
  resetDemoWallet: () => void;
  /** Export the demo private key (testnet only). Returns null if no burner. */
  exportDemoKey: () => string | null;
  disconnect: () => void;
  /** viem wallet client for the active signer, or null. */
  getWalletClient: () => WalletClient | null;
  publicClient: PublicClient;
}

const WalletContext = createContext<WalletContextValue | null>(null);

// A single shared read client (RPC from env or the shared chain default).
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || monadTestnet.rpcUrls.default.http[0];
const sharedPublicClient = createPublicClient({
  chain: monadTestnet,
  transport: http(RPC_URL),
}) as PublicClient;

function getEthereum(): any | null {
  if (typeof window === "undefined") return null;
  return (window as any).ethereum ?? null;
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<WalletMode>("none");
  const [address, setAddress] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const burnerPk = useRef<`0x${string}` | null>(null);

  // Restore a persisted burner (primary demo path) on mount.
  useEffect(() => {
    try {
      const pk = window.localStorage.getItem(BURNER_KEY) as `0x${string}` | null;
      if (pk) {
        burnerPk.current = pk;
        const acct = privateKeyToAccount(pk);
        setMode("burner");
        setAddress(acct.address);
        setChainId(CHAIN_ID);
      }
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  // Track injected account/chain changes.
  useEffect(() => {
    const eth = getEthereum();
    if (!eth?.on) return;
    const onAccounts = (accs: string[]) => {
      if (mode !== "injected") return;
      if (!accs?.length) {
        setMode("none");
        setAddress(null);
      } else {
        setAddress(accs[0] as Address);
      }
    };
    const onChain = (cid: string) => {
      if (mode === "injected") setChainId(parseInt(cid, 16));
    };
    eth.on("accountsChanged", onAccounts);
    eth.on("chainChanged", onChain);
    return () => {
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, [mode]);

  const ensureMonad = useCallback(async () => {
    const eth = getEthereum();
    if (!eth) throw new Error("No injected wallet found.");
    try {
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_HEX }] });
    } catch (err: any) {
      // 4902 = chain not added
      if (err?.code === 4902 || /Unrecognized chain/i.test(err?.message ?? "")) {
        await eth.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: CHAIN_HEX,
              chainName: "Monad Testnet",
              nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
              rpcUrls: [RPC_URL],
              blockExplorerUrls: ["https://testnet.monadexplorer.com"],
            },
          ],
        });
      } else if (err?.code !== 4001) {
        throw err;
      }
    }
    setChainId(CHAIN_ID);
  }, []);

  const connectInjected = useCallback(async () => {
    const eth = getEthereum();
    if (!eth) throw new Error("No injected wallet found. Install MetaMask or use the demo wallet.");
    setConnecting(true);
    try {
      const accs: string[] = await eth.request({ method: "eth_requestAccounts" });
      if (!accs?.length) throw new Error("No account authorized.");
      await ensureMonad();
      // Clear burner so injected becomes the active signer.
      burnerPk.current = null;
      setMode("injected");
      setAddress(accs[0] as Address);
      setChainId(CHAIN_ID);
    } finally {
      setConnecting(false);
    }
  }, [ensureMonad]);

  const startDemo = useCallback(async (role: DemoRole = "issuer"): Promise<DemoSession> => {
    setConnecting(true);
    try {
      let pk = burnerPk.current;
      if (!pk) {
        pk = generatePrivateKey();
        burnerPk.current = pk;
        try {
          window.localStorage.setItem(BURNER_KEY, pk);
        } catch {
          /* ignore */
        }
      }
      const acct = privateKeyToAccount(pk);
      // Fund + provision via the backend (it never receives the key).
      let session: DemoSession = {};
      try {
        session = await postDemoSession(acct.address, role);
      } catch (e: unknown) {
        if (e instanceof RateLimitError) throw e;
        // network hiccup: still set the wallet; funding can be retried
      }
      setMode("burner");
      setAddress(acct.address);
      setChainId(CHAIN_ID);
      return session;
    } finally {
      setConnecting(false);
    }
  }, []);

  const resetDemoWallet = useCallback(() => {
    try {
      window.localStorage.removeItem(BURNER_KEY);
    } catch {
      /* ignore */
    }
    burnerPk.current = null;
    setMode((m) => (m === "burner" ? "none" : m));
    setAddress((a) => (mode === "burner" ? null : a));
  }, [mode]);

  const exportDemoKey = useCallback(() => burnerPk.current, []);

  const disconnect = useCallback(() => {
    setMode("none");
    setAddress(null);
    setChainId(null);
    // keep the burner key in storage so the demo wallet can be reused
  }, []);

  const getWalletClient = useCallback((): WalletClient | null => {
    if (mode === "burner" && burnerPk.current) {
      return createWalletClient({
        account: privateKeyToAccount(burnerPk.current),
        chain: monadTestnet,
        transport: http(RPC_URL),
      });
    }
    if (mode === "injected") {
      const eth = getEthereum();
      if (!eth || !address) return null;
      return createWalletClient({
        account: address,
        chain: monadTestnet,
        transport: custom(eth),
      });
    }
    return null;
  }, [mode, address]);

  const value = useMemo<WalletContextValue>(
    () => ({
      mode,
      address,
      chainId,
      isMonad: chainId === CHAIN_ID,
      ready,
      connecting,
      connectInjected,
      ensureMonad,
      startDemo,
      resetDemoWallet,
      exportDemoKey,
      disconnect,
      getWalletClient,
      publicClient: sharedPublicClient,
    }),
    [
      mode,
      address,
      chainId,
      ready,
      connecting,
      connectInjected,
      ensureMonad,
      startDemo,
      resetDemoWallet,
      exportDemoKey,
      disconnect,
      getWalletClient,
    ],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}
