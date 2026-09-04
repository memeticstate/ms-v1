import type { EntitlementProfile } from "@/lib/entitlements/model";
import type { TokenAdapterStatus } from "@/lib/entitlements/token-adapter";
import type { PremiumAccess } from "@/lib/entitlements/token-gate";

export type PassportResponse = {
  authenticated: false;
  signInPath: string;
  publicGuarantees: string[];
} | {
  authenticated: true;
  account: {
    displayName: string;
    email: string;
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
