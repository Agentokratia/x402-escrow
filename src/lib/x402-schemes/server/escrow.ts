/**
 * Escrow Server Scheme
 *
 * Server-side scheme for x402 escrow payments.
 * Config is auto-discovered from facilitator - no manual config needed!
 *
 * @example Standard x402 pattern
 * ```typescript
 * import { x402ResourceServer, HTTPFacilitatorClient } from '@x402/core/server';
 * import { paymentMiddleware } from '@x402/express';
 * import { EscrowScheme } from '@x402/escrow/server';
 *
 * const server = new x402ResourceServer(facilitator)
 *   .register('eip155:84532', new EscrowScheme());  // No config needed!
 *
 * app.use(paymentMiddleware({
 *   'GET /api/premium': {
 *     accepts: {
 *       scheme: 'escrow',
 *       price: '$0.01',
 *       network: 'eip155:84532',
 *       payTo: ownerAddress,
 *     },
 *   },
 * }, server));
 * ```
 */

import { parseUsdcPrice, type Network, type Price, type AssetAmount } from './utils';

interface PaymentRequirements {
  scheme: string;
  network: Network;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: Record<string, unknown>;
}

interface SupportedKind {
  x402Version: number;
  scheme: string;
  network: Network;
  extra?: Record<string, unknown>;
}

/**
 * SchemeNetworkServer interface from @x402/core
 */
interface SchemeNetworkServer {
  readonly scheme: string;
  parsePrice(price: Price, network: Network): Promise<AssetAmount>;
  enhancePaymentRequirements(
    paymentRequirements: PaymentRequirements,
    supportedKind: SupportedKind,
    facilitatorExtensions: string[]
  ): Promise<PaymentRequirements>;
}

/** Optional overrides for escrow config (auto-discovered from facilitator) */
export interface EscrowSchemeConfig {
  /** Override USDC decimals (default: 6) */
  usdcDecimals?: number;
}

/**
 * Escrow Server Scheme
 *
 * Config is auto-discovered from facilitator's /supported endpoint.
 * The `enhancePaymentRequirements` method receives `supportedKind.extra`
 * with all escrow config (escrowContract, facilitator, tokenCollector, etc).
 *
 * @example
 * ```typescript
 * const server = new x402ResourceServer(facilitator)
 *   .register('eip155:84532', new EscrowScheme());
 * ```
 */
export class EscrowScheme implements SchemeNetworkServer {
  readonly scheme = 'escrow';
  private readonly usdcDecimals: number;

  constructor(config?: EscrowSchemeConfig) {
    this.usdcDecimals = config?.usdcDecimals ?? 6;
  }

  /**
   * Parse a user-friendly price to USDC amount
   *
   * Supports:
   * - Number: 0.10 -> 100000 (assuming USD)
   * - String: "$0.10", "0.10" -> 100000
   * - AssetAmount: { amount: "100000", asset: "0x..." } -> passthrough
   */
  async parsePrice(price: Price, _network: Network): Promise<AssetAmount> {
    // Asset address comes from facilitator's supportedKind.extra.asset
    // We use empty string here as placeholder - it gets set in enhancePaymentRequirements
    return parseUsdcPrice(price, undefined, this.usdcDecimals);
  }

  /**
   * Enhance payment requirements with escrow-specific extra data.
   * Config comes from facilitator's supportedKind.extra.
   */
  async enhancePaymentRequirements(
    paymentRequirements: PaymentRequirements,
    supportedKind: SupportedKind,
    _facilitatorExtensions: string[]
  ): Promise<PaymentRequirements> {
    // All config comes from facilitator's supportedKind.extra:
    // - escrowContract, facilitator, tokenCollector
    // - minDeposit, maxDeposit
    // - name, version (ERC-3009 domain)
    // - asset (USDC address)
    const facilitatorExtra = supportedKind.extra || {};

    // Asset comes from facilitator if not set by parsePrice
    const asset = paymentRequirements.asset || (facilitatorExtra.asset as string) || '';

    return {
      ...paymentRequirements,
      asset,
      extra: {
        ...paymentRequirements.extra,
        ...facilitatorExtra,
      },
    };
  }
}

// Keep backward compatibility alias
export { EscrowScheme as EscrowServerScheme };
export type { EscrowSchemeConfig as EscrowServerSchemeConfig };
