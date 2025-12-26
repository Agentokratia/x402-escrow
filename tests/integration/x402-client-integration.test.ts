/**
 * x402 Client Integration Tests
 *
 * Tests EscrowScheme with x402Client integration patterns.
 *
 * The unified EscrowScheme handles both session creation and usage automatically.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createWalletClient, http, type WalletClient, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';

// Our escrow scheme and wrappers
import {
  EscrowScheme,
  withSessionExtraction,
  withAxiosSessionExtraction,
} from '@agentokratia/x402-escrow/client';

// For testing x402Client directly
import { x402Client } from '@x402/core/client';

// Test configuration
const TEST_PAYER_PRIVATE_KEY = process.env.TEST_PAYER_PRIVATE_KEY;
const SKIP_TESTS = !TEST_PAYER_PRIVATE_KEY;

// Test addresses
const TEST_RECEIVER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address;

describe('x402 Client Integration', () => {
  let walletClient: WalletClient;

  beforeAll(() => {
    if (SKIP_TESTS) {
      console.warn('Skipping - missing TEST_PAYER_PRIVATE_KEY');
      return;
    }

    const account = privateKeyToAccount(TEST_PAYER_PRIVATE_KEY as `0x${string}`);
    walletClient = createWalletClient({
      account,
      chain: baseSepolia,
      transport: http(),
    });
  });

  describe('EscrowScheme', () => {
    it.skipIf(SKIP_TESTS)('implements SchemeNetworkClient', () => {
      const escrowScheme = new EscrowScheme(walletClient);
      expect(escrowScheme.scheme).toBe('escrow');
      expect(typeof escrowScheme.createPaymentPayload).toBe('function');
    });

    it.skipIf(SKIP_TESTS)('exposes network publicly', () => {
      const escrowScheme = new EscrowScheme(walletClient);
      expect(escrowScheme.network).toBe('eip155:84532');
    });

    it.skipIf(SKIP_TESTS)('exposes payer address', () => {
      const escrowScheme = new EscrowScheme(walletClient);
      expect(escrowScheme.address).toBe(walletClient.account!.address);
    });

    it.skipIf(SKIP_TESTS)('exposes session manager', () => {
      const escrowScheme = new EscrowScheme(walletClient);
      expect(escrowScheme.sessions).toBeDefined();
      expect(typeof escrowScheme.sessions.getAll).toBe('function');
      expect(typeof escrowScheme.sessions.store).toBe('function');
      expect(typeof escrowScheme.sessions.hasValid).toBe('function');
      expect(typeof escrowScheme.sessions.updateBalance).toBe('function');
      expect(typeof escrowScheme.sessions.clear).toBe('function');
      expect(typeof escrowScheme.sessions.remove).toBe('function');
      expect(typeof escrowScheme.sessions.getForReceiver).toBe('function');
    });

    it.skipIf(SKIP_TESTS)('can be registered on x402Client', () => {
      const testClient = new x402Client().register('eip155:84532', new EscrowScheme(walletClient));

      expect(testClient).toBeDefined();
    });
  });

  describe('Payment Payload Creation', () => {
    it.skipIf(SKIP_TESTS)('creates CREATION payload when no session exists', async () => {
      const escrowScheme = new EscrowScheme(walletClient);

      const requirements = {
        scheme: 'escrow',
        network: 'eip155:84532' as const,
        amount: '10000',
        asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        payTo: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        maxTimeoutSeconds: 86400,
        extra: {
          name: 'USDC',
          version: '2',
          escrowContract: '0xbDEa0d1BCc5966192b070fDF62ab4eF5B4420Cff',
          facilitator: '0x923516a65a6de70e7d8a32a2C834c73d4084AA2b',
          tokenCollector: '0x0E3Df9510De65469C4518D7843919c0B8c7a7757',
          maxDeposit: '1000000',
        },
      };

      const result = await escrowScheme.createPaymentPayload(2, requirements);

      expect(result.x402Version).toBe(2);
      expect(result.payload).toBeDefined();
      // CREATION payload has signature, authorization, sessionParams
      expect(result.payload.signature).toBeDefined();
      expect(result.payload.authorization).toBeDefined();
      expect(result.payload.sessionParams).toBeDefined();
      expect(result.payload.requestId).toBeDefined();
      // Should NOT have session object (that's for usage)
      expect(result.payload.session).toBeUndefined();
    });

    it.skipIf(SKIP_TESTS)('creates USAGE payload when session exists', async () => {
      const escrowScheme = new EscrowScheme(walletClient);

      // Store a test session
      escrowScheme.sessions.store({
        sessionId: '0xtest123',
        sessionToken: 'test_token_abc',
        network: 'eip155:84532',
        payer: walletClient.account!.address,
        receiver: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address,
        balance: '100000',
        authorizationExpiry: Math.floor(Date.now() / 1000) + 3600,
      });

      const requirements = {
        scheme: 'escrow',
        network: 'eip155:84532' as const,
        amount: '10000',
        asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        payTo: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        maxTimeoutSeconds: 3600,
        extra: {},
      };

      const result = await escrowScheme.createPaymentPayload(2, requirements);

      expect(result.x402Version).toBe(2);
      // USAGE payload has nested session object
      expect(result.payload.session).toBeDefined();
      const session = result.payload.session as { id: string; token: string };
      expect(session.id).toBe('0xtest123');
      expect(session.token).toBe('test_token_abc');
      expect(result.payload.requestId).toBeDefined();
      expect(result.payload.amount).toBe('10000');
      // No signature for session usage
      expect(result.payload.signature).toBeUndefined();
    });
  });

  describe('Session Management', () => {
    it.skipIf(SKIP_TESTS)('can store and retrieve sessions', () => {
      const escrowScheme = new EscrowScheme(walletClient);

      escrowScheme.sessions.store({
        sessionId: '0xsession1',
        sessionToken: 'token1',
        network: 'eip155:84532',
        payer: walletClient.account!.address,
        receiver: TEST_RECEIVER,
        balance: '100000',
        authorizationExpiry: Math.floor(Date.now() / 1000) + 3600,
      });

      const sessions = escrowScheme.sessions.getAll();
      expect(sessions.length).toBe(1);
      expect(sessions[0].sessionId).toBe('0xsession1');
    });

    it.skipIf(SKIP_TESTS)('can remove specific session', () => {
      const escrowScheme = new EscrowScheme(walletClient);

      escrowScheme.sessions.store({
        sessionId: '0xsession1',
        sessionToken: 'token1',
        network: 'eip155:84532',
        payer: walletClient.account!.address,
        receiver: TEST_RECEIVER,
        balance: '100000',
        authorizationExpiry: Math.floor(Date.now() / 1000) + 3600,
      });

      escrowScheme.sessions.store({
        sessionId: '0xsession2',
        sessionToken: 'token2',
        network: 'eip155:84532',
        payer: walletClient.account!.address,
        receiver: TEST_RECEIVER,
        balance: '50000',
        authorizationExpiry: Math.floor(Date.now() / 1000) + 3600,
      });

      expect(escrowScheme.sessions.getAll().length).toBe(2);

      escrowScheme.sessions.remove('0xsession1');
      expect(escrowScheme.sessions.getAll().length).toBe(1);
      expect(escrowScheme.sessions.getAll()[0].sessionId).toBe('0xsession2');
    });

    it.skipIf(SKIP_TESTS)('can clear all sessions', () => {
      const escrowScheme = new EscrowScheme(walletClient);

      escrowScheme.sessions.store({
        sessionId: '0xsession1',
        sessionToken: 'token1',
        network: 'eip155:84532',
        payer: walletClient.account!.address,
        receiver: TEST_RECEIVER,
        balance: '100000',
        authorizationExpiry: Math.floor(Date.now() / 1000) + 3600,
      });

      escrowScheme.sessions.clear();
      expect(escrowScheme.sessions.getAll().length).toBe(0);
    });

    it.skipIf(SKIP_TESTS)('can update session balance', () => {
      const escrowScheme = new EscrowScheme(walletClient);

      escrowScheme.sessions.store({
        sessionId: '0xsession1',
        sessionToken: 'token1',
        network: 'eip155:84532',
        payer: walletClient.account!.address,
        receiver: TEST_RECEIVER,
        balance: '100000',
        authorizationExpiry: Math.floor(Date.now() / 1000) + 3600,
      });

      escrowScheme.sessions.updateBalance('0xsession1', '90000');

      const sessions = escrowScheme.sessions.getAll();
      expect(sessions[0].balance).toBe('90000');
    });

    it.skipIf(SKIP_TESTS)('hasValid checks receiver and amount', () => {
      const escrowScheme = new EscrowScheme(walletClient);

      escrowScheme.sessions.store({
        sessionId: '0xsession1',
        sessionToken: 'token1',
        network: 'eip155:84532',
        payer: walletClient.account!.address,
        receiver: TEST_RECEIVER,
        balance: '100000',
        authorizationExpiry: Math.floor(Date.now() / 1000) + 3600,
      });

      // Has session with sufficient balance
      expect(escrowScheme.sessions.hasValid(TEST_RECEIVER, '50000')).toBe(true);

      // Has session but insufficient balance
      expect(escrowScheme.sessions.hasValid(TEST_RECEIVER, '200000')).toBe(false);

      // Wrong receiver
      const wrongReceiver = '0x1234567890123456789012345678901234567890' as Address;
      expect(escrowScheme.sessions.hasValid(wrongReceiver, '50000')).toBe(false);
    });

    it.skipIf(SKIP_TESTS)('getForReceiver returns correct session', () => {
      const escrowScheme = new EscrowScheme(walletClient);

      escrowScheme.sessions.store({
        sessionId: '0xsession1',
        sessionToken: 'token1',
        network: 'eip155:84532',
        payer: walletClient.account!.address,
        receiver: TEST_RECEIVER,
        balance: '100000',
        authorizationExpiry: Math.floor(Date.now() / 1000) + 3600,
      });

      const session = escrowScheme.sessions.getForReceiver(TEST_RECEIVER);
      expect(session).not.toBeNull();
      expect(session!.sessionId).toBe('0xsession1');

      // Wrong receiver
      const wrongReceiver = '0x1234567890123456789012345678901234567890' as Address;
      const noSession = escrowScheme.sessions.getForReceiver(wrongReceiver);
      expect(noSession).toBeNull();
    });
  });

  describe('Session Wrappers', () => {
    it.skipIf(SKIP_TESTS)('withSessionExtraction wraps fetch', () => {
      const escrowScheme = new EscrowScheme(walletClient);
      const mockFetch = async () => new Response('ok', { status: 200 });

      const wrappedFetch = withSessionExtraction(mockFetch, escrowScheme);

      expect(typeof wrappedFetch).toBe('function');
    });

    it.skipIf(SKIP_TESTS)('withAxiosSessionExtraction returns interceptor', () => {
      const escrowScheme = new EscrowScheme(walletClient);

      const interceptor = withAxiosSessionExtraction(escrowScheme);

      expect(typeof interceptor).toBe('function');
    });
  });

  describe('Integration Pattern', () => {
    it.skipIf(SKIP_TESTS)('demonstrates standard x402Client integration', () => {
      const escrowScheme = new EscrowScheme(walletClient);

      // Register with x402Client
      const client = new x402Client().register('eip155:84532', escrowScheme);

      expect(client).toBeDefined();
      expect(escrowScheme.network).toBe('eip155:84532');
      expect(escrowScheme.sessions.getAll()).toHaveLength(0);

      console.log(`
=============================================================================
CLIENT INTEGRATION - x402Client + Session Wrappers
=============================================================================

import { x402Client } from '@x402/core/client';
import { wrapFetchWithPayment } from '@x402/fetch';
import { EscrowScheme, withSessionExtraction } from '@agentokratia/x402-escrow/client';

// Create scheme - network derived from wallet
const escrowScheme = new EscrowScheme(walletClient);

// Register with x402Client (for payment creation)
const x402 = new x402Client()
  .register('eip155:84532', escrowScheme)
  .onAfterPaymentCreation(async (ctx) => {
    console.log('Payment created:', ctx.paymentPayload);
  });

// Wrap fetch with payment + session extraction
const paidFetch = wrapFetchWithPayment(fetch, x402);
const escrowFetch = withSessionExtraction(paidFetch, escrowScheme);

// Make paid requests - sessions handled automatically
const response = await escrowFetch('https://api.example.com/premium');

// Access sessions
escrowScheme.sessions.getAll();
escrowScheme.sessions.hasValid(receiverAddress, '10000');

=============================================================================
`);
    });

    it.skipIf(SKIP_TESTS)('demonstrates axios integration', () => {
      const escrowScheme = new EscrowScheme(walletClient);

      expect(escrowScheme).toBeDefined();

      console.log(`
=============================================================================
CLIENT INTEGRATION - Axios
=============================================================================

import { x402Client } from '@x402/core/client';
import { wrapAxiosWithPayment } from '@x402/axios';
import { EscrowScheme, withAxiosSessionExtraction } from '@agentokratia/x402-escrow/client';

const escrowScheme = new EscrowScheme(walletClient);
const x402 = new x402Client().register('eip155:84532', escrowScheme);

const paidAxios = wrapAxiosWithPayment(axios.create(), x402);
paidAxios.interceptors.response.use(withAxiosSessionExtraction(escrowScheme));

const response = await paidAxios.get('https://api.example.com/premium');

=============================================================================
`);
    });
  });
});
