/**
 * x402 Protocol Types for @agentokratia/x402-escrow
 *
 * Subset of types needed for the escrow scheme.
 */

/** Current x402 protocol version */
export const X402_VERSION = 2;

/** Network identifier in CAIP-2 format (e.g., "eip155:8453" for Base) */
export type Network = `${string}:${string}`;

/**
 * PaymentRequirements - defines a single payment option
 * Base interface that each scheme extends
 */
export interface PaymentRequirements {
  scheme: string;
  network: Network;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: Record<string, unknown>;
}

/**
 * x402 Facilitator settle response (JSON body)
 */
export interface SettleResponse {
  success: boolean;
  errorReason?: string;
  payer?: string;
  transaction: string;
  network: string;
  session?: {
    id: string;
    balance: string;
    token?: string;
    expiresAt?: number;
  };
}

/** Header name constants (x402 v2) */
export const X402_HEADERS = {
  /** Server → Client: Payment options (402 response) - base64 JSON */
  PAYMENT_REQUIRED: 'PAYMENT-REQUIRED',
  /** Client → Server: Payment payload - base64 JSON */
  PAYMENT_SIGNATURE: 'PAYMENT-SIGNATURE',
  /** Server → Client: Settlement result - base64 JSON (includes session data) */
  PAYMENT_RESPONSE: 'PAYMENT-RESPONSE',
} as const;

/** PAYMENT-RESPONSE header data (all schemes) */
export interface PaymentResponseData {
  success: boolean;
  transaction: string;
  network: string;
  payer?: string;
  receiver?: string;
  errorReason?: string;
  session?: {
    id: string;
    balance: string;
    token?: string;
    expiresAt?: number;
  };
  requirements?: PaymentRequirements;
}

/**
 * Base64 encode (works in both browser and Node.js)
 */
export function toBase64(str: string): string {
  try {
    if (typeof btoa !== 'undefined') {
      return btoa(unescape(encodeURIComponent(str)));
    }
    return Buffer.from(str, 'utf-8').toString('base64');
  } catch {
    return Buffer.from(str, 'utf-8').toString('base64');
  }
}

/**
 * Base64 decode (works in both browser and Node.js)
 */
export function fromBase64(str: string): string {
  try {
    if (typeof atob !== 'undefined') {
      return decodeURIComponent(escape(atob(str)));
    }
    return Buffer.from(str, 'base64').toString('utf-8');
  } catch {
    return Buffer.from(str, 'base64').toString('utf-8');
  }
}

/**
 * Generate a unique request ID
 */
export function generateRequestId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Generate random bytes
 */
export function generateRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return bytes;
}

/**
 * Parse PAYMENT-RESPONSE header.
 */
export function parsePaymentResponseHeader(header: string): PaymentResponseData | null {
  try {
    return JSON.parse(fromBase64(header));
  } catch {
    return null;
  }
}
