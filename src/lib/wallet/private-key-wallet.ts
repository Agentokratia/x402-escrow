import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  defineChain,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
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

/**
 * Private Key based server wallet implementation
 */
export class PrivateKeyWallet implements ServerWallet {
  private account: PrivateKeyAccount | null = null;
  private readonly envKey: string;

  constructor(envKey: string = 'FACILITATOR_PRIVATE_KEY') {
    this.envKey = envKey;
  }

  private getAccount(): PrivateKeyAccount {
    if (this.account) return this.account;

    const privateKey = process.env[this.envKey];
    if (!privateKey) {
      throw new Error(`${this.envKey} environment variable is required`);
    }

    const formattedKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
    this.account = privateKeyToAccount(formattedKey as Hex);
    console.log(`[PrivateKeyWallet] Initialized: ${this.account.address}`);
    return this.account;
  }

  private getClients(network: DbNetwork) {
    const chain = createChainFromNetwork(network);
    const transport = http(network.rpc_url);
    return {
      public: createPublicClient({ chain, transport }),
      wallet: createWalletClient({ account: this.getAccount(), chain, transport }),
    };
  }

  async getAddress(): Promise<string> {
    return this.getAccount().address.toLowerCase();
  }

  async sendContractTx(
    networkId: string,
    contractAddress: Address,
    abi: readonly unknown[],
    functionName: string,
    args: unknown[]
  ): Promise<TxResult> {
    try {
      const network = await getNetwork(networkId);
      if (!network) {
        return { success: false, error: `Network ${networkId} not found` };
      }

      const { public: publicClient, wallet: walletClient } = this.getClients(network);
      const data = encodeFunctionData({ abi, functionName, args });

      const hash = await walletClient.sendTransaction({
        to: contractAddress,
        value: 0n,
        data: data as Hex,
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      if (receipt.status === 'reverted') {
        return { success: false, error: 'Transaction reverted' };
      }

      return { success: true, txHash: receipt.transactionHash };
    } catch (err) {
      console.error('[PrivateKeyWallet] Transaction error:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  }

  async sendMulticall(networkId: string, calls: MulticallCall[]): Promise<MulticallTxResult> {
    if (calls.length === 0) {
      return { success: true, results: [] };
    }

    try {
      const network = await getNetwork(networkId);
      if (!network) {
        return { success: false, error: `Network ${networkId} not found` };
      }

      const { public: publicClient, wallet: walletClient } = this.getClients(network);
      const data = encodeFunctionData({
        abi: MULTICALL3_ABI,
        functionName: 'aggregate3',
        args: [calls],
      });

      const hash = await walletClient.sendTransaction({
        to: MULTICALL3_ADDRESS,
        value: 0n,
        data: data as Hex,
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      if (receipt.status === 'reverted') {
        return { success: false, error: 'Multicall transaction reverted' };
      }

      return {
        success: true,
        txHash: receipt.transactionHash,
        results: calls.map(() => ({ success: true, returnData: '0x' as Hex })),
      };
    } catch (err) {
      console.error('[PrivateKeyWallet] Multicall error:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  }

  async signMessage(message: Hex): Promise<Hex> {
    const account = this.getAccount();
    return account.signMessage({ message: { raw: message } });
  }

  isConfigured(): boolean {
    return !!process.env[this.envKey];
  }

  getType(): string {
    return 'private-key';
  }
}
