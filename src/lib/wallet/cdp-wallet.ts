import {
  createPublicClient,
  http,
  encodeFunctionData,
  defineChain,
  type Address,
  type Hex,
} from 'viem';
import { CdpClient } from '@coinbase/cdp-sdk';
import { getNetwork, type DbNetwork } from '../db';
import type { ServerWallet, TxResult, MulticallCall, MulticallTxResult } from './types';
import { MULTICALL3_ADDRESS, MULTICALL3_ABI } from './constants';

// Create viem chain from DB network config
function createChainFromNetwork(network: DbNetwork) {
  return defineChain({
    id: network.chain_id,
    name: network.name,
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [network.rpc_url] } },
  });
}

// Get public client from network config
function getPublicClient(network: DbNetwork) {
  return createPublicClient({
    chain: createChainFromNetwork(network),
    transport: http(network.rpc_url),
  });
}

/**
 * Coinbase CDP (Coinbase Developer Platform) based server wallet
 * Uses CDP Server Wallet v2 for secure key management
 *
 * Required environment variables:
 * - CDP_API_KEY_ID: API key ID from Coinbase Developer Portal
 * - CDP_API_KEY_SECRET: API key secret
 * - CDP_WALLET_SECRET: Wallet encryption secret (optional but recommended)
 * - CDP_ACCOUNT_ADDRESS: The account address to use (optional, will create if not set)
 */
export class CdpWallet implements ServerWallet {
  private cdpClient: CdpClient | null = null;
  private accountAddress: string | null = null;
  private initPromise: Promise<void> | null = null;

  private async initialize(): Promise<void> {
    if (this.accountAddress) return;

    if (this.initPromise) {
      await this.initPromise;
      return;
    }

    this.initPromise = this._doInitialize();
    await this.initPromise;
  }

  private async _doInitialize(): Promise<void> {
    // CdpClient automatically reads from environment:
    // CDP_API_KEY_ID, CDP_API_KEY_SECRET, CDP_WALLET_SECRET
    this.cdpClient = new CdpClient();

    // Check if we have a pre-configured account address
    const existingAddress = process.env.CDP_ACCOUNT_ADDRESS;

    if (existingAddress) {
      this.accountAddress = existingAddress.toLowerCase();
      console.log(`[CdpWallet] Using existing account: ${this.accountAddress}`);
    } else {
      // Create a new account (network-agnostic, specified when sending tx)
      const account = await this.cdpClient.evm.createAccount({
        name: 'x402-escrow-facilitator',
      });
      this.accountAddress = account.address.toLowerCase();
      console.log(`[CdpWallet] Created new account: ${this.accountAddress}`);
      console.log(
        `[CdpWallet] IMPORTANT: Add CDP_ACCOUNT_ADDRESS=${this.accountAddress} to your .env`
      );
    }
  }

  async getAddress(): Promise<string> {
    await this.initialize();
    return this.accountAddress!;
  }

  async sendContractTx(
    networkId: string,
    contractAddress: Address,
    abi: readonly unknown[],
    functionName: string,
    args: unknown[]
  ): Promise<TxResult> {
    try {
      await this.initialize();

      const network = await getNetwork(networkId);
      if (!network) {
        return { success: false, error: `Network ${networkId} not found` };
      }

      if (!network.cdp_network) {
        return { success: false, error: `CDP network not configured for ${networkId}` };
      }

      const publicClient = getPublicClient(network);

      const data = encodeFunctionData({ abi, functionName, args });

      const result = await this.cdpClient!.evm.sendTransaction({
        address: this.accountAddress! as Address,
        network: network.cdp_network as 'base' | 'base-sepolia',
        transaction: {
          to: contractAddress,
          data: data as Hex,
          value: 0n,
        },
      });

      const txHash = result.transactionHash;

      // Wait for receipt
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash as Hex,
      });

      if (receipt.status === 'reverted') {
        return { success: false, error: 'Transaction reverted' };
      }

      return { success: true, txHash };
    } catch (err) {
      console.error('[CdpWallet] Transaction error:', err);
      const error = err instanceof Error ? err.message : 'Unknown error';
      return { success: false, error };
    }
  }

  async sendMulticall(networkId: string, calls: MulticallCall[]): Promise<MulticallTxResult> {
    if (calls.length === 0) {
      return { success: true, results: [] };
    }

    try {
      await this.initialize();

      const network = await getNetwork(networkId);
      if (!network) {
        return { success: false, error: `Network ${networkId} not found` };
      }

      if (!network.cdp_network) {
        return { success: false, error: `CDP network not configured for ${networkId}` };
      }

      const publicClient = getPublicClient(network);

      const data = encodeFunctionData({
        abi: MULTICALL3_ABI,
        functionName: 'aggregate3',
        args: [calls],
      });

      const result = await this.cdpClient!.evm.sendTransaction({
        address: this.accountAddress! as Address,
        network: network.cdp_network as 'base' | 'base-sepolia',
        transaction: {
          to: MULTICALL3_ADDRESS,
          data: data as Hex,
          value: 0n,
        },
      });

      const txHash = result.transactionHash;

      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash as Hex,
      });

      if (receipt.status === 'reverted') {
        return { success: false, error: 'Multicall transaction reverted' };
      }

      return {
        success: true,
        txHash,
        results: calls.map(() => ({ success: true, returnData: '0x' as Hex })),
      };
    } catch (err) {
      console.error('[CdpWallet] Multicall error:', err);
      const error = err instanceof Error ? err.message : 'Unknown error';
      return { success: false, error };
    }
  }

  async signMessage(_message: Hex): Promise<Hex> {
    throw new Error('Message signing not supported by CDP wallet');
  }

  isConfigured(): boolean {
    return !!(process.env.CDP_API_KEY_ID && process.env.CDP_API_KEY_SECRET);
  }

  getType(): string {
    return 'cdp';
  }
}
