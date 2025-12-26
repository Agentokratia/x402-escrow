/**
 * Smart Contract Direct Integration Tests
 *
 * Tests direct interaction with the AuthCaptureEscrow contract on Base Sepolia.
 * These tests bypass the API to verify contract behavior directly.
 */

import { describe, it, expect } from 'vitest';
import { keccak256, encodePacked, formatUnits } from 'viem';
import {
  testConfig,
  payerAccount,
  facilitatorAccount,
  payerWallet,
  facilitatorWallet,
  publicClient,
  formatUsdc,
} from '../setup.integration';

// Skip contract tests if facilitator private key not provided
const hasFacilitator = facilitatorAccount !== null;

// Escrow contract ABI (minimal for testing)
const ESCROW_ABI = [
  {
    name: 'getHash',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      {
        name: 'paymentInfo',
        type: 'tuple',
        components: [
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
        ],
      },
    ],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    name: 'authorize',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'paymentInfo',
        type: 'tuple',
        components: [
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
        ],
      },
      { name: 'amount', type: 'uint256' },
      { name: 'tokenCollector', type: 'address' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'capture',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'paymentInfo',
        type: 'tuple',
        components: [
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
        ],
      },
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
    inputs: [
      {
        name: 'paymentInfo',
        type: 'tuple',
        components: [
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
        ],
      },
    ],
    outputs: [],
  },
] as const;

