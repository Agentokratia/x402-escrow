/**
 * Session Extraction Wrappers
 *
 * Thin wrappers that extract sessions from x402 responses and store them.
 *
 * @example Simple (recommended)
 * ```typescript
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
 * const escrowScheme = new EscrowScheme(walletClient);
 * const x402 = new x402Client().register('eip155:84532', escrowScheme);
 * const paidFetch = wrapFetchWithPayment(fetch, x402);
 * const escrowFetch = withSessionExtraction(paidFetch, escrowScheme);
 * ```
 */

import { isAddress, getAddress, type WalletClient } from 'viem';
import { x402Client } from '@x402/core/client';
import { wrapFetchWithPayment } from '@x402/fetch';
import { EscrowScheme, type EscrowSchemeOptions } from './escrow';
import { fromBase64 } from '../types';

// =============================================================================
// Types
// =============================================================================

type FetchLike = typeof globalThis.fetch;

/** Options for createEscrowFetch */
export interface CreateEscrowFetchOptions extends EscrowSchemeOptions {
  /** Custom fetch implementation (default: globalThis.fetch) */
  fetch?: FetchLike;
}

/** Result from createEscrowFetch */
export interface EscrowFetchResult {
  /** Fetch function with automatic payment + session handling */
  fetch: FetchLike;
  /** Access to underlying scheme for session management */
  scheme: EscrowScheme;
  /** Access to x402Client for adding hooks (onBeforePaymentCreation, etc.) */
  x402: x402Client;
}

// =============================================================================
// Convenience wrapper (Simple API)
// =============================================================================

/**
 * Creates a fetch function with automatic escrow payment and session handling.
 * This is the simplest way to integrate x402 escrow payments.
 *
 * @example Simple usage
 * ```typescript
 * const { fetch: escrowFetch, scheme, x402 } = createEscrowFetch(walletClient);
 * const response = await escrowFetch('https://api.example.com/premium');
 *
 * // Access sessions
 * scheme.sessions.getAll();
 * scheme.sessions.hasValid(receiverAddress, '10000');
 * ```
 *
 * @example With custom fetch and hooks
 * ```typescript
 * const { fetch: escrowFetch, x402 } = createEscrowFetch(walletClient, {
 *   fetch: customFetch, // Use ky, undici, node-fetch, etc.
 * });
 *
 * // Add hooks for user control
 * x402.onBeforePaymentCreation(async (ctx) => {
 *   console.log('About to pay:', ctx.paymentRequirements);
 * });
 * ```
 */
export function createEscrowFetch(
  walletClient: WalletClient,
  options?: CreateEscrowFetchOptions
): EscrowFetchResult {
  const scheme = new EscrowScheme(walletClient, options);
  const x402 = new x402Client().register(scheme.network, scheme);

  // Use custom fetch or default to globalThis.fetch
  const baseFetch = options?.fetch ?? globalThis.fetch;
  const paidFetch = wrapFetchWithPayment(baseFetch, x402) as FetchLike;

  return {
    fetch: withSessionExtraction(paidFetch, scheme),
    scheme,
    x402, // Expose for adding hooks
  };
}

// =============================================================================
// Core extraction logic (header-agnostic)
// =============================================================================

type HeaderGetter = (name: string) => string | null | undefined;

/**
 * Core session extraction - works with any header accessor.
 * Extracts session from PAYMENT-RESPONSE header (x402 standard).
 *
 * The facilitator returns session data in SettleResponse, which x402 encodes
 * into the PAYMENT-RESPONSE header as: { ...settleResponse, requirements }
 */
function extractSession(getHeader: HeaderGetter, escrowScheme: EscrowScheme): void {
  const paymentResponseHeader = getHeader('PAYMENT-RESPONSE') || getHeader('payment-response');
  if (!paymentResponseHeader) return;

  try {
    const data = JSON.parse(fromBase64(paymentResponseHeader));

    // Must have session id at minimum
    if (!data.session?.id) return;

    // Check for SESSION USAGE first (no token, just balance update)
    if (!data.session.token) {
      // SESSION USAGE: Update balance only (token already stored from creation)
      if (data.session.balance !== undefined) {
        escrowScheme.sessions.updateBalance(data.session.id, data.session.balance);
      }
      return;
    }

    // SESSION CREATION: Has token → Store new session
    // Receiver is in data.requirements.payTo or data.receiver
    const receiver = data.requirements?.payTo || data.receiver;
    if (!receiver) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[x402] Session missing receiver - cannot store');
      }
      return;
    }

    // Validate receiver address
    if (!isAddress(receiver)) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[x402] Invalid receiver address in session:', receiver);
      }
      return;
    }

    escrowScheme.sessions.store({
      sessionId: data.session.id,
      sessionToken: data.session.token,
      network: escrowScheme.network,
      payer: escrowScheme.address,
      receiver: getAddress(receiver),
      balance: data.session.balance || '0',
      authorizationExpiry: data.session.expiresAt || 0,
    });
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[x402] Failed to parse PAYMENT-RESPONSE:', error);
    }
  }
}

// =============================================================================
// Fetch wrapper (Advanced API)
// =============================================================================

/**
 * Wraps a paid fetch to automatically extract and store sessions.
 * Use with wrapFetchWithPayment from @x402/fetch.
 *
 * @example
 * ```typescript
 * const escrowScheme = new EscrowScheme(walletClient);
 * const x402 = new x402Client().register('eip155:84532', escrowScheme);
 * const paidFetch = wrapFetchWithPayment(fetch, x402);
 * const escrowFetch = withSessionExtraction(paidFetch, escrowScheme);
 *
 * const response = await escrowFetch('https://api.example.com/premium');
 * // Session automatically stored if present in response
 * ```
 */
export function withSessionExtraction(paidFetch: FetchLike, escrowScheme: EscrowScheme): FetchLike {
  return async (input, init) => {
    const response = await paidFetch(input, init);
    extractSession((name) => response.headers.get(name), escrowScheme);
    return response;
  };
}

// =============================================================================
// Axios wrapper
// =============================================================================

interface AxiosResponseLike {
  headers: Record<string, string | undefined>;
  [key: string]: unknown;
}

/**
 * Returns an Axios response interceptor that extracts and stores sessions.
 * Use with wrapAxiosWithPayment from @x402/axios.
 *
 * @example
 * ```typescript
 * const escrowScheme = new EscrowScheme(walletClient);
 * const x402 = new x402Client().register('eip155:84532', escrowScheme);
 * const paidAxios = wrapAxiosWithPayment(axios.create(), x402);
 * paidAxios.interceptors.response.use(withAxiosSessionExtraction(escrowScheme));
 *
 * const response = await paidAxios.get('https://api.example.com/premium');
 * // Session automatically stored if present in response
 * ```
 */
export function withAxiosSessionExtraction(escrowScheme: EscrowScheme) {
  return <T extends AxiosResponseLike>(response: T): T => {
    extractSession((name) => response.headers[name.toLowerCase()], escrowScheme);
    return response;
  };
}
