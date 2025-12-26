/**
 * Test utilities for x402 Escrow integration tests
 * Updated for x402 v2 verify/settle pattern with 3 schemes:
 * - exact-escrow: One-time payment via charge()
 * - escrow: Create session + debit first charge
 * - session: Debit from existing session (no signature)
 */

import { keccak256, encodeAbiParameters, parseAbiParameters, toHex, type Address } from 'viem';
import { testConfig, payerWallet, payerAccount, publicClient } from '../setup.integration';

// =============================================================================
// EIP-712 / ERC-3009 Helpers
// =============================================================================

// PaymentInfo typehash (matches the Solidity contract)
const PAYMENT_INFO_TYPEHASH = keccak256(
  toHex(
    new TextEncoder().encode(
      'PaymentInfo(address operator,address payer,address receiver,address token,uint120 maxAmount,uint48 preApprovalExpiry,uint48 authorizationExpiry,uint48 refundExpiry,uint16 minFeeBps,uint16 maxFeeBps,address feeReceiver,uint256 salt)'
    )
  )
);

// USDC EIP-712 domain cache
let usdcDomainCache: {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: `0x${string}`;
} | null = null;

async function getUsdcDomain() {
  if (usdcDomainCache) return usdcDomainCache;

  const USDC_ABI = [
    {
      name: 'name',
      type: 'function',
      stateMutability: 'view',
      inputs: [],
      outputs: [{ name: '', type: 'string' }],
    },
    {
      name: 'version',
      type: 'function',
      stateMutability: 'view',
      inputs: [],
      outputs: [{ name: '', type: 'string' }],
    },
  ] as const;

  const [name, version] = await Promise.all([
    publicClient.readContract({
      address: testConfig.usdcAddress,
      abi: USDC_ABI,
      functionName: 'name',
    }),
    publicClient.readContract({
      address: testConfig.usdcAddress,
      abi: USDC_ABI,
      functionName: 'version',
    }),
  ]);

  usdcDomainCache = {
    name: name as string,
    version: version as string,
    chainId: testConfig.chainId,
    verifyingContract: testConfig.usdcAddress,
  };

  return usdcDomainCache;
}

export function generateSalt(): `0x${string}` {
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  return toHex(randomBytes);
}

interface PaymentInfo {
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

export function computePayerAgnosticHash(paymentInfo: PaymentInfo): `0x${string}` {
  const paymentInfoWithPayer0 = {
    ...paymentInfo,
    payer: '0x0000000000000000000000000000000000000000' as Address,
  };

  const paymentInfoHash = keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        'bytes32, address, address, address, address, uint120, uint48, uint48, uint48, uint16, uint16, address, uint256'
      ),
      [
        PAYMENT_INFO_TYPEHASH,
        paymentInfoWithPayer0.operator,
        paymentInfoWithPayer0.payer,
        paymentInfoWithPayer0.receiver,
        paymentInfoWithPayer0.token,
        paymentInfoWithPayer0.maxAmount,
        paymentInfoWithPayer0.preApprovalExpiry,
        paymentInfoWithPayer0.authorizationExpiry,
        paymentInfoWithPayer0.refundExpiry,
        paymentInfoWithPayer0.minFeeBps,
        paymentInfoWithPayer0.maxFeeBps,
        paymentInfoWithPayer0.feeReceiver,
        paymentInfoWithPayer0.salt,
      ]
    )
  );

  return keccak256(
    encodeAbiParameters(parseAbiParameters('uint256, address, bytes32'), [
      BigInt(testConfig.chainId),
      testConfig.escrowContract,
      paymentInfoHash,
    ])
  );
}

