/**
 * x402 Escrow Client
 *
 * Unified escrow scheme that handles both session creation and usage.
 * - First call: Creates session with wallet signature (EIP-712)
 * - Subsequent calls: Uses stored session token (no signature needed)
 *
 * @example Simple (recommended)
 * ```typescript
 * import { createEscrowFetch } from '@x402/escrow/client';
 *
 * const { fetch: escrowFetch, scheme, x402 } = createEscrowFetch(walletClient);
 * const response = await escrowFetch('https://api.example.com/premium');
 *
 * // Add hooks (user has control)
 * x402.onAfterPaymentCreation(async (ctx) => {
 *   console.log('Payment created:', ctx.paymentPayload);
 * });
 * ```
 *
 * @example With custom fetch
 * ```typescript
 * const { fetch: escrowFetch } = createEscrowFetch(walletClient, {
 *   fetch: ky,  // Use ky, undici, node-fetch, etc.
 * });
 * ```
 *
 * @example Fully composable (manual setup)
 * ```typescript
 * import { x402Client } from '@x402/core/client';
 * import { wrapFetchWithPayment } from '@x402/fetch';
 * import { EscrowScheme, withSessionExtraction } from '@x402/escrow/client';
 *
 * const escrowScheme = new EscrowScheme(walletClient);
 * const x402 = new x402Client()
 *   .register('eip155:84532', escrowScheme)
 *   .onAfterPaymentCreation(ctx => console.log('Payment:', ctx));
 * const paidFetch = wrapFetchWithPayment(fetch, x402);
 * const escrowFetch = withSessionExtraction(paidFetch, escrowScheme);
 * ```
 */

// Simple API (recommended)
export {
  createEscrowFetch,
  type EscrowFetchResult,
  type CreateEscrowFetchOptions,
} from './session-wrapper';

// Core scheme (for advanced use with x402Client)
export { EscrowScheme, type EscrowSchemeOptions } from './escrow';

// Session wrappers for x402 integration
export { withSessionExtraction, withAxiosSessionExtraction } from './session-wrapper';

// Components (for advanced customization)
export { SessionManager, type SessionManagerOptions, type StoredSession } from './session-manager';
export {
  type SessionStorage,
  InMemoryStorage,
  BrowserLocalStorage,
  createStorage,
} from './storage';
export {
  signERC3009,
  computeEscrowNonce,
  type EIP712Domain,
  type ERC3009Authorization,
} from './eip712';

// Re-export version constant
export { X402_VERSION } from '../../types';
