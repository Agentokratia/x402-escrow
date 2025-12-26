import { encodeFunctionData, type Address, type Hex, createPublicClient, http } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { PrivateKeyWallet } from './private-key-wallet';
import { CdpWallet } from './cdp-wallet';
import { getNetwork, type DbNetwork } from '../db';
import type {
  ServerWallet,
  WalletProviderType,
  TxResult,
  MulticallCall,
  MulticallTxResult,
} from './types';
export type { ServerWallet, TxResult, MulticallCall, MulticallTxResult, WalletProviderType };
export { MULTICALL3_ADDRESS, MULTICALL3_ABI, USDC_ERC3009_ABI } from './constants';

// =============================================================================
// Wallet Factory
// =============================================================================

let serverWallet: ServerWallet | null = null;

/**
 * Get the configured server wallet instance
 * Uses WALLET_PROVIDER env var to select implementation:
 * - 'private-key' (default): Uses FACILITATOR_PRIVATE_KEY
 * - 'cdp': Uses Coinbase CDP Server Wallet
 */
export function getServerWallet(): ServerWallet {
  if (serverWallet) {
    return serverWallet;
  }

  const provider = (process.env.WALLET_PROVIDER || 'private-key') as WalletProviderType;

  switch (provider) {
    case 'cdp':
      serverWallet = new CdpWallet();
      console.log('[ServerWallet] Using CDP wallet');
      break;
    case 'private-key':
    default:
      serverWallet = new PrivateKeyWallet();
      console.log('[ServerWallet] Using private key wallet');
      break;
  }

  return serverWallet;
}

/**
 * Reset the wallet instance (useful for testing)
 */
export function resetServerWallet(): void {
  serverWallet = null;
}

// =============================================================================
// Convenience exports that use the configured wallet
// =============================================================================

/**
 * Get the facilitator wallet address
 */
export async function getFacilitatorAddress(): Promise<string> {
  return getServerWallet().getAddress();
}

/**
 * Check if the server wallet is configured
 */
export function isWalletConfigured(): boolean {
  return getServerWallet().isConfigured();
}

/**
 * Get the wallet provider type
 */
export function getWalletType(): string {
  return getServerWallet().getType();
}

/**
 * Send a contract transaction
 */
export async function sendContractTx(
  networkId: string,
  contractAddress: Address,
  abi: readonly unknown[],
  functionName: string,
  args: unknown[]
): Promise<TxResult> {
  return getServerWallet().sendContractTx(networkId, contractAddress, abi, functionName, args);
}

/**
 * Send multiple calls via Multicall3
 */
export async function sendMulticall(
  networkId: string,
  calls: MulticallCall[]
): Promise<MulticallTxResult> {
  return getServerWallet().sendMulticall(networkId, calls);
}

// =============================================================================
// Utility functions (not wallet-specific)
// =============================================================================

/**
 * Encode a contract call for use in multicall
 */
export function encodeCall(abi: readonly unknown[], functionName: string, args: unknown[]): Hex {
  return encodeFunctionData({ abi, functionName, args }) as Hex;
}

// Map network ID to viem chain
function getViemChain(networkId: string) {
  if (networkId === 'eip155:8453') return base;
  if (networkId === 'eip155:84532') return baseSepolia;
  throw new Error(`Unsupported network: ${networkId}`);
}

/**
 * Get a public client for read operations (shared utility)
 */
export function getPublicClient(network: DbNetwork) {
  const chain = getViemChain(network.id);
  return createPublicClient({
    chain,
    transport: http(network.rpc_url),
  });
}

/**
 * Check if ERC-3009 authorization nonce is already used
 */
export async function isNonceUsed(
  networkId: string,
  tokenAddress: Address,
  authorizer: Address,
  nonce: Hex
): Promise<boolean> {
  const { USDC_ERC3009_ABI } = await import('./constants');
  const network = await getNetwork(networkId);
  if (!network) {
    throw new Error(`Network ${networkId} not found`);
  }

  const publicClient = getPublicClient(network);
  const used = await publicClient.readContract({
    address: tokenAddress,
    abi: USDC_ERC3009_ABI,
    functionName: 'authorizationState',
    args: [authorizer, nonce],
  });

  return used;
}

/**
 * Execute ERC-3009 transferWithAuthorization
 */
export async function executeTransferWithAuthorization(
  networkId: string,
  tokenAddress: Address,
  from: Address,
  to: Address,
  value: bigint,
  validAfter: bigint,
  validBefore: bigint,
  nonce: Hex,
  signature: Hex
): Promise<TxResult> {
  const { USDC_ERC3009_ABI } = await import('./constants');

  // Parse signature into v, r, s
  const r = `0x${signature.slice(2, 66)}` as Hex;
  const s = `0x${signature.slice(66, 130)}` as Hex;
  const v = parseInt(signature.slice(130, 132), 16);

  return sendContractTx(networkId, tokenAddress, USDC_ERC3009_ABI, 'transferWithAuthorization', [
    from,
    to,
    value,
    validAfter,
    validBefore,
    nonce,
    v,
    r,
    s,
  ]);
}