const receiveWithAuthorizationTypes = {
  ReceiveWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

export async function signERC3009(params: {
  from: `0x${string}`;
  to: `0x${string}`;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: `0x${string}`;
}): Promise<`0x${string}`> {
  const domain = await getUsdcDomain();

  const signature = await payerWallet.signTypedData({
    account: payerAccount,
    domain,
    types: receiveWithAuthorizationTypes,
    primaryType: 'ReceiveWithAuthorization',
    message: {
      from: params.from,
      to: params.to,
      value: params.value,
      validAfter: params.validAfter,
      validBefore: params.validBefore,
      nonce: params.nonce,
    },
  });

  return signature;
}

// =============================================================================
// Payload Builders
// =============================================================================

export interface BuildPayloadParams {
  receiver: `0x${string}`;
  amount: bigint; // For escrow: deposit amount. For exact-escrow: payment amount
  resourceCost?: bigint; // For escrow: first charge amount (defaults to testConfig.debitAmount)
  authorizationExpirySeconds?: number;
  refundExpirySeconds?: number;
}

// ----- ESCROW PAYLOAD (creates session + debits first charge) -----

export interface EscrowPayload {
  x402Version: number;
  accepted: {
    scheme: 'escrow';
    network: string;
    amount: string;
    asset: string;
    payTo: string;
    maxTimeoutSeconds: number;
    extra: {
      name: string;
      version: string;
      escrowContract: string;
      facilitator: string;
      tokenCollector: string;
      minDeposit: string;
      maxDeposit: string;
    };
  };
  payload: {
    signature: string;
    authorization: {
      from: string;
      to: string;
      value: string;
      validAfter: string;
      validBefore: string;
      nonce: string;
    };
    sessionParams: {
      salt: string;
      authorizationExpiry: number;
      refundExpiry: number;
    };
    requestId: string;
  };
}

export async function buildEscrowPayload(params: BuildPayloadParams): Promise<EscrowPayload> {
  const now = Math.floor(Date.now() / 1000);
  const salt = generateSalt();

  const authorizationExpiry = now + (params.authorizationExpirySeconds || 3600);
  const refundExpiry = now + (params.refundExpirySeconds || 86400);

  const validAfter = BigInt(0);
  const validBefore = BigInt(authorizationExpiry);

  const paymentInfo: PaymentInfo = {
    operator: testConfig.facilitatorAddress as Address,
    payer: payerAccount.address,
    receiver: params.receiver,
    token: testConfig.usdcAddress,
    maxAmount: params.amount,
    preApprovalExpiry: authorizationExpiry,
    authorizationExpiry,
    refundExpiry,
    minFeeBps: 0,
    maxFeeBps: 0,
    feeReceiver: '0x0000000000000000000000000000000000000000' as Address,
    salt: BigInt(salt),
  };

  const nonce = computePayerAgnosticHash(paymentInfo);

  const signature = await signERC3009({
    from: payerAccount.address,
    to: testConfig.tokenCollector,
    value: params.amount,
    validAfter,
    validBefore,
    nonce,
  });

  return {
    x402Version: 2,
    accepted: {
      scheme: 'escrow',
      network: testConfig.networkId,
      amount: (params.resourceCost || testConfig.debitAmount).toString(), // Resource cost for first charge
      asset: testConfig.usdcAddress,
      payTo: params.receiver,
      maxTimeoutSeconds: refundExpiry - now,
      extra: {
        name: 'USDC',
        version: '2',
        escrowContract: testConfig.escrowContract,
        facilitator: testConfig.facilitatorAddress,
        tokenCollector: testConfig.tokenCollector,
        minDeposit: '10000',
        maxDeposit: '1000000000',
      },
    },
    payload: {
      signature,
      authorization: {
        from: payerAccount.address,
        to: testConfig.tokenCollector,
        value: params.amount.toString(), // Deposit amount
        validAfter: validAfter.toString(),
        validBefore: validBefore.toString(),
        nonce,
      },
      sessionParams: {
        salt,
        authorizationExpiry,
        refundExpiry,
      },
      requestId: crypto.randomUUID(),
    },
  };
}

// ----- EXACT-ESCROW PAYLOAD (one-time payment via charge) -----

export interface ExactEscrowPayload {
  x402Version: number;
  accepted: {
    scheme: 'exact-escrow';
    network: string;
    amount: string;
    asset: string;
    payTo: string;
    maxTimeoutSeconds: number;
    extra: {
      name: string;
      version: string;
      escrowContract: string;
      facilitator: string;
      tokenCollector: string;
    };
  };
  payload: {
    signature: string;
    authorization: {
      from: string;
      to: string;
      value: string;
      validAfter: string;
      validBefore: string;
      nonce: string;
    };
    sessionParams: {
      salt: string;
      authorizationExpiry: number;
      refundExpiry: number;
    };
  };
}

export async function buildExactEscrowPayload(
  params: BuildPayloadParams
): Promise<ExactEscrowPayload> {
  const now = Math.floor(Date.now() / 1000);
  const salt = generateSalt();

  const authorizationExpiry = now + (params.authorizationExpirySeconds || 3600);
  const refundExpiry = now + (params.refundExpirySeconds || 86400);

  const validAfter = BigInt(0);
  const validBefore = BigInt(authorizationExpiry);

  const paymentInfo: PaymentInfo = {
    operator: testConfig.facilitatorAddress as Address,
    payer: payerAccount.address,
    receiver: params.receiver,
    token: testConfig.usdcAddress,
    maxAmount: params.amount,
    preApprovalExpiry: authorizationExpiry,
    authorizationExpiry,
    refundExpiry,
    minFeeBps: 0,
    maxFeeBps: 0,
    feeReceiver: '0x0000000000000000000000000000000000000000' as Address,
    salt: BigInt(salt),
  };

  const nonce = computePayerAgnosticHash(paymentInfo);

  const signature = await signERC3009({
    from: payerAccount.address,
    to: testConfig.tokenCollector,
    value: params.amount,
    validAfter,
    validBefore,
    nonce,
  });

  return {
    x402Version: 2,
    accepted: {
      scheme: 'exact-escrow',
      network: testConfig.networkId,
      amount: params.amount.toString(),
      asset: testConfig.usdcAddress,
      payTo: params.receiver,
      maxTimeoutSeconds: refundExpiry - now,
      extra: {
        name: 'USDC',
        version: '2',
        escrowContract: testConfig.escrowContract,
        facilitator: testConfig.facilitatorAddress,
        tokenCollector: testConfig.tokenCollector,
      },
    },
    payload: {
      signature,
      authorization: {
        from: payerAccount.address,
        to: testConfig.tokenCollector,
        value: params.amount.toString(),
        validAfter: validAfter.toString(),
        validBefore: validBefore.toString(),
        nonce,
      },
      sessionParams: {
        salt,
        authorizationExpiry,
        refundExpiry,
      },
    },
  };
}

// ----- SESSION PAYLOAD (debit from existing session, no signature) -----

export interface SessionPayload {
  x402Version: number;
  accepted: {
    scheme: 'session';
    network: string;
    sessionId: string;
  };
  payload: {
    sessionToken: string; // Secret token received when session was created
    requestId: string;
    amount: string;
  };
}

export function buildSessionPayload(
  sessionId: string,
  sessionToken: string,
  amount: bigint
): SessionPayload {
  return {
    x402Version: 2,
    accepted: {
      scheme: 'session',
      network: testConfig.networkId,
      sessionId,
    },
    payload: {
      sessionToken,
      requestId: crypto.randomUUID(),
      amount: amount.toString(),
    },
  };
}

// =============================================================================
// PaymentRequirements Builders (what server advertises)
// =============================================================================

export interface PaymentRequirements {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

export function buildEscrowRequirements(receiver: string, amount: bigint): PaymentRequirements {
  return {
    scheme: 'escrow',
    network: testConfig.networkId,
    amount: amount.toString(),
    asset: testConfig.usdcAddress,
    payTo: receiver,
    maxTimeoutSeconds: 86400,
    extra: {
      name: 'USDC',
      version: '2',
      escrowContract: testConfig.escrowContract,
      facilitator: testConfig.facilitatorAddress,
      tokenCollector: testConfig.tokenCollector,
      minDeposit: '10000',
      maxDeposit: '1000000000',
    },
  };
}

export function buildExactEscrowRequirements(
  receiver: string,
  amount: bigint
): PaymentRequirements {
  return {
    scheme: 'exact-escrow',
    network: testConfig.networkId,
    amount: amount.toString(),
    asset: testConfig.usdcAddress,
    payTo: receiver,
    maxTimeoutSeconds: 86400,
    extra: {
      name: 'USDC',
      version: '2',
      escrowContract: testConfig.escrowContract,
      facilitator: testConfig.facilitatorAddress,
      tokenCollector: testConfig.tokenCollector,
    },
  };
}

export function buildSessionRequirements(receiver: string, amount: bigint): PaymentRequirements {
  return {
    scheme: 'session',
    network: testConfig.networkId,
    amount: amount.toString(),
    asset: testConfig.usdcAddress,
    payTo: receiver,
    maxTimeoutSeconds: 86400,
  };
}

// =============================================================================
// API Helpers
// =============================================================================

const API_BASE_URL = process.env.TEST_API_URL || 'http://localhost:3000';

export interface ApiResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
  headers: Headers;
}

export async function apiRequest<T = unknown>(
  path: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    apiKey?: string;
  } = {}
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (options.apiKey) {
    headers['Authorization'] = `Bearer ${options.apiKey}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  let data: T;
  try {
    data = await response.json();
  } catch {
    data = {} as T;
  }

  return {
    ok: response.ok,
    status: response.status,
    data,
    headers: response.headers,
  };
}

// ----- VERIFY -----

export interface VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
}

export async function verify(
  apiKey: string,
  paymentPayload: EscrowPayload | ExactEscrowPayload | SessionPayload,
  paymentRequirements: PaymentRequirements
): Promise<ApiResponse<VerifyResponse>> {
  return apiRequest<VerifyResponse>('/api/verify', {
    method: 'POST',
    apiKey,
    body: { paymentPayload, paymentRequirements },
  });
}

// ----- SETTLE -----

export interface SettleResponse {
  success: boolean;
  errorReason?: string;
  payer?: string;
  transaction: string;
  network: string;
}

export interface EscrowSettleResponse extends SettleResponse {
  session: {
    id: string;
    token: string; // Secret token - shown only once, required for session debits
    balance: string;
    expiresAt: number;
  };
}

export async function settle(
  apiKey: string,
  paymentPayload: EscrowPayload | ExactEscrowPayload | SessionPayload,
  paymentRequirements: PaymentRequirements
): Promise<ApiResponse<SettleResponse | EscrowSettleResponse>> {
  return apiRequest<SettleResponse | EscrowSettleResponse>('/api/settle', {
    method: 'POST',
    apiKey,
    body: { paymentPayload, paymentRequirements },
  });
}

// ----- SUPPORTED -----

export interface SupportedResponse {
  kinds: Array<{
    x402Version: number;
    scheme: string;
    network: string;
    asset?: string;
    extra?: Record<string, unknown>;
  }>;
  signers: Record<string, string[]>;
}

export async function getSupported(): Promise<ApiResponse<SupportedResponse>> {
  return apiRequest<SupportedResponse>('/api/supported');
}

// ----- SESSION MANAGEMENT -----

export interface SessionResponse {
  id: string;
  networkId: string;
  payer: string;
  receiver: string;
  balance: {
    authorized: string;
    captured: string;
    pending: string;
    available: string;
  };
  authorizationExpiry: number;
  refundExpiry: number;
  status: 'active' | 'expired' | 'voided' | 'depleted';
}

export async function getSession(
  apiKey: string,
  sessionId: string
): Promise<ApiResponse<SessionResponse>> {
  return apiRequest<SessionResponse>(`/api/sessions/${sessionId}`, {
    apiKey,
  });
}

// ----- CAPTURE CRON -----

export async function triggerCapture(cronSecret: string): Promise<ApiResponse<unknown>> {
  return apiRequest('/api/capture', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cronSecret}`,
    },
  });
}

