/**
 * Shared Constants
 */

// Zero address constant
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

// ERC20 ABI (minimal for balance checks)
export const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;

// Request timeouts
export const VERIFY_TIMEOUT_MS = 30_000; // 30 seconds
export const SETTLE_TIMEOUT_MS = 60_000; // 60 seconds (longer for on-chain ops)
export const RECLAIM_TIMEOUT_MS = 90_000; // 90 seconds (reclaim has multiple on-chain ops)

// TIER 3: Sync capture threshold
export const TIER3_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

// Session defaults (in seconds)
export const DEFAULT_SESSION_DURATION = 3600; // 1 hour
export const DEFAULT_REFUND_WINDOW = 86400; // 24 hours
