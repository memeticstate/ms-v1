import type { EntitlementProfile } from "@/lib/entitlements/model";
import type { TokenAdapterStatus } from "@/lib/entitlements/token-adapter";
import type { PremiumAccess } from "@/lib/entitlements/token-gate";
import type { MemeticAuthProvider } from "@/lib/auth/config";

export type PassportResponse = {
  authenticated: false;
  authProvider: MemeticAuthProvider;
  signInPath: string | null;
  error?: string;
  publicGuarantees: string[];
} | {
  authenticated: true;
  authProvider: MemeticAuthProvider;
  account: {
    displayName: string;
    email: string | null;
  };
  wallets: Array<{
    address: string;
    chainId: number;
    primary: boolean;
    verifiedAt: string;
  }>;
  entitlements: EntitlementProfile;
  tokenAdapter: TokenAdapterStatus;
  premiumAccess: PremiumAccess;
  publicGuarantees: string[];
};
