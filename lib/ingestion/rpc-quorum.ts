export const ROBINHOOD_RPC_MINIMUM_QUORUM = 2;
export const ROBINHOOD_RPC_TARGET_QUORUM = 3;

export function assessRobinhoodRpcQuorum(input: {
  agreedProviders: number;
  multiplierVerified?: number;
  multiplierTotal?: number;
}) {
  const multiplierTotal = Math.max(0, input.multiplierTotal ?? 0);
  const multiplierVerified = Math.max(0, input.multiplierVerified ?? multiplierTotal);
  const multiplierMismatch = multiplierVerified < multiplierTotal;
  return {
    accepted: input.agreedProviders >= ROBINHOOD_RPC_MINIMUM_QUORUM,
    degraded: input.agreedProviders < ROBINHOOD_RPC_TARGET_QUORUM || multiplierMismatch,
    multiplierMismatch,
  };
}
