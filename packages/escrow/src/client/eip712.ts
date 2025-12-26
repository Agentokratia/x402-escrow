/**
 * EIP-712 Signing Utilities for x402 Escrow
 *
 * Handles ERC-3009 ReceiveWithAuthorization signing and nonce computation
 * for the escrow contract.
 */

import {
  keccak256,
  encodeAbiParameters,
  parseAbiParameters,
  toHex,
  type WalletClient,
  type Address,
  type Hex,
} from 'viem';
import { ZERO_ADDRESS } from '../constants';

// ============================================================================
// Types
// ============================================================================

export interface EIP712Domain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: Address;
}

export interface ERC3009Authorization {
  from: Address;
  to: Address;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex;
}

export interface PaymentInfoParams {
  operator: Address;
  payer: Address;
  receiver: Address;
  token: Address;
  maxAmount: bigint;
  preApprovalExpiry: number;
  authorizationExpiry: number;
  refundExpiry: number;
  minFeeBps: number;
  maxFeeBps: number;
  feeReceiver: Address;
  salt: bigint;
}

// ============================================================================
// Constants
// ============================================================================

/** EIP-712 type string for PaymentInfo struct */
const PAYMENT_INFO_TYPE =
  'PaymentInfo(address operator,address payer,address receiver,address token,uint120 maxAmount,uint48 preApprovalExpiry,uint48 authorizationExpiry,uint48 refundExpiry,uint16 minFeeBps,uint16 maxFeeBps,address feeReceiver,uint256 salt)';

/** Pre-computed typehash for PaymentInfo */
const PAYMENT_INFO_TYPEHASH = keccak256(toHex(new TextEncoder().encode(PAYMENT_INFO_TYPE)));

/** ABI parameter encoding for PaymentInfo struct */
const PAYMENT_INFO_ABI_PARAMS =
  'bytes32, address, address, address, address, uint120, uint48, uint48, uint48, uint16, uint16, address, uint256';

/** ABI parameter encoding for nonce computation */
const NONCE_ABI_PARAMS = 'uint256, address, bytes32';

/** ERC-3009 ReceiveWithAuthorization type definition */
const ERC3009_TYPES = {
  ReceiveWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

// ============================================================================
// Functions
// ============================================================================

/**
 * Compute the nonce for ERC-3009 authorization.
 * Uses payer=0 for payer-agnostic hash (allows any payer to use this session).
 */
export function computeEscrowNonce(
  chainId: number,
  escrowContract: Address,
  paymentInfo: PaymentInfoParams
): Hex {
  // Use payer=0 for payer-agnostic hash
  const paymentInfoHash = keccak256(
    encodeAbiParameters(parseAbiParameters(PAYMENT_INFO_ABI_PARAMS), [
      PAYMENT_INFO_TYPEHASH,
      paymentInfo.operator,
      ZERO_ADDRESS, // payer = 0 for payer-agnostic
      paymentInfo.receiver,
      paymentInfo.token,
      paymentInfo.maxAmount,
      paymentInfo.preApprovalExpiry,
      paymentInfo.authorizationExpiry,
      paymentInfo.refundExpiry,
      paymentInfo.minFeeBps,
      paymentInfo.maxFeeBps,
      paymentInfo.feeReceiver,
      paymentInfo.salt,
    ])
  );

  return keccak256(
    encodeAbiParameters(parseAbiParameters(NONCE_ABI_PARAMS), [
      BigInt(chainId),
      escrowContract,
      paymentInfoHash,
    ])
  );
}

/**
 * Sign an ERC-3009 ReceiveWithAuthorization message.
 * This is required by USDC FiatTokenV2 for gasless transfers.
 */
export async function signERC3009(
  wallet: WalletClient,
  authorization: ERC3009Authorization,
  domain: EIP712Domain
): Promise<Hex> {
  if (!wallet.account) {
    throw new Error('WalletClient must have an account');
  }

  return wallet.signTypedData({
    account: wallet.account,
    domain,
    types: ERC3009_TYPES,
    primaryType: 'ReceiveWithAuthorization',
    message: {
      from: authorization.from,
      to: authorization.to,
      value: authorization.value,
      validAfter: authorization.validAfter,
      validBefore: authorization.validBefore,
      nonce: authorization.nonce,
    },
  });
}
