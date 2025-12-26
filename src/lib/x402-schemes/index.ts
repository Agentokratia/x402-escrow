/**
 * x402 Escrow Schemes (v2) - Unified
 *
 * Drop-in payment schemes for x402 protocol. Works exactly like official @x402/evm.
 *
 * The unified escrow scheme handles both:
 * - Session CREATION: Client sends signature + authorization (wallet signed)
 * - Session USAGE: Client sends session.id + session.token (no signature)
 *
 * ## Client Usage (Apps/Agents paying for APIs)
 *
 * ### Simple (recommended)
 * ```typescript
 * import { createEscrowFetch } from './lib/x402-schemes/client';
 *
 * const { fetch: escrowFetch, scheme } = createEscrowFetch(walletClient);
 * const response = await escrowFetch('https://api.example.com/premium');
 * ```
 *
 * ### Advanced (with x402Client hooks)
 * ```typescript
 * import { x402Client } from '@x402/core/client';
 * import { wrapFetchWithPayment } from '@x402/fetch';
 * import { EscrowScheme, withSessionExtraction } from './lib/x402-schemes/client';
 *
 * const escrowScheme = new EscrowScheme(walletClient);
 * const x402 = new x402Client().register('eip155:84532', escrowScheme);
 * const paidFetch = wrapFetchWithPayment(fetch, x402);
 * const escrowFetch = withSessionExtraction(paidFetch, escrowScheme);
 * ```
 *
 * ## Server Usage (APIs accepting payments)
 *
 * Config is auto-discovered from facilitator - no manual config needed!
 *
 * ### Next.js (with @x402/next)
 * ```typescript
 * import { paymentProxy } from '@x402/next';
 * import { x402ResourceServer, HTTPFacilitatorClient } from '@x402/core/server';
 * import { EscrowScheme } from '@x402/escrow/server';
 *
 * const facilitator = new HTTPFacilitatorClient({ url: 'https://facilitator.agentokratia.com' });
 * const server = new x402ResourceServer(facilitator)
 *   .register('eip155:84532', new EscrowScheme());  // No config needed!
 *
 * // Protect routes with middleware
 * export const proxy = paymentProxy({
 *   '/api/premium': {
 *     accepts: { scheme: 'escrow', network: 'eip155:84532', payTo: ownerAddress, price: '$0.01' },
 *   },
 * }, server);
 * ```
 *
 * ### Hono/Express (with @x402/hono or @x402/express)
 * ```typescript
 * import { paymentMiddleware } from '@x402/express';
 *
 * app.use(paymentMiddleware({
 *   'GET /api/data': { accepts: { scheme: 'escrow', network: 'eip155:84532', payTo: ownerAddress, price: '$0.01' } },
 * }, server));
 * ```
 */

// =============================================================================
// Client Schemes (for x402Client)
// =============================================================================
export {
  // Simple API (recommended)
  createEscrowFetch,
  type EscrowFetchResult,
  // Core scheme
  EscrowScheme,
  type EscrowSchemeOptions,
  type StoredSession,
  // Session wrappers
  withSessionExtraction,
  withAxiosSessionExtraction,
} from './client';

// =============================================================================
// Server Schemes (for x402ResourceServer)
// =============================================================================
export {
  EscrowScheme as EscrowServerScheme,
  type EscrowSchemeConfig as EscrowServerSchemeConfig,
} from './server';

// =============================================================================
// Header Utilities (for custom middleware)
// =============================================================================
export {
  X402_HEADERS,
  parsePaymentResponseHeader,
  type PaymentResponseData,
  type SettleResponse,
} from '../types';
