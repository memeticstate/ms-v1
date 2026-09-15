"use client";

import { ROBINHOOD_EXPLORER } from "@/lib/robinhood-explorer";

import {
  PrivyProvider,
  useLinkAccount,
  useLogin,
  usePrivy,
} from "@privy-io/react-auth";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { defineChain } from "viem";

import { MEMETIC_PRIVY_APP_ID, ROBINHOOD_CHAIN_ID } from "@/lib/auth/config";

type AuthFlowState = "idle" | "pending" | "success" | "error";

type MemeticAuthContextValue = {
  ready: boolean;
  authenticated: boolean;
  identityVersion: string;
  loginState: AuthFlowState;
  walletLinkState: AuthFlowState;
  signIn: () => void;
  linkWallet: () => void;
  signOut: () => Promise<void>;
  authFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

const robinhoodChain = defineChain({
  id: ROBINHOOD_CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.mainnet.chain.robinhood.com"] },
  },
  blockExplorers: {
    default: { name: "Robinhood Etherscan", url: ROBINHOOD_EXPLORER },
  },
});

const MemeticAuthContext = createContext<MemeticAuthContextValue | null>(null);

// Browsing public evidence must not depend on wallet support. In an insecure
// context Privy cannot initialize; keep every authenticated action unavailable.
const unavailableAuth: MemeticAuthContextValue = {
  ready: false,
  authenticated: false,
  identityVersion: "anonymous:wallet-unavailable",
  loginState: "idle",
  walletLinkState: "idle",
  signIn: () => {},
  linkWallet: () => {},
  signOut: async () => {},
  authFetch: (input, init) => fetch(input, init),
};

function MemeticAuthBridge({ children }: { children: ReactNode }) {
  const { ready, authenticated, user, getAccessToken, logout } = usePrivy();
  const [loginState, setLoginState] = useState<AuthFlowState>("idle");
  const [walletLinkState, setWalletLinkState] = useState<AuthFlowState>("idle");
  const [revision, setRevision] = useState(0);
  const { login } = useLogin({
    onComplete: () => {
      setLoginState("success");
      setRevision((value) => value + 1);
    },
    onError: () => setLoginState("error"),
  });
  const { linkWallet } = useLinkAccount({
    onSuccess: () => {
      setWalletLinkState("success");
      setRevision((value) => value + 1);
    },
    onError: () => setWalletLinkState("error"),
  });

  const signIn = useCallback(() => {
    if (!ready) return;
    setLoginState("pending");
    login({ loginMethods: ["wallet", "email", "google"] });
  }, [login, ready]);

  const startWalletLink = useCallback(() => {
    if (!ready || !authenticated) return;
    setWalletLinkState("pending");
    linkWallet({ walletChainType: "ethereum-only" });
  }, [authenticated, linkWallet, ready]);

  const signOut = useCallback(async () => {
    await logout();
    setLoginState("idle");
    setWalletLinkState("idle");
    setRevision((value) => value + 1);
  }, [logout]);

  const authFetch = useCallback(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (ready && authenticated) {
      const token = await getAccessToken();
      if (token) headers.set("authorization", `Bearer ${token}`);
    }
    return fetch(input, { ...init, headers });
  }, [authenticated, getAccessToken, ready]);

  const identityVersion = useMemo(() => {
    const linked = user?.linkedAccounts.map((account) => {
      const address = "address" in account && typeof account.address === "string" ? account.address : "";
      return `${account.type}:${address}`;
    }).sort().join("|") ?? "";
    return `${authenticated}:${user?.id ?? "anonymous"}:${linked}:${revision}`;
  }, [authenticated, revision, user]);

  const value = useMemo<MemeticAuthContextValue>(() => ({
    ready,
    authenticated,
    identityVersion,
    loginState,
    walletLinkState,
    signIn,
    linkWallet: startWalletLink,
    signOut,
    authFetch,
  }), [
    authenticated,
    authFetch,
    identityVersion,
    loginState,
    ready,
    signIn,
    signOut,
    startWalletLink,
    walletLinkState,
  ]);

  return <MemeticAuthContext.Provider value={value}>{children}</MemeticAuthContext.Provider>;
}

export function MemeticAuthProvider({ children }: { children: ReactNode }) {
  const [secureContext, setSecureContext] = useState<boolean | null>(null);
  useEffect(() => setSecureContext(window.isSecureContext), []);
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID || MEMETIC_PRIVY_APP_ID;
  if (!secureContext) return <MemeticAuthContext.Provider value={unavailableAuth}>
    {secureContext === false ? <p role="status" className="border-b border-attention/20 bg-attention/5 px-4 py-2 text-center text-sm text-attention">Wallet sign-in requires a secure connection. <a className="underline" href="https://memeticstate.com">Open Memetic State over HTTPS</a> to connect.</p> : null}
    {children}
  </MemeticAuthContext.Provider>;
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["wallet", "email", "google"],
        appearance: {
          landingHeader: "Open your Research Passport",
          loginMessage: "Connect a wallet first, or continue with email or Google.",
          showWalletLoginFirst: true,
          walletChainType: "ethereum-only",
          walletList: ["robinhood_wallet", "detected_ethereum_wallets", "wallet_connect"],
        },
        defaultChain: robinhoodChain,
        supportedChains: [robinhoodChain],
        embeddedWallets: { ethereum: { createOnLogin: "off" } },
      }}
    >
      <MemeticAuthBridge>{children}</MemeticAuthBridge>
    </PrivyProvider>
  );
}

export function useMemeticAuth() {
  const value = useContext(MemeticAuthContext);
  if (!value) throw new Error("useMemeticAuth must be used inside MemeticAuthProvider");
  return value;
}
