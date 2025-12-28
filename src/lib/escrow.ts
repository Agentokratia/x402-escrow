import {
  createPublicClient,
  http,
  getContract,
  defineChain,
  type Address,
  type Hex,
  type PublicClient,
  type Chain,
} from 'viem';
import { getNetwork, type DbNetwork, type DbSession } from './db';
import { ZERO_ADDRESS } from './constants';
import { sendContractTx } from './wallet';

// PaymentInfo tuple components per Base Commerce protocol
// Note: payer is INSIDE PaymentInfo, not separate
const PAYMENT_INFO_COMPONENTS = [
  { name: 'operator', type: 'address' },
  { name: 'payer', type: 'address' },
  { name: 'receiver', type: 'address' },
  { name: 'token', type: 'address' },
  { name: 'maxAmount', type: 'uint120' },
  { name: 'preApprovalExpiry', type: 'uint48' },
  { name: 'authorizationExpiry', type: 'uint48' },
  { name: 'refundExpiry', type: 'uint48' },
  { name: 'minFeeBps', type: 'uint16' },
  { name: 'maxFeeBps', type: 'uint16' },
  { name: 'feeReceiver', type: 'address' },
  { name: 'salt', type: 'uint256' },
] as const;

// AuthCaptureEscrow ABI (from Base Commerce Payments Protocol)
const ESCROW_ABI = [
  {
    name: 'getHash',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'paymentInfo', type: 'tuple', components: PAYMENT_INFO_COMPONENTS }],
    outputs: [{ type: 'bytes32' }],
  },
  {
    name: 'authorize',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'paymentInfo', type: 'tuple', components: PAYMENT_INFO_COMPONENTS },
      { name: 'amount', type: 'uint256' },
      { name: 'tokenCollector', type: 'address' },
      { name: 'collectorData', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'capture',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'paymentInfo', type: 'tuple', components: PAYMENT_INFO_COMPONENTS },
      { name: 'amount', type: 'uint256' },
      { name: 'feeBps', type: 'uint16' },
      { name: 'feeReceiver', type: 'address' },
    ],
    outputs: [],
  },
  {
    name: 'void',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'paymentInfo', type: 'tuple', components: PAYMENT_INFO_COMPONENTS }],
    outputs: [],
  },
  {
    name: 'charge',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'paymentInfo', type: 'tuple', components: PAYMENT_INFO_COMPONENTS },
      { name: 'amount', type: 'uint256' },
      { name: 'tokenCollector', type: 'address' },
      { name: 'collectorData', type: 'bytes' },
      { name: 'feeBps', type: 'uint16' },
      { name: 'feeReceiver', type: 'address' },
    ],
    outputs: [],
  },
] as const;

// PaymentInfo per Base Commerce protocol - payer is inside, not separate
export interface PaymentInfo {
  operator: string;
  payer: string;
  receiver: string; // Where captured funds go (server's wallet)
  token: string;
  maxAmount: bigint;
  preApprovalExpiry: number;
  authorizationExpiry: number;
  refundExpiry: number;
  minFeeBps: number;
  maxFeeBps: number;
  feeReceiver: string;
  salt: string;
}

// Reconstruct PaymentInfo from DbSession (for capture/void calls)
export function sessionToPaymentInfo(session: DbSession): PaymentInfo {
  return {
    operator: session.operator,
    payer: session.payer,
    receiver: session.receiver,
    token: session.token,
    maxAmount: BigInt(session.authorized_amount),
    preApprovalExpiry: Math.floor(new Date(session.pre_approval_expiry).getTime() / 1000),
    authorizationExpiry: Math.floor(new Date(session.authorization_expiry).getTime() / 1000),
    refundExpiry: Math.floor(new Date(session.refund_expiry).getTime() / 1000),
    minFeeBps: session.min_fee_bps,
    maxFeeBps: session.max_fee_bps,
    feeReceiver: session.fee_receiver,
    salt: session.salt,
  };
}

// Re-export facilitator address from wallet module
export { getFacilitatorAddress } from './wallet';

// Cached public clients per network (for read operations only)
const publicClientCache = new Map<string, { public: PublicClient; chain: Chain }>();

function getPublicClient(network: DbNetwork) {
  let cached = publicClientCache.get(network.id);
  if (!cached) {
    const transport = http(network.rpc_url);

    // Define chain from network configuration
    const chain = defineChain({
      id: network.chain_id,
      name: network.name,
      nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
      rpcUrls: {
        default: { http: [network.rpc_url] },
      },
    });

    const publicClient = createPublicClient({ chain, transport });
    cached = { public: publicClient, chain };
    publicClientCache.set(network.id, cached);
  }
  return {
    ...cached,
    escrowContract: network.escrow_contract as Address,
  };
}

// Convert PaymentInfo to contract-compatible tuple
// Note: uint48 fields are kept as number (not bigint) to match viem's ABI typing
function toPaymentInfoTuple(paymentInfo: PaymentInfo) {
  return {
    operator: paymentInfo.operator as Address,
    payer: paymentInfo.payer as Address,
    receiver: paymentInfo.receiver as Address,
    token: paymentInfo.token as Address,
    maxAmount: paymentInfo.maxAmount,
    preApprovalExpiry: paymentInfo.preApprovalExpiry, // uint48 -> number
    authorizationExpiry: paymentInfo.authorizationExpiry, // uint48 -> number
    refundExpiry: paymentInfo.refundExpiry, // uint48 -> number
    minFeeBps: paymentInfo.minFeeBps,
    maxFeeBps: paymentInfo.maxFeeBps,
    feeReceiver: paymentInfo.feeReceiver as Address,
    salt: BigInt(paymentInfo.salt),
  };
}

