export const ROBINHOOD_CHAIN_ID = 4663;
export const WALLET_CHALLENGE_TTL_SECONDS = 5 * 60;

export function walletChallengeExpiry(nowSeconds = Math.floor(Date.now() / 1_000)) {
  return nowSeconds + WALLET_CHALLENGE_TTL_SECONDS;
}

export function buildWalletLinkMessage(input: {
  accountId: string;
  walletAddress: string;
  challengeId: string;
  origin: string;
  issuedAt: number;
  expiresAt: number;
}) {
  return [
    "Memetic State Research Passport",
    "",
    "Sign this message to prove wallet ownership. This does not submit a transaction or spend funds.",
    "",
    `Account: ${input.accountId}`,
    `Wallet: ${input.walletAddress}`,
    `Chain ID: ${ROBINHOOD_CHAIN_ID}`,
    `Challenge: ${input.challengeId}`,
    `URI: ${input.origin}`,
    `Issued at: ${new Date(input.issuedAt * 1_000).toISOString()}`,
    `Expires at: ${new Date(input.expiresAt * 1_000).toISOString()}`,
  ].join("\n");
}
