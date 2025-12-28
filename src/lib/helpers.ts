/**
 * Shared Helpers for x402 API
 */

import { createPublicClient, http, type Address, type Hex } from 'viem';
import { getNetworkFromString, type DbNetwork } from './db';
import { verifyERC3009Signature, parseAuthorization, type ERC3009PrimaryType } from './signature';
import { isNonceUsed } from './wallet';
import { ERC20_ABI, ZERO_ADDRESS } from './constants';
import type { PaymentInfo } from './escrow';

// =============================================================================
// Type Guards for Payload Discrimination
// =============================================================================

interface BasePayload {
  accepted: {
    scheme: string;
    network: string;
    asset: string;
    payTo: string;
    extra?: Record<string, unknown>;
  };
  payload: Record<string, unknown>;
}

export function isExactScheme(payload: BasePayload): boolean {
  return payload.accepted.scheme === 'exact';
}

export function isEscrowScheme(payload: BasePayload): boolean {
  return payload.accepted.scheme === 'escrow';
}

export function isSessionScheme(payload: BasePayload): boolean {
  return payload.accepted.scheme === 'session';
}

// =============================================================================
// Common Validation Result
// =============================================================================

export interface ValidationResult {
  valid: boolean;
  error?: string;
  network?: DbNetwork;
  payer?: string;
}

// =============================================================================
// Authorization Type
// =============================================================================

export interface Authorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

// =============================================================================
// Session Params Type
// =============================================================================

export interface SessionParams {
  salt: string;
  authorizationExpiry: number;
  refundExpiry: number;
}

// =============================================================================
// Common Validation Checks
// =============================================================================

interface CommonCheckParams {
  authorization: Authorization;
  signature: Hex;
  networkId: string;
  eip712Name?: string;
  eip712Version?: string;
  primaryType?: ERC3009PrimaryType;
}

/**
 * Validates common checks across all schemes:
 * - Network exists and is active
 * - EIP-712 signature is valid
 * - Time window is valid
 * - Nonce is not used
 * - Payer has sufficient balance
 */
export async function validateCommonChecks(params: CommonCheckParams): Promise<ValidationResult> {
  const { authorization, signature, networkId, eip712Name, eip712Version, primaryType } = params;
  const payer = authorization.from.toLowerCase();

  // 1. Validate network
  const network = await getNetworkFromString(networkId);
  if (!network) {
    return { valid: false, error: 'invalid_network', payer };
  }

  // 2. Verify EIP-712 signature
  const name = eip712Name || network.usdc_eip712_name;
  const version = eip712Version || network.usdc_eip712_version;

  const signatureResult = await verifyERC3009Signature(
    parseAuthorization(authorization),
    signature,
    {
      name,
      version,
      chainId: network.chain_id,
      verifyingContract: network.usdc_address as Address,
    },
    primaryType // Pass through to signature verification
  );

  if (!signatureResult.valid) {
    return { valid: false, error: 'invalid_signature', payer, network };
  }

  // 3. Validate time window
  const now = Math.floor(Date.now() / 1000);
  if (now < Number(authorization.validAfter)) {
    return { valid: false, error: 'authorization_not_yet_valid', payer, network };
  }
  if (now >= Number(authorization.validBefore)) {
    return { valid: false, error: 'authorization_expired', payer, network };
  }

  // 4. Check nonce not used
  const nonceUsed = await isNonceUsed(
    network.id,
    network.usdc_address as Address,
    authorization.from as Address,
    authorization.nonce as Hex
  );
  if (nonceUsed) {
    return { valid: false, error: 'nonce_already_used', payer, network };
  }

  // 5. Check payer balance
  const publicClient = createPublicClient({ transport: http(network.rpc_url) });
  const balance = await publicClient.readContract({
    address: network.usdc_address as Address,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [authorization.from as Address],
  });

  const paymentAmount = BigInt(authorization.value);
  if (balance < paymentAmount) {
    return { valid: false, error: 'insufficient_funds', payer, network };
  }

  return { valid: true, payer, network };
}

// =============================================================================
// PaymentInfo Builder
// =============================================================================

interface BuildPaymentInfoParams {
  facilitator: string;
  authorization: Authorization;
  payTo: string;
  asset: string;
  sessionParams: SessionParams;
}

/**
 * Builds PaymentInfo object from payload components.
 * Centralizes construction to avoid repetition.
 */
export function buildPaymentInfo(params: BuildPaymentInfoParams): PaymentInfo {
  const { facilitator, authorization, payTo, asset, sessionParams } = params;

  return {
    operator: facilitator,
    payer: authorization.from,
    receiver: payTo,
    token: asset,
    maxAmount: BigInt(authorization.value),
    preApprovalExpiry: Number(authorization.validBefore),
    authorizationExpiry: sessionParams.authorizationExpiry,
    refundExpiry: sessionParams.refundExpiry,
    minFeeBps: 0,
    maxFeeBps: 0,
    feeReceiver: ZERO_ADDRESS,
    salt: sessionParams.salt,
  };
}

// =============================================================================
// Timeout Wrapper
// =============================================================================

/**
 * Wraps a promise with a timeout.
 * Rejects with AbortError if timeout is exceeded.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operationName = 'Operation'
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => {
        const error = new Error(`${operationName} timed out after ${timeoutMs}ms`);
        error.name = 'AbortError';
        reject(error);
      }, timeoutMs);
    }),
  ]);
}