// Get paymentInfoHash from escrow contract (canonical source)
export async function getPaymentInfoHash(
  networkId: string,
  paymentInfo: PaymentInfo
): Promise<string> {
  const network = await getNetwork(networkId);
  if (!network) {
    throw new Error(`Network ${networkId} not found`);
  }

  const { public: publicClient, escrowContract } = getPublicClient(network);

  const contract = getContract({
    address: escrowContract,
    abi: ESCROW_ABI,
    client: publicClient,
  });

  return await contract.read.getHash([toPaymentInfoTuple(paymentInfo)]);
}

// Result type for escrow operations
interface EscrowResult {
  success: boolean;
  txHash?: string;
  error?: string;
}

// Authorize - calls escrow.authorize() on-chain via CDP
// tokenCollector: ERC3009 or Permit2 collector address
// collectorData: signature + authorization data for the collector
export async function authorize(
  networkId: string,
  paymentInfo: PaymentInfo,
  amount: bigint,
  tokenCollector: string,
  collectorData: string
): Promise<EscrowResult> {
  try {
    const network = await getNetwork(networkId);
    if (!network) {
      return { success: false, error: `Network ${networkId} not found or inactive` };
    }

    // Use CDP Server Wallet for signing
    return sendContractTx(networkId, network.escrow_contract as Address, ESCROW_ABI, 'authorize', [
      toPaymentInfoTuple(paymentInfo),
      amount,
      tokenCollector as Address,
      collectorData as Hex,
    ]);
  } catch (err) {
    console.error('Escrow authorize error:', err);
    const error = err instanceof Error ? err.message : 'Unknown error';
    return { success: false, error };
  }
}

// Capture - calls escrow.capture() on-chain via CDP
// Requires full PaymentInfo, not just hash
export async function capture(
  networkId: string,
  paymentInfo: PaymentInfo,
  amount: bigint,
  feeBps: number = 0,
  feeReceiver: string = ZERO_ADDRESS
): Promise<EscrowResult> {
  try {
    const network = await getNetwork(networkId);
    if (!network) {
      return { success: false, error: `Network ${networkId} not found or inactive` };
    }

    // Use CDP Server Wallet for signing
    return sendContractTx(networkId, network.escrow_contract as Address, ESCROW_ABI, 'capture', [
      toPaymentInfoTuple(paymentInfo),
      amount,
      feeBps,
      feeReceiver as Address,
    ]);
  } catch (err) {
    console.error('Escrow capture error:', err);
    const error = err instanceof Error ? err.message : 'Unknown error';
    return { success: false, error };
  }
}

// Batch capture - executes multiple captures via CDP
// Note: Each capture is executed as a separate transaction (no multicall with CDP)
export async function batchCapture(
  networkId: string,
  captures: { paymentInfo: PaymentInfo; amount: bigint }[],
  feeBps: number = 0,
  feeReceiver: string = ZERO_ADDRESS
): Promise<{ results: EscrowResult[]; txHash?: string }> {
  if (captures.length === 0) {
    return { results: [] };
  }

  // Execute captures sequentially via CDP
  const results: EscrowResult[] = [];
  let lastTxHash: string | undefined;

  for (const c of captures) {
    const result = await capture(networkId, c.paymentInfo, c.amount, feeBps, feeReceiver);
    results.push(result);
    if (result.txHash) {
      lastTxHash = result.txHash;
    }
  }

  return { results, txHash: lastTxHash };
}

// Void - calls escrow.void() on-chain via CDP
// Requires full PaymentInfo, not just hash
export async function voidSession(
  networkId: string,
  paymentInfo: PaymentInfo
): Promise<EscrowResult> {
  try {
    const network = await getNetwork(networkId);
    if (!network) {
      return { success: false, error: `Network ${networkId} not found or inactive` };
    }

    // Use CDP Server Wallet for signing
    return sendContractTx(networkId, network.escrow_contract as Address, ESCROW_ABI, 'void', [
      toPaymentInfoTuple(paymentInfo),
    ]);
  } catch (err) {
    console.error('Escrow void error:', err);
    const error = err instanceof Error ? err.message : 'Unknown error';
    return { success: false, error };
  }
}

// Charge - one-time immediate payment via CDP (like 'exact' scheme)
// Combines authorize and capture in a single transaction
export async function charge(
  networkId: string,
  paymentInfo: PaymentInfo,
  amount: bigint,
  tokenCollector: string,
  collectorData: string,
  feeBps: number = 0,
  feeReceiver: string = ZERO_ADDRESS
): Promise<EscrowResult> {
  try {
    const network = await getNetwork(networkId);
    if (!network) {
      return { success: false, error: `Network ${networkId} not found or inactive` };
    }

    // Use CDP Server Wallet for signing
    return sendContractTx(networkId, network.escrow_contract as Address, ESCROW_ABI, 'charge', [
      toPaymentInfoTuple(paymentInfo),
      amount,
      tokenCollector as Address,
      collectorData as Hex,
      feeBps,
      feeReceiver as Address,
    ]);
  } catch (err) {
    console.error('Escrow charge error:', err);
    const error = err instanceof Error ? err.message : 'Unknown error';
    return { success: false, error };
  }
}
