// =============================================================================
// x402 v2 Core Types (Scheme-Agnostic)
// =============================================================================
// Reference: https://github.com/coinbase/x402/blob/main/specs/x402-specification-v2.md

/** Current x402 protocol version */
export const X402_VERSION = 2;

/** Network identifier in CAIP-2 format (e.g., "eip155:8453" for Base) */
export type Network = `${string}:${string}`;

/** ResourceInfo - describes the protected resource */
export interface ResourceInfo {
  url: string;
  description: string;
  mimeType: string;
}

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
 * PaymentRequired - Server → Client (in 402 response body)
 * Contains multiple payment options in `accepts` array
 */
export interface PaymentRequired {
  x402Version: number;
  error?: string;
  resource?: ResourceInfo;
  accepts: PaymentRequirements[];
  extensions?: Record<string, unknown>;
}

/**
 * PaymentPayload - Client → Server (in Payment-Signature header)
 * Contains the single chosen payment option in `accepted`
 */
export interface PaymentPayload<
  TAccepted = PaymentRequirements,
  TPayload = Record<string, unknown>,
> {
  x402Version: number;
  resource?: ResourceInfo;
  accepted: TAccepted;
  payload: TPayload;
  extensions?: Record<string, unknown>;
}

/** x402 Facilitator verify response */
export interface VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
}

/**
 * x402 Facilitator settle response (JSON body)
 *
 * Resource server middleware encodes this into PAYMENT-RESPONSE header.
 * Session data is included in the same header (no separate X-SESSION header).
 */
export interface SettleResponse {
  // Core response (in PAYMENT-RESPONSE header)
  success: boolean;
  errorReason?: string;
  payer?: string;
  transaction: string;
  network: string;
  // Session data (in PAYMENT-RESPONSE.session) - escrow and session schemes
  session?: {
    id: string;
    balance: string;
    token?: string; // Only on escrow (new session) - in PAYMENT-RESPONSE.session.token
    expiresAt?: number; // Only on escrow (new session) - in PAYMENT-RESPONSE.session.expiresAt
  };
}

// =============================================================================
// Shared Components (Reusable across schemes)
// =============================================================================

/** ERC-3009 authorization data */
export interface ERC3009Authorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

/** Session parameters for escrow-based schemes */
export interface SessionParams {
  salt: string;
  authorizationExpiry: number;
  refundExpiry: number;
}

/** Escrow contract configuration */
export interface EscrowExtra {
  name: string;
  version: string;
  escrowContract: string;
  facilitator: string;
  tokenCollector: string;
  [key: string]: unknown;
}

// =============================================================================
// SCHEME: exact
// Direct one-time payment via ERC-3009 transferWithAuthorization (no escrow)
// =============================================================================

/** Server advertises exact in 402 accepts[] */
export interface ExactRequirements extends PaymentRequirements {
  scheme: 'exact';
  extra: {
    name: string; // Token name for EIP-712 domain
    version: string; // Token version for EIP-712 domain
    [key: string]: unknown;
  };
}

/** Client sends exact payment */
export type ExactAccepted = ExactRequirements;

export interface ExactPayloadData {
  signature: string;
  authorization: ERC3009Authorization;
}

export type ExactPayload = PaymentPayload<ExactAccepted, ExactPayloadData>;

// =============================================================================
// SCHEME: escrow
// Creates session with deposit AND charges for current request
// =============================================================================

/** Server advertises escrow in 402 accepts[] */
export interface EscrowRequirements extends PaymentRequirements {
  scheme: 'escrow';
  extra: EscrowExtra & {
    minDeposit: string;
    maxDeposit: string;
  };
}

/** Client sends escrow payment */
export type EscrowAccepted = EscrowRequirements;

export interface EscrowPayloadData {
  signature: string;
  authorization: ERC3009Authorization; // value = deposit amount
  sessionParams: SessionParams;
  requestId: string; // For the first charge from the session
}

export type EscrowPayload = PaymentPayload<EscrowAccepted, EscrowPayloadData>;

// =============================================================================
// SCHEME: session
// Uses existing session - NO signature required
// =============================================================================

/**
 * Server advertises session in 402 accepts[]
 * Note: No sessionId here - server just says "I accept session payments"
 */
export interface SessionRequirements {
  scheme: 'session';
  network: Network;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
}

/**
 * Client provides sessionId in accepted
 * The sessionId comes from client's storage (saved from previous escrow)
 */
export interface SessionAccepted {
  scheme: 'session';
  network: Network;
  sessionId: string; // Client provides this!
}

export interface SessionPayloadData {
  sessionToken: string; // Secret token received when session was created
  requestId: string;
  amount: string;
}

export type SessionPayload = PaymentPayload<SessionAccepted, SessionPayloadData>;

// =============================================================================
// SCHEME: escrow (unified) - Merged session creation and usage
// =============================================================================

/**
 * Session CREATION payload - has signature + authorization
 * Used when client creates a new session (wallet signature required)
 */
export interface EscrowSessionCreationPayload {
  signature: string;
  authorization: ERC3009Authorization;
  sessionParams: SessionParams;
  requestId: string;
}

/**
 * Session USAGE payload - has nested session object
 * Used when client uses an existing session (no signature needed)
 */
