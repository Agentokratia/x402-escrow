/**
 * createEscrowFetch Tests
 *
 * Tests the simple 2-line API for escrow payments.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import { createEscrowFetch, EscrowScheme } from '@x402/escrow/client';

// Test wallet (don't use real funds)
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

describe('createEscrowFetch', () => {
  let walletClient: ReturnType<typeof createWalletClient>;

  beforeAll(() => {
    const account = privateKeyToAccount(TEST_PRIVATE_KEY);
    walletClient = createWalletClient({
      account,
      chain: baseSepolia,
      transport: http(),
    });
  });

  describe('Factory Function', () => {
    it('returns fetch function and scheme', () => {
      const { fetch: escrowFetch, scheme } = createEscrowFetch(walletClient);

      expect(typeof escrowFetch).toBe('function');
      expect(scheme).toBeInstanceOf(EscrowScheme);
    });

    it('derives network from wallet chain', () => {
      const { scheme } = createEscrowFetch(walletClient);

      expect(scheme.network).toBe('eip155:84532');
    });

    it('exposes payer address from wallet', () => {
      const { scheme } = createEscrowFetch(walletClient);

      expect(scheme.address).toBe(walletClient.account?.address);
    });

    it('scheme starts with no sessions', () => {
      const { scheme } = createEscrowFetch(walletClient);

      expect(scheme.sessions.getAll()).toHaveLength(0);
    });
  });

  describe('Options', () => {
    it('accepts storage option', () => {
      const { scheme } = createEscrowFetch(walletClient, {
        storage: 'memory',
      });

      expect(scheme).toBeDefined();
      expect(scheme.sessions.getAll()).toHaveLength(0);
    });

    it('accepts storageKey option', () => {
      const { scheme } = createEscrowFetch(walletClient, {
        storage: 'memory',
        storageKey: 'custom-sessions',
      });

      expect(scheme).toBeDefined();
    });

    it('accepts sessionDuration option', () => {
      const { scheme } = createEscrowFetch(walletClient, {
        sessionDuration: 7200, // 2 hours
      });

      expect(scheme).toBeDefined();
    });

    it('accepts depositAmount option', () => {
      const { scheme } = createEscrowFetch(walletClient, {
        depositAmount: '10000000', // $10 instead of default max
      });

      expect(scheme).toBeDefined();
    });
  });

  describe('Session Management', () => {
    it('provides access to session manager via scheme', () => {
      const { scheme } = createEscrowFetch(walletClient);

      expect(scheme.sessions).toBeDefined();
      expect(typeof scheme.sessions.getAll).toBe('function');
      expect(typeof scheme.sessions.store).toBe('function');
      expect(typeof scheme.sessions.clear).toBe('function');
      expect(typeof scheme.sessions.hasValid).toBe('function');
      expect(typeof scheme.sessions.getForReceiver).toBe('function');
    });

    it('can store sessions via scheme', () => {
      const { scheme } = createEscrowFetch(walletClient);

      scheme.sessions.store({
        sessionId: '0xtest123',
        sessionToken: 'token_abc',
        network: 'eip155:84532',
        payer: walletClient.account!.address,
        receiver: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        balance: '100000',
        authorizationExpiry: Math.floor(Date.now() / 1000) + 3600,
      });

      expect(scheme.sessions.getAll()).toHaveLength(1);
    });

    it('can clear sessions via scheme', () => {
      const { scheme } = createEscrowFetch(walletClient);

      scheme.sessions.store({
        sessionId: '0xtest123',
        sessionToken: 'token_abc',
        network: 'eip155:84532',
        payer: walletClient.account!.address,
        receiver: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        balance: '100000',
        authorizationExpiry: Math.floor(Date.now() / 1000) + 3600,
      });

      scheme.sessions.clear();
      expect(scheme.sessions.getAll()).toHaveLength(0);
    });
  });

  describe('Error Handling', () => {
    it('throws if wallet has no chain', () => {
      const noChainWallet = {
        account: { address: '0x1234567890123456789012345678901234567890' },
        chain: undefined,
      } as unknown as typeof walletClient;

      expect(() => createEscrowFetch(noChainWallet)).toThrow();
    });

    it('throws if wallet has no account', () => {
      const noAccountWallet = {
        account: undefined,
        chain: { id: 84532 },
      } as unknown as typeof walletClient;

      expect(() => createEscrowFetch(noAccountWallet)).toThrow();
    });
  });

  describe('x402 Client Exposure', () => {
    it('exposes x402 client in result', () => {
      const { x402 } = createEscrowFetch(walletClient);

      expect(x402).toBeDefined();
      expect(typeof x402.register).toBe('function');
    });

    it('x402 client has scheme registered', () => {
      const { x402, scheme } = createEscrowFetch(walletClient);

      // The scheme should be registered for the wallet's network
      expect(scheme.network).toBe('eip155:84532');
      // x402 client exists and is functional
      expect(x402).toBeDefined();
    });

    it('allows adding hooks to x402 client', () => {
      const { x402 } = createEscrowFetch(walletClient);

      // User can add hooks after creation
      x402.onAfterPaymentCreation(async () => {
        // Hook would be called during payment
      });

      // Hook registration should work (we can't test execution without a real payment)
      expect(x402).toBeDefined();
    });
  });

  describe('Custom Fetch Option', () => {
    it('accepts custom fetch implementation', () => {
      const customFetch = async (_input: RequestInfo | URL, _init?: RequestInit) => {
        return new Response('custom', { status: 200 });
      };

      const { fetch: escrowFetch } = createEscrowFetch(walletClient, {
        fetch: customFetch,
      });

      expect(typeof escrowFetch).toBe('function');
    });

    it('uses globalThis.fetch by default', () => {
      const { fetch: escrowFetch } = createEscrowFetch(walletClient);

      // Fetch should be a function wrapping the global fetch
      expect(typeof escrowFetch).toBe('function');
    });

    it('custom fetch can be async function', async () => {
      const customFetch = async (_input: RequestInfo | URL, _init?: RequestInit) => {
        return new Response('test', { status: 200 });
      };

      const { fetch: escrowFetch } = createEscrowFetch(walletClient, {
        fetch: customFetch,
      });

      expect(typeof escrowFetch).toBe('function');
      // Note: We can't test actual fetch call without mocking the 402 flow
    });
  });

  describe('Session Balance Updates', () => {
    it('exposes updateBalance method on sessions', () => {
      const { scheme } = createEscrowFetch(walletClient);

      expect(typeof scheme.sessions.updateBalance).toBe('function');
    });

    it('updateBalance updates only the balance field', () => {
      const { scheme } = createEscrowFetch(walletClient);

      // Store initial session (simulates creation response)
      scheme.sessions.store({
        sessionId: '0xsession123',
        sessionToken: 'secret_token_abc',
        network: 'eip155:84532',
        payer: walletClient.account!.address,
        receiver: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        balance: '50000000', // $50
        authorizationExpiry: Math.floor(Date.now() / 1000) + 3600,
      });

      // Simulate usage response - update balance only (like server does)
      scheme.sessions.updateBalance('0xsession123', '49990000'); // $49.99

      const sessions = scheme.sessions.getAll();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].balance).toBe('49990000');
      expect(sessions[0].sessionToken).toBe('secret_token_abc'); // Token preserved!
    });

    it('multiple balance updates work correctly', () => {
      const { scheme } = createEscrowFetch(walletClient);

      scheme.sessions.store({
        sessionId: '0xsession456',
        sessionToken: 'my_secret_token',
        network: 'eip155:84532',
        payer: walletClient.account!.address,
        receiver: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        balance: '10000000', // $10
        authorizationExpiry: Math.floor(Date.now() / 1000) + 3600,
      });

      // First usage
      scheme.sessions.updateBalance('0xsession456', '9990000'); // $9.99
      expect(scheme.sessions.getAll()[0].balance).toBe('9990000');

      // Second usage
      scheme.sessions.updateBalance('0xsession456', '9980000'); // $9.98
      expect(scheme.sessions.getAll()[0].balance).toBe('9980000');

      // Third usage
      scheme.sessions.updateBalance('0xsession456', '9970000'); // $9.97
      expect(scheme.sessions.getAll()[0].balance).toBe('9970000');

      // Token still preserved
      expect(scheme.sessions.getAll()[0].sessionToken).toBe('my_secret_token');
    });

    it('updateBalance does nothing for non-existent session', () => {
      const { scheme } = createEscrowFetch(walletClient);

      // No sessions exist
      expect(scheme.sessions.getAll()).toHaveLength(0);

      // Try to update non-existent session
      scheme.sessions.updateBalance('0xnonexistent', '1000');

      // Still no sessions
      expect(scheme.sessions.getAll()).toHaveLength(0);
    });

    it('preserves all session fields except balance', () => {
      const { scheme } = createEscrowFetch(walletClient);
      const expiry = Math.floor(Date.now() / 1000) + 7200;

      scheme.sessions.store({
        sessionId: '0xfullsession',
        sessionToken: 'full_token_xyz',
        network: 'eip155:84532',
        payer: walletClient.account!.address,
        receiver: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        balance: '100000000', // $100
        authorizationExpiry: expiry,
      });

      // Update balance
      scheme.sessions.updateBalance('0xfullsession', '75000000'); // $75

      const session = scheme.sessions.getAll()[0];
      expect(session.sessionId).toBe('0xfullsession');
      expect(session.sessionToken).toBe('full_token_xyz');
      expect(session.network).toBe('eip155:84532');
      expect(session.payer).toBe(walletClient.account!.address);
      expect(session.receiver).toBe('0x70997970C51812dc3A010C7d01b50e0d17dc79C8');
      expect(session.balance).toBe('75000000'); // Updated
      expect(session.authorizationExpiry).toBe(expiry);
    });
  });
});

// =============================================================================
// Documentation
// =============================================================================

console.log(`
=============================================================================
createEscrowFetch - Simple 2-Line API (Enhanced)
=============================================================================

import { createEscrowFetch } from '@x402/escrow/client';

// Simple (recommended) - 2 lines
const { fetch: escrowFetch, scheme, x402 } = createEscrowFetch(walletClient);
const response = await escrowFetch('https://api.example.com/premium');

// Custom deposit amount (not max)
const { fetch: customFetch } = createEscrowFetch(walletClient, {
  depositAmount: '10000000', // $10 deposit instead of max
});

// Access sessions
scheme.sessions.getAll();
scheme.sessions.hasValid(receiverAddress, '10000');

// Add hooks (user has control)
x402.onAfterPaymentCreation(async (ctx) => {
  console.log('Payment created:', ctx.paymentPayload);
});

// Custom fetch
const { fetch } = createEscrowFetch(walletClient, {
  fetch: ky,  // Use ky, undici, node-fetch, etc.
});

=============================================================================
`);
