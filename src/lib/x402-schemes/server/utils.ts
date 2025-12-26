/**
 * Shared utilities for x402 server schemes
 */

import type { Address } from 'viem';

// =============================================================================
// Types
// =============================================================================

export type Network = `${string}:${string}`;
export type Money = string | number;
export type AssetAmount = {
  asset: string;
  amount: string;
  extra?: Record<string, unknown>;
};
export type Price = Money | AssetAmount;

// =============================================================================
// Price Parsing
// =============================================================================

/**
 * Parse a user-friendly price to USDC amount
 *
 * Supports:
 * - Number: 0.10 -> 100000 (assuming USD)
 * - String: "$0.10", "0.10" -> 100000
 * - AssetAmount: { amount: "100000", asset: "0x..." } -> passthrough
 *
 * @param price - User-friendly price input
 * @param usdcAddress - USDC token address (optional, can come from facilitator)
 * @param decimals - Token decimals (default: 6 for USDC)
 */
export function parseUsdcPrice(
  price: Price,
  usdcAddress?: Address,
  decimals: number = 6
): AssetAmount {
  // Default to empty - will be populated from facilitator's supportedKind.extra.asset
  const defaultAsset = usdcAddress || ('' as Address);

  // If already an AssetAmount, validate and return
  if (typeof price === 'object' && 'amount' in price && 'asset' in price) {
    return {
      amount: price.amount,
      asset: price.asset || defaultAsset,
      extra: price.extra,
    };
  }

  // Parse numeric/string price as USD
  let usdAmount: number;
  if (typeof price === 'number') {
    usdAmount = price;
  } else {
    // Remove $ prefix if present
    const cleanPrice = price.toString().replace(/^\$/, '').trim();
    usdAmount = parseFloat(cleanPrice);
  }

  if (isNaN(usdAmount) || usdAmount < 0) {
    throw new Error(`Invalid price: ${price}`);
  }

  // Convert to USDC smallest units
  const multiplier = Math.pow(10, decimals);
  const amount = Math.round(usdAmount * multiplier).toString();

  return {
    amount,
    asset: defaultAsset,
  };
}