// =============================================================================
// High-Level Test Helpers
// =============================================================================

/**
 * Complete escrow flow: verify + settle (creates session + debits first charge)
 * Returns sessionToken which must be saved - it's shown only once!
 */
export async function createSession(
  apiKey: string,
  params: BuildPayloadParams
): Promise<{ sessionId: string; sessionToken: string; balance: string; txHash: string }> {
  const payload = await buildEscrowPayload(params);
  const requirements = buildEscrowRequirements(
    params.receiver,
    params.resourceCost || testConfig.debitAmount
  );

  // Verify
  const verifyRes = await verify(apiKey, payload, requirements);
  if (!verifyRes.ok || !verifyRes.data.isValid) {
    throw new Error(`Verify failed: ${verifyRes.data.invalidReason || 'unknown'}`);
  }

  // Settle
  const settleRes = await settle(apiKey, payload, requirements);
  if (!settleRes.ok || !settleRes.data.success) {
    throw new Error(
      `Settle failed: ${(settleRes.data as SettleResponse).errorReason || 'unknown'}`
    );
  }

  const escrowResult = settleRes.data as EscrowSettleResponse;
  return {
    sessionId: escrowResult.session.id,
    sessionToken: escrowResult.session.token, // Save this! Shown only once
    balance: escrowResult.session.balance,
    txHash: escrowResult.transaction,
  };
}