describe('Smart Contract Direct Tests', () => {
  describe('Contract Read Functions', () => {
    it('should compute payment hash correctly', async () => {
      const now = Math.floor(Date.now() / 1000);
      const salt = BigInt('0x' + crypto.randomUUID().replace(/-/g, ''));

      const paymentInfo = {
        operator: testConfig.facilitatorAddress,
        payer: payerAccount.address,
        receiver: testConfig.facilitatorAddress,
        token: testConfig.usdcAddress,
        maxAmount: testConfig.authorizeAmount,
        preApprovalExpiry: now - 1, // Already past
        authorizationExpiry: now + 3600,
        refundExpiry: now + 86400,
        minFeeBps: 0,
        maxFeeBps: 0,
        feeReceiver: testConfig.facilitatorAddress,
        salt,
      };

      // Get hash from contract
      const contractHash = await publicClient.readContract({
        address: testConfig.escrowContract,
        abi: ESCROW_ABI,
        functionName: 'getHash',
        args: [paymentInfo],
      });

      console.log('Payment info hash:', contractHash);

      expect(contractHash).toBeDefined();
      expect(contractHash).toMatch(/^0x[a-f0-9]{64}$/i);
    });

    it('should compute consistent hash for same payment info', async () => {
      const now = Math.floor(Date.now() / 1000);
      const salt = BigInt('0x' + crypto.randomUUID().replace(/-/g, ''));

      const paymentInfo = {
        operator: testConfig.facilitatorAddress,
        payer: payerAccount.address,
        receiver: testConfig.facilitatorAddress,
        token: testConfig.usdcAddress,
        maxAmount: testConfig.authorizeAmount,
        preApprovalExpiry: now - 1,
        authorizationExpiry: now + 3600,
        refundExpiry: now + 86400,
        minFeeBps: 0,
        maxFeeBps: 0,
        feeReceiver: testConfig.facilitatorAddress,
        salt,
      };

      // Get hash twice - should be identical (deterministic)
      const hash1 = await publicClient.readContract({
        address: testConfig.escrowContract,
        abi: ESCROW_ABI,
        functionName: 'getHash',
        args: [paymentInfo],
      });

      const hash2 = await publicClient.readContract({
        address: testConfig.escrowContract,
        abi: ESCROW_ABI,
        functionName: 'getHash',
        args: [paymentInfo],
      });

      expect(hash1).toBe(hash2);
      console.log('Hash consistency verified:', hash1);
    });
  });

  describe('Contract State Verification', () => {
    it('should verify contract is deployed and accessible', async () => {
      const code = await publicClient.getBytecode({
        address: testConfig.escrowContract,
      });

      expect(code).toBeDefined();
      expect(code!.length).toBeGreaterThan(2); // More than just '0x'
      console.log(`Escrow contract bytecode length: ${code!.length} chars`);
    });

    it('should verify USDC contract is deployed', async () => {
      const code = await publicClient.getBytecode({
        address: testConfig.usdcAddress,
      });

      expect(code).toBeDefined();
      expect(code!.length).toBeGreaterThan(2);
      console.log(`USDC contract bytecode length: ${code!.length} chars`);
    });

    it('should verify token collector is deployed', async () => {
      const code = await publicClient.getBytecode({
        address: testConfig.tokenCollector,
      });

      expect(code).toBeDefined();
      expect(code!.length).toBeGreaterThan(2);
      console.log(`Token collector bytecode length: ${code!.length} chars`);
    });
  });

  describe('Gas Estimation', () => {
    it('should estimate gas for authorize call', async () => {
      const now = Math.floor(Date.now() / 1000);
      const salt = BigInt('0x' + crypto.randomUUID().replace(/-/g, ''));

      const paymentInfo = {
        operator: testConfig.facilitatorAddress,
        payer: payerAccount.address,
        receiver: testConfig.facilitatorAddress,
        token: testConfig.usdcAddress,
        maxAmount: testConfig.authorizeAmount,
        preApprovalExpiry: now - 1,
        authorizationExpiry: now + 3600,
        refundExpiry: now + 86400,
        minFeeBps: 0,
        maxFeeBps: 0,
        feeReceiver: testConfig.facilitatorAddress,
        salt,
      };

      // Note: This will revert without proper ERC-3009 data, but we can still estimate
      try {
        const gasEstimate = await publicClient.estimateContractGas({
          address: testConfig.escrowContract,
          abi: ESCROW_ABI,
          functionName: 'authorize',
          args: [
            paymentInfo,
            testConfig.authorizeAmount,
            testConfig.tokenCollector,
            '0x', // Empty data will fail, but we just want estimate
          ],
          account: testConfig.facilitatorAddress,
        });

        console.log(`Authorize gas estimate: ${gasEstimate}`);
      } catch {
        // Expected to fail without valid ERC-3009 signature
        console.log('Gas estimation failed (expected without valid signature)');
      }
    });
  });

  describe('Network Configuration', () => {
    it('should be connected to Base Sepolia', async () => {
      const chainId = await publicClient.getChainId();

      expect(chainId).toBe(84532); // Base Sepolia chain ID
      console.log(`Connected to chain ID: ${chainId}`);
    });

    it('should have correct block number (chain is alive)', async () => {
      const blockNumber = await publicClient.getBlockNumber();

      expect(blockNumber).toBeGreaterThan(BigInt(0));
      console.log(`Current block number: ${blockNumber}`);
    });

    it('should get current gas price', async () => {
      const gasPrice = await publicClient.getGasPrice();

      expect(gasPrice).toBeGreaterThan(BigInt(0));
      console.log(`Current gas price: ${formatUnits(gasPrice, 9)} Gwei`);
    });
  });

  describe('Account Validation', () => {
    it('should verify facilitator account can sign transactions', async () => {
      if (!hasFacilitator || !facilitatorWallet || !facilitatorAccount) {
        console.log('Skipping: No FACILITATOR_PRIVATE_KEY configured');
        return;
      }

      const message = 'Test message for signature verification';

      const signature = await facilitatorWallet.signMessage({
        account: facilitatorAccount,
        message,
      });

      expect(signature).toBeDefined();
      expect(signature).toMatch(/^0x[a-f0-9]+$/i);
      console.log(`Facilitator signature: ${signature.slice(0, 20)}...`);
    });

    it('should verify payer account can sign transactions', async () => {
      const message = 'Test message for signature verification';

      const signature = await payerWallet.signMessage({
        account: payerAccount,
        message,
      });

      expect(signature).toBeDefined();
      expect(signature).toMatch(/^0x[a-f0-9]+$/i);
      console.log(`Payer signature: ${signature.slice(0, 20)}...`);
    });

    it('should verify keccak256 is deterministic', () => {
      // Simple test that keccak256 produces consistent results
      const testData = keccak256(encodePacked(['uint256'], [BigInt(12345)]));

      const hash1 = keccak256(encodePacked(['bytes32'], [testData]));

      const hash2 = keccak256(encodePacked(['bytes32'], [testData]));

      expect(hash1).toBeDefined();
      expect(hash1).toMatch(/^0x[a-f0-9]{64}$/i);
      expect(hash2).toBe(hash1);
      console.log(`Computed hash: ${hash1}`);
    });
  });

  describe('USDC Token Tests', () => {
    it('should read USDC decimals', async () => {
      const DECIMALS_ABI = [
        {
          name: 'decimals',
          type: 'function',
          stateMutability: 'view',
          inputs: [],
          outputs: [{ name: '', type: 'uint8' }],
        },
      ] as const;

      const decimals = await publicClient.readContract({
        address: testConfig.usdcAddress,
        abi: DECIMALS_ABI,
        functionName: 'decimals',
      });

      expect(decimals).toBe(6);
      console.log(`USDC decimals: ${decimals}`);
    });

    it('should read USDC name and symbol', async () => {
      const TOKEN_INFO_ABI = [
        {
          name: 'name',
          type: 'function',
          stateMutability: 'view',
          inputs: [],
          outputs: [{ name: '', type: 'string' }],
        },
        {
          name: 'symbol',
          type: 'function',
          stateMutability: 'view',
          inputs: [],
          outputs: [{ name: '', type: 'string' }],
        },
      ] as const;

      const [name, symbol] = await Promise.all([
        publicClient.readContract({
          address: testConfig.usdcAddress,
          abi: TOKEN_INFO_ABI,
          functionName: 'name',
        }),
        publicClient.readContract({
          address: testConfig.usdcAddress,
          abi: TOKEN_INFO_ABI,
          functionName: 'symbol',
        }),
      ]);

      console.log(`Token: ${name} (${symbol})`);
      expect(symbol).toBe('USDC');
    });

    it('should check USDC allowance for token collector', async () => {
      const ALLOWANCE_ABI = [
        {
          name: 'allowance',
          type: 'function',
          stateMutability: 'view',
          inputs: [
            { name: 'owner', type: 'address' },
            { name: 'spender', type: 'address' },
          ],
          outputs: [{ name: '', type: 'uint256' }],
        },
      ] as const;

      const allowance = await publicClient.readContract({
        address: testConfig.usdcAddress,
        abi: ALLOWANCE_ABI,
        functionName: 'allowance',
        args: [payerAccount.address, testConfig.tokenCollector],
      });

      console.log(`Payer allowance for token collector: ${formatUsdc(allowance)} USDC`);
    });
  });
});
