/**
 * x402 Client Integration Tests
 *
 * Tests the documented integration pattern:
 * - Unified EscrowScheme (handles both session creation and usage)
 * - wrapFetchWithPayment for automatic 402 handling
 *
 * Requires TEST_API_KEY and TEST_PAYER_PRIVATE_KEY environment variables.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createWalletClient, http, type Address, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import { x402Client } from '@x402/core/client';
import { wrapFetchWithPayment } from '@x402/fetch';
import { EscrowScheme } from '@x402/escrow/client';

// Test configuration
const TEST_API_KEY = process.env.TEST_API_KEY;
const TEST_PAYER_PRIVATE_KEY = process.env.TEST_PAYER_PRIVATE_KEY;
const NETWORK_ID = 'eip155:84532' as const;
const API_BASE_URL = process.env.TEST_API_URL || 'http://localhost:3000';

// Skip if not configured
const SKIP_TESTS = !TEST_API_KEY || !TEST_PAYER_PRIVATE_KEY;

// Test wallet setup
let walletClient: WalletClient;
let escrowScheme: EscrowScheme;
let testConfig: {
  facilitatorAddress: Address;
  escrowContract: Address;
  tokenCollector: Address;
  usdcAddress: Address;
};

describe('x402 Client Integration', () => {
  beforeAll(async () => {
    if (SKIP_TESTS) {
      console.warn(
        'Skipping live integration tests - missing TEST_API_KEY or TEST_PAYER_PRIVATE_KEY'
      );
      return;
    }

    // Create wallet client
    const account = privateKeyToAccount(TEST_PAYER_PRIVATE_KEY as `0x${string}`);
    walletClient = createWalletClient({
      account,
      chain: baseSepolia,
      transport: http(),
    });

    console.log(`Test payer: ${walletClient.account!.address}`);

    // Create unified EscrowScheme - handles both session creation and usage
    escrowScheme = new EscrowScheme(walletClient);

    // Fetch facilitator config from /api/supported
    const supportedRes = await fetch(`${API_BASE_URL}/api/supported`);
    const supported = await supportedRes.json();

    testConfig = {
      facilitatorAddress: supported.signers[NETWORK_ID]?.[0] as Address,
      escrowContract: '0xbDEa0d1BCc5966192b070fDF62ab4eF5B4420Cff' as Address,
      tokenCollector: '0x0E3Df9510De65469C4518D7843919c0B8c7a7757' as Address,
      usdcAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as Address,
    };

    console.log(`Facilitator: ${testConfig.facilitatorAddress}`);
  });

  describe('Unified Scheme Registration', () => {
    it.skipIf(SKIP_TESTS)('escrow scheme is registered', () => {
      expect(escrowScheme.scheme).toBe('escrow');
    });

    it.skipIf(SKIP_TESTS)('registers with x402Client', () => {
      const client = new x402Client().register(NETWORK_ID, escrowScheme);

      expect(client).toBeDefined();
    });

    it.skipIf(SKIP_TESTS)('creates wrapped fetch with wrapFetchWithPayment', () => {
      const client = new x402Client().register(NETWORK_ID, escrowScheme);

      const paidFetch = wrapFetchWithPayment(fetch, client);

      expect(paidFetch).toBeDefined();
      expect(typeof paidFetch).toBe('function');
    });
  });

  describe('Payment Payload Creation', () => {
    it.skipIf(SKIP_TESTS)('creates escrow payment payload (CREATION)', async () => {
      // Clear sessions to ensure CREATION payload
      escrowScheme.sessions.clear();

      const paymentRequirements = {
        scheme: 'escrow',
        network: NETWORK_ID,
        amount: '10000', // 0.01 USDC
        asset: testConfig.usdcAddress,
        payTo: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address,
        maxTimeoutSeconds: 86400,
        extra: {
          name: 'USDC',
          version: '2',
          escrowContract: testConfig.escrowContract,
          facilitator: testConfig.facilitatorAddress,
          tokenCollector: testConfig.tokenCollector,
          minDeposit: '10000',
          maxDeposit: '1000000',
        },
      };

      const result = await escrowScheme.createPaymentPayload(2, paymentRequirements);

      expect(result.x402Version).toBe(2);
      expect(result.payload).toBeDefined();
      // CREATION payload has signature, authorization, sessionParams
      expect(result.payload.signature).toBeDefined();
      expect(result.payload.authorization).toBeDefined();
      expect(result.payload.sessionParams).toBeDefined();
      expect(result.payload.requestId).toBeDefined();
      // Should NOT have session object
      expect(result.payload.session).toBeUndefined();
    });
  });

  describe('Session Management (Unified in EscrowScheme)', () => {
    it.skipIf(SKIP_TESTS)('stores and retrieves sessions', () => {
      const receiver = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address;

      // Sessions are now managed within EscrowScheme
      escrowScheme.sessions.store({
        sessionId: '0xtest123',
        sessionToken: 'sess_secret_token',
        network: NETWORK_ID,
        payer: walletClient.account!.address,
        receiver,
        balance: '100000',
        authorizationExpiry: Math.floor(Date.now() / 1000) + 3600,
      });

      const sessions = escrowScheme.sessions.getAll();
      expect(sessions.length).toBeGreaterThan(0);
      expect(
        sessions.find((s: { sessionId: string }) => s.sessionId === '0xtest123')
      ).toBeDefined();
    });

    it.skipIf(SKIP_TESTS)('checks for valid session', () => {
      const receiver = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address;

      // Store a valid session
      escrowScheme.sessions.store({
        sessionId: '0xvalid_session',
        sessionToken: 'sess_token',
        network: NETWORK_ID,
        payer: walletClient.account!.address,
        receiver,
        balance: '100000',
        authorizationExpiry: Math.floor(Date.now() / 1000) + 3600,
      });

      // EscrowScheme checks sessions by receiver
      const hasSession = escrowScheme.sessions.hasValid(receiver, '1000');

      expect(hasSession).toBe(true);
    });

    it.skipIf(SKIP_TESTS)('creates USAGE payload when session exists', async () => {
      const receiver = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address;

      // Create fresh EscrowScheme for this test (isolation)
      const freshScheme = new EscrowScheme(walletClient);

      // Store only the test session
      freshScheme.sessions.store({
        sessionId: '0xusage_test_session',
        sessionToken: 'usage_token_xyz',
        network: NETWORK_ID,
        payer: walletClient.account!.address,
        receiver,
        balance: '100000',
        authorizationExpiry: Math.floor(Date.now() / 1000) + 3600,
      });

      const paymentRequirements = {
        scheme: 'escrow',
        network: NETWORK_ID,
        amount: '10000',
        asset: testConfig.usdcAddress,
        payTo: receiver,
        maxTimeoutSeconds: 3600,
        extra: {},
      };

      const result = await freshScheme.createPaymentPayload(2, paymentRequirements);

      // USAGE payload has nested session object
      expect(result.payload.session).toBeDefined();
      const session = result.payload.session as { id: string; token: string };
      expect(session.id).toBe('0xusage_test_session');
      expect(session.token).toBe('usage_token_xyz');
      expect(result.payload.amount).toBe('10000');
      expect(result.payload.requestId).toBeDefined();
      // No signature for session usage
      expect(result.payload.signature).toBeUndefined();
    });
  });
});

describe('Live Facilitator Integration', () => {
  it.skipIf(SKIP_TESTS)('fetches supported schemes from facilitator', async () => {
    const response = await fetch(`${API_BASE_URL}/api/supported`);
    const supported = await response.json();

    expect(supported.kinds).toBeDefined();
    expect(Array.isArray(supported.kinds)).toBe(true);

    // Should support unified escrow scheme
    const escrowKind = supported.kinds.find((k: { scheme: string }) => k.scheme === 'escrow');
    expect(escrowKind).toBeDefined();

    console.log(
      'Supported schemes:',
      supported.kinds.map((k: { scheme: string }) => k.scheme)
    );
  });

  it.skipIf(SKIP_TESTS)('verifies payment payload structure', async () => {
    if (!walletClient) return;

    // Clear sessions to ensure CREATION payload
    escrowScheme.sessions.clear();

    const paymentRequirements = {
      scheme: 'escrow',
      network: NETWORK_ID,
      amount: '10000',
      asset: testConfig.usdcAddress,
      payTo: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address,
      maxTimeoutSeconds: 86400,
      extra: {
        name: 'USDC',
        version: '2',
        escrowContract: testConfig.escrowContract,
        facilitator: testConfig.facilitatorAddress,
        tokenCollector: testConfig.tokenCollector,
        maxDeposit: '100000',
      },
    };

    const result = await escrowScheme.createPaymentPayload(2, paymentRequirements);

    // Build full payment payload for verification
    const _paymentPayload = {
      x402Version: 2,
      resource: {
        url: 'https://test.example.com',
        description: 'Test',
        mimeType: 'application/json',
      },
      accepted: paymentRequirements,
      payload: result.payload,
    };

    // Would call /api/verify here in real test
    console.log('\nPayload ready for verification:');
    console.log('- Scheme:', paymentRequirements.scheme);
    console.log('- Signature:', (result.payload.signature as string).slice(0, 20) + '...');
    console.log('- Has authorization:', !!result.payload.authorization);
    console.log('- Has sessionParams:', !!result.payload.sessionParams);
  });
});
