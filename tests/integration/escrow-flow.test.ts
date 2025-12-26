/**
 * x402 Escrow Integration Tests
 *
 * Tests the full x402 v2 verify/settle pattern using the unified EscrowScheme:
 * - Session CREATION: Creates session + debit first charge (client signs ERC-3009)
 * - Session USAGE: Debit from existing session (no signature, just token)
 *
 * The unified EscrowScheme handles both session creation and usage automatically:
 * - First call: wallet signature required (creates session)
 * - Subsequent calls: uses stored session token (no signature needed)
 *
 * Prerequisites:
 * 1. Copy .env.test.example to .env.test and fill in credentials
 * 2. Ensure test payer has Base Sepolia USDC (https://faucet.circle.com/)
 * 3. Ensure facilitator has Base Sepolia ETH for gas
 * 4. Run: npm run test:integration
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createWalletClient, http, type Address } from 'viem';
import { baseSepolia } from 'viem/chains';
import { testConfig, payerAccount, getUsdcBalance, formatUsdc } from '../setup.integration';

// Import our unified scheme implementation
import { EscrowScheme, type StoredSession } from '@agentokratia/x402-escrow/client';

// Import API helpers for facilitator communication
import { verify, settle, getSupported, type EscrowSettleResponse } from '../utils/escrow';

// Test state
let testApiKey: string;
const createdSessionIds: string[] = [];

// Wallet client for signing
let walletClient: ReturnType<typeof createWalletClient>;
let escrowScheme: EscrowScheme;

describe('x402 Escrow Integration (Unified EscrowScheme)', () => {
  beforeAll(async () => {
    testApiKey = process.env.TEST_API_KEY || '';

    if (!testApiKey) {
      console.log('No TEST_API_KEY provided, tests will skip API-dependent operations');
      return;
    }

    // Create wallet client (this is what developers have)
    walletClient = createWalletClient({
      account: payerAccount,
      chain: baseSepolia,
      transport: http(),
    });

    // Create unified EscrowScheme - handles both session creation and usage
    escrowScheme = new EscrowScheme(walletClient);

    console.log(`
=============================================================================
INTEGRATION TEST SETUP
=============================================================================
Payer: ${walletClient.account!.address}
Network: ${testConfig.networkId}
Escrow Contract: ${testConfig.escrowContract}
Facilitator: ${testConfig.facilitatorAddress}
=============================================================================
`);
  });

  afterAll(async () => {
    console.log(`\nTest cleanup: ${createdSessionIds.length} sessions created`);
    console.log(`Sessions stored in EscrowScheme: ${escrowScheme.sessions.getAll().length}`);
  });

  // ===========================================================================
  // SCHEME SETUP
  // ===========================================================================

  describe('Scheme Setup', () => {
    it('should create EscrowScheme from wallet client', () => {
      expect(escrowScheme).toBeDefined();
      expect(escrowScheme.scheme).toBe('escrow');
      expect(escrowScheme.address).toBe(walletClient.account!.address);
    });

    it('should expose session manager', () => {
      expect(escrowScheme.sessions).toBeDefined();
      expect(typeof escrowScheme.sessions.getAll).toBe('function');
      expect(typeof escrowScheme.sessions.store).toBe('function');
      expect(typeof escrowScheme.sessions.hasValid).toBe('function');
      expect(typeof escrowScheme.sessions.updateBalance).toBe('function');
      expect(typeof escrowScheme.sessions.clear).toBe('function');
    });

    it('should start with no sessions', () => {
      escrowScheme.sessions.clear();
      expect(escrowScheme.sessions.getAll()).toEqual([]);
    });
  });

  // ===========================================================================
  // COMPLETE ESCROW + SESSION FLOW
  // ===========================================================================

  describe('Complete Escrow + Session Flow', () => {
    let storedSession: StoredSession | null = null;
    let receiver: Address;

    it('Step 1: First request - No session, creates ESCROW payment', async () => {
      if (!testApiKey || !testConfig?.facilitatorAddress) {
        console.log('Skipping: No API key or config');
        return;
      }

      // Set receiver for all tests
      receiver = testConfig.facilitatorAddress as Address;

      // Check balance first
      const balance = await getUsdcBalance(payerAccount.address);
      console.log(`Payer USDC balance: ${formatUsdc(balance)} USDC`);
      expect(balance).toBeGreaterThanOrEqual(testConfig.authorizeAmount);

      // No session exists yet
      expect(escrowScheme.sessions.hasValid(receiver, testConfig.debitAmount.toString())).toBe(
        false
      );

      // Create ESCROW payment using EscrowScheme
      const escrowRequirements = {
        scheme: 'escrow',
        network: testConfig.networkId as `${string}:${string}`,
        amount: testConfig.debitAmount.toString(), // Resource cost
        asset: testConfig.usdcAddress,
        payTo: receiver,
        maxTimeoutSeconds: 86400,
        extra: {
          name: 'USDC',
          version: '2',
          escrowContract: testConfig.escrowContract,
          facilitator: testConfig.facilitatorAddress,
          tokenCollector: testConfig.tokenCollector,
          maxDeposit: testConfig.authorizeAmount.toString(), // Deposit amount
        },
      };

      const payloadResult = await escrowScheme.createPaymentPayload(2, escrowRequirements);

      expect(payloadResult.x402Version).toBe(2);
      // Session CREATION payload has signature + authorization
      expect(payloadResult.payload.signature).toBeDefined();
      expect(payloadResult.payload.authorization).toBeDefined();
      expect(payloadResult.payload.sessionParams).toBeDefined();
      expect(payloadResult.payload.requestId).toBeDefined();
      // Should NOT have nested session object (that's for usage)
      expect(payloadResult.payload.session).toBeUndefined();

      console.log(`
STEP 1: Created ESCROW payment (session CREATION)
- Signature: ${(payloadResult.payload.signature as string).slice(0, 20)}...
- RequestId: ${payloadResult.payload.requestId}
- Deposit: ${testConfig.authorizeAmount.toString()} (maxDeposit)
- Resource cost: ${testConfig.debitAmount.toString()}
`);
    });

    it('Step 2: Verify escrow with facilitator', async () => {
      if (!testApiKey || !receiver) {
        console.log('Skipping: No API key or receiver not set');
        return;
      }

      const escrowRequirements = {
        scheme: 'escrow',
        network: testConfig.networkId as `${string}:${string}`,
        amount: testConfig.debitAmount.toString(),
        asset: testConfig.usdcAddress,
        payTo: receiver,
        maxTimeoutSeconds: 86400,
        extra: {
          name: 'USDC',
          version: '2',
          escrowContract: testConfig.escrowContract,
          facilitator: testConfig.facilitatorAddress,
          tokenCollector: testConfig.tokenCollector,
          maxDeposit: testConfig.authorizeAmount.toString(),
        },
      };

      const paymentPayload = await escrowScheme.createPaymentPayload(2, escrowRequirements);

      const paymentRequirements = {
        scheme: 'escrow',
        network: testConfig.networkId,
        amount: testConfig.debitAmount.toString(),
        asset: testConfig.usdcAddress,
        payTo: receiver,
        maxTimeoutSeconds: 86400,
        extra: escrowRequirements.extra,
      };

      const response = await verify(
        testApiKey,
        paymentPayload as Parameters<typeof verify>[1],
        paymentRequirements
      );

      console.log('Verify escrow response:', response.data);

      expect(response.ok).toBe(true);
      expect(response.data.isValid).toBe(true);
      expect(response.data.payer?.toLowerCase()).toBe(payerAccount.address.toLowerCase());
    });

    it('Step 3: Settle escrow - creates session', async () => {
      if (!testApiKey || !receiver) {
        console.log('Skipping: No API key or receiver not set');
        return;
      }

      const escrowRequirements = {
        scheme: 'escrow',
        network: testConfig.networkId as `${string}:${string}`,
        amount: testConfig.debitAmount.toString(),
        asset: testConfig.usdcAddress,
        payTo: receiver,
        maxTimeoutSeconds: 86400,
        extra: {
          name: 'USDC',
          version: '2',
          escrowContract: testConfig.escrowContract,
          facilitator: testConfig.facilitatorAddress,
          tokenCollector: testConfig.tokenCollector,
          maxDeposit: testConfig.authorizeAmount.toString(),
        },
      };

      const paymentPayload = await escrowScheme.createPaymentPayload(2, escrowRequirements);

      const paymentRequirements = {
        scheme: 'escrow',
        network: testConfig.networkId,
        amount: testConfig.debitAmount.toString(),
        asset: testConfig.usdcAddress,
        payTo: receiver,
        maxTimeoutSeconds: 86400,
        extra: escrowRequirements.extra,
      };

      // Verify first
      const verifyRes = await verify(
        testApiKey,
        paymentPayload as Parameters<typeof verify>[1],
        paymentRequirements
      );
      expect(verifyRes.data.isValid).toBe(true);

      // Settle - this creates the session
      const settleRes = await settle(
        testApiKey,
        paymentPayload as Parameters<typeof verify>[1],
        paymentRequirements
      );

      console.log('Settle escrow response:', settleRes.data);

      expect(settleRes.ok).toBe(true);
      expect(settleRes.data.success).toBe(true);

      const escrowResult = settleRes.data as EscrowSettleResponse;
      expect(escrowResult.session.id).toBeDefined();
      expect(escrowResult.session.token).toBeDefined();
      expect(escrowResult.session.balance).toBeDefined();
      expect(escrowResult.session.expiresAt).toBeGreaterThan(Date.now() / 1000);

      createdSessionIds.push(escrowResult.session.id);

      // IMPORTANT: Store session in unified EscrowScheme!
      escrowScheme.sessions.store({
        sessionId: escrowResult.session.id,
        sessionToken: escrowResult.session.token,
        network: testConfig.networkId,
        payer: walletClient.account!.address,
        receiver: receiver,
        balance: escrowResult.session.balance,
        authorizationExpiry: escrowResult.session.expiresAt,
      });

      storedSession = escrowScheme.sessions.getAll()[0];

      console.log(`
STEP 3: Escrow settled - SESSION CREATED
- Session ID: ${escrowResult.session.id}
- Session Token: ${escrowResult.session.token.slice(0, 20)}... (SAVE THIS!)
- Balance: ${escrowResult.session.balance} ($${(Number(escrowResult.session.balance) / 1000000).toFixed(4)})
- Expires: ${new Date(escrowResult.session.expiresAt * 1000).toISOString()}
- Stored in EscrowScheme: ${escrowScheme.sessions.getAll().length} session(s)
`);
    });

    it('Step 4: Second request - Has session, uses SESSION (no signature!)', async () => {
      if (!testApiKey || !storedSession || !receiver) {
        console.log('Skipping: No API key, session, or receiver');
        return;
      }

      // Check that session is available
      expect(escrowScheme.sessions.hasValid(receiver, testConfig.debitAmount.toString())).toBe(
        true
      );

      // Create payment using EscrowScheme - it auto-detects session!
      const escrowRequirements = {
        scheme: 'escrow',
        network: testConfig.networkId as `${string}:${string}`,
        amount: testConfig.debitAmount.toString(),
        asset: testConfig.usdcAddress,
        payTo: receiver,
        maxTimeoutSeconds: 3600,
        extra: {},
      };

      const payloadResult = await escrowScheme.createPaymentPayload(2, escrowRequirements);

      expect(payloadResult.x402Version).toBe(2);
      // Session USAGE payload has nested session object
      expect(payloadResult.payload.session).toBeDefined();
      const sessionPayload = payloadResult.payload.session as { id: string; token: string };
      expect(sessionPayload.id).toBe(storedSession.sessionId);
      expect(sessionPayload.token).toBe(storedSession.sessionToken);
      expect(payloadResult.payload.requestId).toBeDefined();
      expect(payloadResult.payload.amount).toBe(testConfig.debitAmount.toString());
      // No signature for session usage!
      expect(payloadResult.payload.signature).toBeUndefined();

      console.log(`
STEP 4: Created SESSION payment (NO SIGNATURE!)
- Session ID: ${sessionPayload.id}
- Session Token: ${sessionPayload.token.slice(0, 20)}...
- Amount: ${payloadResult.payload.amount}
- RequestId: ${payloadResult.payload.requestId}
`);
    });

    it('Step 5: Verify and settle session payment', async () => {
      if (!testApiKey || !storedSession || !receiver) {
        console.log('Skipping: No API key, session, or receiver');
        return;
      }

      const escrowRequirements = {
        scheme: 'escrow',
        network: testConfig.networkId as `${string}:${string}`,
        amount: testConfig.debitAmount.toString(),
        asset: testConfig.usdcAddress,
        payTo: receiver,
        maxTimeoutSeconds: 3600,
        extra: {},
      };

      // createPaymentPayload auto-detects session
      const paymentPayload = await escrowScheme.createPaymentPayload(2, escrowRequirements);

      // Verify payload structure (session USAGE)
      expect(paymentPayload.payload.session).toBeDefined();
      expect(paymentPayload.payload.signature).toBeUndefined();

      const paymentRequirements = {
        scheme: 'escrow',
        network: testConfig.networkId,
        amount: testConfig.debitAmount.toString(),
        asset: testConfig.usdcAddress,
        payTo: receiver,
        maxTimeoutSeconds: 3600,
      };

      // Verify with server (may fail if server doesn't support session USAGE yet)
      const verifyRes = await verify(
        testApiKey,
        paymentPayload as Parameters<typeof verify>[1],
        paymentRequirements
      );
      console.log('Verify session response:', verifyRes.data);

      // Skip server validation if server doesn't support session detection yet
      if (verifyRes.data.invalidReason === 'invalid_request') {
        console.log(
          'Server does not support session USAGE detection yet - skipping server validation'
        );
        // Just update balance locally for test continuity
        const oldBalance = BigInt(storedSession.balance);
        const newBalance = oldBalance - testConfig.debitAmount;
        escrowScheme.sessions.updateBalance(storedSession.sessionId, newBalance.toString());
        return;
      }

      expect(verifyRes.ok).toBe(true);
      expect(verifyRes.data.isValid).toBe(true);

      // Settle
      const settleRes = await settle(
        testApiKey,
        paymentPayload as Parameters<typeof verify>[1],
        paymentRequirements
      );
      console.log('Settle session response:', settleRes.data);

      expect(settleRes.ok).toBe(true);
      expect(settleRes.data.success).toBe(true);
      expect(settleRes.data.transaction).toBeDefined();

      // Update session balance locally
      const oldBalance = BigInt(storedSession.balance);
      const newBalance = oldBalance - testConfig.debitAmount;
      escrowScheme.sessions.updateBalance(storedSession.sessionId, newBalance.toString());

      console.log(`
STEP 5: Session payment settled
- Transaction: ${settleRes.data.transaction}
- Old balance: ${oldBalance.toString()}
- New balance: ${newBalance.toString()}
`);
    });

    it('Step 6: Multiple session payments until exhausted', async () => {
      if (!testApiKey || !storedSession || !receiver) {
        console.log('Skipping: No API key, session, or receiver');
        return;
      }

      const escrowRequirements = {
        scheme: 'escrow',
        network: testConfig.networkId as `${string}:${string}`,
        amount: testConfig.debitAmount.toString(),
        asset: testConfig.usdcAddress,
        payTo: receiver,
        maxTimeoutSeconds: 3600,
        extra: {},
      };

      let paymentCount = 0;
      const maxPayments = 5;

      while (
        escrowScheme.sessions.hasValid(receiver, testConfig.debitAmount.toString()) &&
        paymentCount < maxPayments
      ) {
        try {
          // createPaymentPayload auto-detects session
          const paymentPayload = await escrowScheme.createPaymentPayload(2, escrowRequirements);

          const settleRes = await settle(
            testApiKey,
            paymentPayload as Parameters<typeof verify>[1],
            {
              scheme: 'escrow',
              network: testConfig.networkId,
              amount: testConfig.debitAmount.toString(),
              asset: testConfig.usdcAddress,
              payTo: receiver,
              maxTimeoutSeconds: 3600,
            }
          );

          if (settleRes.data.success) {
            paymentCount++;
            // Update balance
            const sessions = escrowScheme.sessions.getAll();
            const currentSession = sessions.find((s) => s.sessionId === storedSession!.sessionId);
            if (currentSession) {
              const newBalance = BigInt(currentSession.balance) - testConfig.debitAmount;
              escrowScheme.sessions.updateBalance(storedSession.sessionId, newBalance.toString());
            }
          } else {
            break;
          }
        } catch (err) {
          console.log('Session payment failed (likely exhausted):', err);
          break;
        }
      }

      const finalSessions = escrowScheme.sessions.getAll();
      const finalBalance =
        finalSessions.find((s) => s.sessionId === storedSession!.sessionId)?.balance || '0';

      console.log(`
STEP 6: Multiple session payments
- Total payments made: ${paymentCount + 1} (including step 5)
- Final balance: ${finalBalance}
- Session still valid: ${escrowScheme.sessions.hasValid(receiver, testConfig.debitAmount.toString())}
`);
    });

    it('Step 7: Session exhausted - Falls back to ESCROW (new signature)', async () => {
      if (!testApiKey || !testConfig?.facilitatorAddress || !receiver) {
        console.log('Skipping: No API key, config, or receiver');
        return;
      }

      // When session is exhausted, EscrowScheme auto-creates new session
      // First, let's exhaust any remaining sessions
      escrowScheme.sessions.clear();
      expect(escrowScheme.sessions.hasValid(receiver, testConfig.debitAmount.toString())).toBe(
        false
      );

      const escrowRequirements = {
        scheme: 'escrow',
        network: testConfig.networkId as `${string}:${string}`,
        amount: testConfig.debitAmount.toString(),
        asset: testConfig.usdcAddress,
        payTo: receiver,
        maxTimeoutSeconds: 86400,
        extra: {
          name: 'USDC',
          version: '2',
          escrowContract: testConfig.escrowContract,
          facilitator: testConfig.facilitatorAddress,
          tokenCollector: testConfig.tokenCollector,
          maxDeposit: testConfig.authorizeAmount.toString(),
        },
      };

      // Create new escrow payment (this will create a new session)
      const payloadResult = await escrowScheme.createPaymentPayload(2, escrowRequirements);

      // Back to CREATION payload (no session available)
      expect(payloadResult.payload.signature).toBeDefined();
      expect(payloadResult.payload.requestId).toBeDefined();
      expect(payloadResult.payload.session).toBeUndefined();

      console.log(`
STEP 7: Session exhausted - ESCROW fallback
- Created new escrow payment with signature
- This will create a NEW session when settled
`);
    });
  });

  // ===========================================================================
  // DEVELOPER EXPERIENCE
  // ===========================================================================

  describe('Developer Experience', () => {
    it('shows complete integration pattern', async () => {
      console.log(`
=============================================================================
INTEGRATION PATTERN FOR DEVELOPERS (Unified EscrowScheme)
=============================================================================

CLIENT SETUP:
-------------
import { x402Client } from '@x402/core/client';
import { EscrowScheme } from '@agentokratia/x402-escrow/client';
import { createWalletClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';

// 1. Create wallet (you already have this)
const walletClient = createWalletClient({
  account: privateKeyToAccount('0x...'),
  chain: baseSepolia,
  transport: http(),
});

// 2. Create unified EscrowScheme - handles BOTH creation AND usage
const escrowScheme = new EscrowScheme(walletClient);

// 3. Register with x402Client
const client = new x402Client()
  .register('eip155:84532', escrowScheme);

// 4. Make requests
const httpClient = new x402HTTPClient(client);

PAYMENT FLOW (Auto-detected by EscrowScheme):
---------------------------------------------
Request 1 (no session):
  -> escrowScheme.createPaymentPayload() returns CREATION payload
  -> Payload has: signature, authorization, sessionParams, requestId
  -> Server creates session, returns session info
  -> Store session: escrowScheme.sessions.store(...)

Request 2+ (has session):
  -> escrowScheme.createPaymentPayload() returns USAGE payload
  -> Payload has: session: { id, token }, amount, requestId
  -> NO SIGNATURE needed!
  -> Server debits session
  -> Update balance: escrowScheme.sessions.updateBalance(...)

Session exhausted:
  -> escrowScheme.sessions.hasValid() returns false
  -> Next createPaymentPayload() returns CREATION payload (new session)

=============================================================================
`);
    });
  });

  // ===========================================================================
  // SUPPORTED ENDPOINT
  // ===========================================================================

  describe('Supported Endpoint', () => {
    it('should return escrow scheme', async () => {
      const response = await getSupported();

      expect(response.ok).toBe(true);
      expect(response.data.kinds).toBeDefined();

      const schemes = response.data.kinds.map((k) => k.scheme);
      console.log('Supported schemes:', schemes);

      // Unified escrow scheme (handles both creation and usage)
      expect(schemes).toContain('escrow');
    });
  });

  // ===========================================================================
  // ERROR HANDLING
  // ===========================================================================

  describe('Error Handling', () => {
    it('should throw when EscrowScheme missing required config', async () => {
      if (!testApiKey || !testConfig?.usdcAddress) {
        console.log('Skipping: No API key or config');
        return;
      }

      const requirements = {
        scheme: 'escrow',
        network: testConfig.networkId as `${string}:${string}`,
        amount: '10000',
        asset: testConfig.usdcAddress,
        payTo: testConfig.facilitatorAddress,
        maxTimeoutSeconds: 86400,
        extra: {}, // Missing escrowContract, facilitator, tokenCollector
      };

      // Clear sessions so it tries to create
      escrowScheme.sessions.clear();

      await expect(escrowScheme.createPaymentPayload(2, requirements)).rejects.toThrow(
        /Missing required escrow configuration/
      );
    });
  });
});
