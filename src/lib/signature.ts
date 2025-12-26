/**
 * EIP-712 Signature Verification for x402
 *
 * Verifies ERC-3009 ReceiveWithAuthorization signatures.
 * CRITICAL: Never accept payments without signature verification.
 */

import { recoverTypedDataAddress, type Address, type Hex } from 'viem';

// =============================================================================
// ERC-3009 Types
// =============================================================================

export interface ERC3009Authorization {
  from: Address;
  to: Address;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex;
}

export interface EIP712Domain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: Address;
}

// ERC-3009 ReceiveWithAuthorization type definition
const RECEIVE_WITH_AUTHORIZATION_TYPES = {
  ReceiveWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

// =============================================================================
// Signature Verification
// =============================================================================

export interface VerifySignatureResult {
  valid: boolean;
  recoveredAddress?: string;
  error?: string;
}

/**
 * Verify ERC-3009 ReceiveWithAuthorization signature.
 *
 * @param authorization - The authorization parameters
 * @param signature - The EIP-712 signature (hex)
 * @param domain - EIP-712 domain parameters
 * @returns Verification result with recovered address
 *
 * @example
 * ```typescript
 * const result = await verifyERC3009Signature(
 *   { from: '0x...', to: '0x...', value: 1000000n, ... },
 *   '0x...',
 *   { name: 'USDC', version: '2', chainId: 84532, verifyingContract: '0x...' }
 * );
 * if (!result.valid) {
 *   return { isValid: false, invalidReason: 'invalid_signature' };
 * }
 * ```
 */
export async function verifyERC3009Signature(
  authorization: ERC3009Authorization,
  signature: Hex,
  domain: EIP712Domain
): Promise<VerifySignatureResult> {
  try {
    // Recover the signer address from the signature
    const recoveredAddress = await recoverTypedDataAddress({
      domain: {
        name: domain.name,
        version: domain.version,
        chainId: domain.chainId,
        verifyingContract: domain.verifyingContract,
      },
      types: RECEIVE_WITH_AUTHORIZATION_TYPES,
      primaryType: 'ReceiveWithAuthorization',
      message: {
        from: authorization.from,
        to: authorization.to,
        value: authorization.value,
        validAfter: authorization.validAfter,
        validBefore: authorization.validBefore,
        nonce: authorization.nonce,
      },
      signature,
    });

    // Verify recovered address matches the claimed "from" address
    const isValid = recoveredAddress.toLowerCase() === authorization.from.toLowerCase();

    return {
      valid: isValid,
      recoveredAddress: recoveredAddress.toLowerCase(),
      error: isValid ? undefined : 'signature_address_mismatch',
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown signature error';
    return {
      valid: false,
      error: `signature_recovery_failed: ${error}`,
    };
  }
}

/**
 * Parse authorization from payload and prepare for verification.
 */
export function parseAuthorization(payload: {
  from: string;
  to: string;
  value: string | number;
  validAfter: string | number;
  validBefore: string | number;
  nonce: string;
}): ERC3009Authorization {
  return {
    from: payload.from as Address,
    to: payload.to as Address,
    value: BigInt(payload.value),
    validAfter: BigInt(payload.validAfter),
    validBefore: BigInt(payload.validBefore),
    nonce: payload.nonce as Hex,
  };
}
