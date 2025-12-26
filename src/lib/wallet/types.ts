import type { Address, Hex } from 'viem';

// Transaction result from wallet operations
export interface TxResult {
  success: boolean;
  txHash?: string;
  error?: string;
}

// Multicall types
export interface MulticallCall {
  target: Address;
  allowFailure: boolean;
  callData: Hex;
}

export interface MulticallResult {
  success: boolean;
  returnData: Hex;
}

export interface MulticallTxResult {
  success: boolean;
  txHash?: string;
  results?: MulticallResult[];
  error?: string;
}

// Server wallet interface - implementations can be private key, CDP, MPC, etc.
export interface ServerWallet {
  // Get the wallet address
  getAddress(): Promise<string>;

  // Send a contract transaction
  sendContractTx(
    networkId: string,
    contractAddress: Address,
    abi: readonly unknown[],
    functionName: string,
    args: unknown[]
  ): Promise<TxResult>;

  // Send multiple calls via Multicall3
  sendMulticall(networkId: string, calls: MulticallCall[]): Promise<MulticallTxResult>;

  // Sign a message (EIP-191 personal sign)
  signMessage(message: Hex): Promise<Hex>;

  // Check if the wallet is properly configured
  isConfigured(): boolean;

  // Get wallet type identifier
  getType(): string;
}

// Wallet provider types
export type WalletProviderType = 'private-key' | 'cdp';