export interface EscrowSessionUsagePayload {
  session: {
    id: string; // Session ID
    token: string; // Session secret
  };
  amount: string; // Debit amount
  requestId: string; // Idempotency key
}

/**
 * Unified escrow payload - discriminated union
 * Detection: 'signature' in payload → creation, 'session' in payload → usage
 */
export type EscrowUnifiedPayloadData = EscrowSessionCreationPayload | EscrowSessionUsagePayload;

/**
 * Unified escrow payload (full wrapper)
 * Both creation and usage use scheme: 'escrow'
 */
export type EscrowUnifiedPayload = PaymentPayload<EscrowAccepted, EscrowUnifiedPayloadData>;

// =============================================================================
// Type Guards
// =============================================================================

export function isExact(p: { accepted: { scheme: string } }): p is ExactPayload {
  return p.accepted.scheme === 'exact';
}

export function isEscrow(p: { accepted: { scheme: string } }): p is EscrowPayload {
  return p.accepted.scheme === 'escrow';
}

export function isSession(p: { accepted: { scheme: string } }): p is SessionPayload {
  return p.accepted.scheme === 'session';
}

/**
 * Type guard: Is this a session CREATION payload?
 * Returns true if payload has signature + authorization + sessionParams (wallet signed)
 */
export function isEscrowCreationPayload(payload: unknown): payload is EscrowSessionCreationPayload {
  if (typeof payload !== 'object' || payload === null) return false;
  const p = payload as Record<string, unknown>;

  // Must have signature (string)
  if (typeof p.signature !== 'string') return false;

  // Must have authorization object with required fields
  if (typeof p.authorization !== 'object' || p.authorization === null) return false;
  const auth = p.authorization as Record<string, unknown>;
  if (typeof auth.from !== 'string' || typeof auth.to !== 'string') return false;

  // Must have sessionParams object
  if (typeof p.sessionParams !== 'object' || p.sessionParams === null) return false;

  return true;
}

/**
 * Type guard: Is this a session USAGE payload?
 * Returns true if payload has nested session object with id + token (no signature)
 */
export function isEscrowUsagePayload(payload: unknown): payload is EscrowSessionUsagePayload {
  if (typeof payload !== 'object' || payload === null) return false;
  const p = payload as Record<string, unknown>;

  // Must have session object
  if (typeof p.session !== 'object' || p.session === null) return false;
  const session = p.session as Record<string, unknown>;

  // Session must have id and token (both strings)
  if (typeof session.id !== 'string' || typeof session.token !== 'string') return false;

  return true;
}

// =============================================================================
// x402 Headers (Resource Server ↔ Client)
// =============================================================================

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
  /** Session data (escrow scheme) - returned by facilitator in SettleResponse */
  session?: {
    id: string;
    balance: string;
    token?: string;
    expiresAt?: number;
  };
  /** Payment requirements that were fulfilled */
  requirements?: PaymentRequirements;
}

// =============================================================================
// Header Helpers (for Resource Server Middleware)
// =============================================================================

/**
 * Base64 encode (works in both browser and Node.js)
 * Handles UTF-8 encoding properly for non-ASCII characters.
 */
export function toBase64(str: string): string {
  try {
    if (typeof btoa !== 'undefined') {
      // btoa only handles Latin1, use TextEncoder for UTF-8 safety
      return btoa(unescape(encodeURIComponent(str)));
    }
    return Buffer.from(str, 'utf-8').toString('base64');
  } catch {
    // Fallback for edge cases
    return Buffer.from(str, 'utf-8').toString('base64');
  }
}

/**
 * Base64 decode (works in both browser and Node.js)
 * Handles UTF-8 decoding properly for non-ASCII characters.
 */
export function fromBase64(str: string): string {
  try {
    if (typeof atob !== 'undefined') {
      return decodeURIComponent(escape(atob(str)));
    }
    return Buffer.from(str, 'base64').toString('utf-8');
  } catch {
    // Fallback for edge cases
    return Buffer.from(str, 'base64').toString('utf-8');
  }
}

/**
 * Generate a unique request ID (crypto.randomUUID with fallback)
 * Works in all JS environments including older browsers and Node.js
 */
export function generateRequestId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback: timestamp + random hex
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Generate random bytes (crypto.getRandomValues with fallback)
 * Works in all JS environments including older browsers and Node.js
 */
export function generateRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    // Fallback: Math.random (less secure, but works everywhere)
    for (let i = 0; i < length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return bytes;
}

/**
 * Parse PAYMENT-RESPONSE header.
 * The header contains the full SettleResponse including session data.
 */
export function parsePaymentResponseHeader(header: string): PaymentResponseData | null {
  try {
    return JSON.parse(fromBase64(header));
  } catch {
    return null;
  }
}

// =============================================================================
// Session Management Types
// =============================================================================

export interface SessionBalance {
  authorized: string;
  captured: string;
  pending: string;
  available: string;
}

export interface SessionInfo {
  sessionId: string;
  network: string;
  payer: string;
  receiver: string;
  balance: SessionBalance;
  authorizationExpiry: number;
  refundExpiry: number;
  status: 'active' | 'expired' | 'voided' | 'captured';
}