/**
 * Debit from existing session via session scheme
 * Requires sessionToken received when session was created
 */
export async function debitSession(
  apiKey: string,
  sessionId: string,
  sessionToken: string,
  amount: bigint,
  receiver: string
): Promise<{ success: boolean; txHash: string }> {
  const payload = buildSessionPayload(sessionId, sessionToken, amount);
  const requirements = buildSessionRequirements(receiver, amount);

  // Verify
  const verifyRes = await verify(apiKey, payload, requirements);
  if (!verifyRes.ok || !verifyRes.data.isValid) {
    throw new Error(`Verify failed: ${verifyRes.data.invalidReason || 'unknown'}`);
  }

  // Settle
  const settleRes = await settle(apiKey, payload, requirements);
  if (!settleRes.ok || !settleRes.data.success) {
    throw new Error(
      `Settle failed: ${(settleRes.data as SettleResponse).errorReason || 'unknown'}`
    );
  }

  return {
    success: true,
    txHash: settleRes.data.transaction,
  };
}

/**
 * One-time payment via exact-escrow scheme
 */
export async function chargeOnce(
  apiKey: string,
  params: BuildPayloadParams
): Promise<{ success: boolean; txHash: string }> {
  const payload = await buildExactEscrowPayload(params);
  const requirements = buildExactEscrowRequirements(params.receiver, params.amount);

  // Verify
  const verifyRes = await verify(apiKey, payload, requirements);
  if (!verifyRes.ok || !verifyRes.data.isValid) {
    throw new Error(`Verify failed: ${verifyRes.data.invalidReason || 'unknown'}`);
  }

  // Settle
  const settleRes = await settle(apiKey, payload, requirements);
  if (!settleRes.ok || !settleRes.data.success) {
    throw new Error(
      `Settle failed: ${(settleRes.data as SettleResponse).errorReason || 'unknown'}`
    );
  }

  return {
    success: true,
    txHash: settleRes.data.transaction,
  };
}

// =============================================================================
// Utility Functions
// =============================================================================

export async function waitFor(
  condition: () => Promise<boolean>,
  options: { timeout?: number; interval?: number; description?: string } = {}
): Promise<void> {
  const timeout = options.timeout || 30000;
  const interval = options.interval || 1000;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error(`Timeout waiting for: ${options.description || 'condition'}`);
}

let testCounter = 0;
export function generateTestReceiver(): `0x${string}` {
  testCounter++;
  const paddedCounter = testCounter.toString(16).padStart(8, '0');
  return `0x${paddedCounter}${'0'.repeat(32)}${testConfig.facilitatorAddress.slice(-8)}` as `0x${string}`;
}
