/**
 * Escrow + Session Flow Tests (Unified EscrowScheme)
 *
 * These tests demonstrate the RECOMMENDED x402 v2 flow:
 * 1. First request → Escrow payment (creates session via wallet signature)
 * 2. Subsequent requests → Session payment (no signature, uses stored token)
 * 3. Session exhausted → Falls back to escrow
 *
 * The unified EscrowScheme handles both session creation and usage automatically.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createWalletClient, http, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';

// Test key (don't use in production!)
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

// Test addresses (checksummed)
const TEST_RECEIVER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address;
const USDC_ADDRESS = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as Address;
const ESCROW_CONTRACT = '0xbDEa0d1BCc5966192b070fDF62ab4eF5B4420Cff' as Address;
const FACILITATOR = '0xf040B60e95A5EB56c1eB33f25cBCe9AAeEE5D423' as Address;
const TOKEN_COLLECTOR = '0x0E3Df9510De65469C4518D7843919c0B8c7a7757' as Address;

describe('Escrow + Session Flow (Unified EscrowScheme)', () => {
  let walletClient: ReturnType<typeof createWalletClient>;

  beforeEach(() => {
    walletClient = createWalletClient({
      account: privateKeyToAccount(TEST_PRIVATE_KEY),
      chain: baseSepolia,
      transport: http(),
    });
  });

  it('complete flow: escrow creates session, then session reused', async () => {
    const { EscrowScheme } = await import('@/lib/x402-schemes/client');
    const { x402Client } = await import('@x402/core/client');

    // ==========================================================================
    // SETUP: Create unified EscrowScheme and register with x402Client
    // ==========================================================================
    const escrowScheme = new EscrowScheme(walletClient);

    const client = new x402Client().register('eip155:84532', escrowScheme);

    expect(client).toBeDefined();

    // ==========================================================================
    // STEP 1: First request - No session exists, use ESCROW
    // ==========================================================================
    const escrowRequirements = {
      scheme: 'escrow',
      network: 'eip155:84532' as const,
      amount: '10000', // 0.01 USDC
      asset: USDC_ADDRESS,
      payTo: TEST_RECEIVER,
      maxTimeoutSeconds: 86400,
      extra: {
        name: 'USDC',
        version: '2',
        escrowContract: ESCROW_CONTRACT,
        facilitator: FACILITATOR,
        tokenCollector: TOKEN_COLLECTOR,
        maxDeposit: '100000', // $0.10 - enough for 10 requests
      },
    };

    // No session yet
    expect(escrowScheme.sessions.hasValid(TEST_RECEIVER, '10000')).toBe(false);

    // Create escrow payment (signs ERC-3009 authorization)
    const escrowPayload = await escrowScheme.createPaymentPayload(2, escrowRequirements);

    expect(escrowPayload.x402Version).toBe(2);
    // CREATION payload has signature, authorization, sessionParams
    expect(escrowPayload.payload.signature).toBeDefined();
    expect(escrowPayload.payload.authorization).toBeDefined();
    expect(escrowPayload.payload.sessionParams).toBeDefined();
    expect(escrowPayload.payload.requestId).toBeDefined();
    // Should NOT have nested session object (that's for usage)
    expect(escrowPayload.payload.session).toBeUndefined();

    console.log(`
STEP 1: First request - ESCROW payment (CREATION)
- Signed ERC-3009 authorization for $0.10 (maxDeposit)
- Authorization valid for: ${(escrowPayload.payload.sessionParams as { authorizationExpiry: string }).authorizationExpiry}
- RequestId: ${escrowPayload.payload.requestId}
`);

    // ==========================================================================
    // STEP 2: Server settles escrow, returns session
    // ==========================================================================
    // Simulate settlement response from facilitator
    const settleResponse = {
      success: true,
      transaction: '0x1234...abcd',
      sessionId: 'sess_' + crypto.randomUUID().slice(0, 8),
      sessionToken: 'token_' + crypto.randomUUID(),
      balance: '90000', // $0.09 remaining (paid $0.01 for first request)
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    };

    // Store session from response in unified EscrowScheme
    escrowScheme.sessions.store({
      sessionId: settleResponse.sessionId,
      sessionToken: settleResponse.sessionToken,
      network: 'eip155:84532',
      payer: walletClient.account!.address,
      receiver: TEST_RECEIVER,
      balance: settleResponse.balance,
      authorizationExpiry: settleResponse.expiresAt,
    });

    expect(escrowScheme.sessions.getAll()).toHaveLength(1);

    console.log(`
STEP 2: Server settles, returns session
- Session ID: ${settleResponse.sessionId}
- Session balance: $${(Number(settleResponse.balance) / 1000000).toFixed(2)}
- Expires: ${new Date(settleResponse.expiresAt * 1000).toISOString()}
`);

    // ==========================================================================
    // STEP 3: Second request - Session exists, auto-detected by EscrowScheme!
    // ==========================================================================
    const secondRequirements = {
      scheme: 'escrow',
      network: 'eip155:84532' as const,
      amount: '10000', // 0.01 USDC
      asset: USDC_ADDRESS,
      payTo: TEST_RECEIVER,
      maxTimeoutSeconds: 3600,
      extra: {},
    };

    // Session now exists
    expect(escrowScheme.sessions.hasValid(TEST_RECEIVER, '10000')).toBe(true);

    // Create payment using EscrowScheme - it auto-detects session!
    const sessionPayload = await escrowScheme.createPaymentPayload(2, secondRequirements);

    expect(sessionPayload.x402Version).toBe(2);
    // USAGE payload has nested session object
    expect(sessionPayload.payload.session).toBeDefined();
    const session = sessionPayload.payload.session as { id: string; token: string };
    expect(session.id).toBe(settleResponse.sessionId);
    expect(session.token).toBe(settleResponse.sessionToken);
    expect(sessionPayload.payload.requestId).toBeDefined();
    expect(sessionPayload.payload.amount).toBe('10000');
    // NO signature needed!
    expect(sessionPayload.payload.signature).toBeUndefined();

    console.log(`
STEP 3: Second request - SESSION payment (no signature!)
- Session ID: ${session.id}
- Session Token: ${session.token.slice(0, 20)}...
- Amount: $${(Number(sessionPayload.payload.amount) / 1000000).toFixed(4)}
- RequestId: ${sessionPayload.payload.requestId}
`);

    // ==========================================================================
    // STEP 4: Update session balance after debit
    // ==========================================================================
    const newBalance = (BigInt(settleResponse.balance) - 10000n).toString();
    escrowScheme.sessions.updateBalance(settleResponse.sessionId, newBalance);

    const sessions = escrowScheme.sessions.getAll();
    expect(sessions[0].balance).toBe('80000'); // $0.08 remaining

    console.log(`
STEP 4: Session balance updated
- Previous: $${(Number(settleResponse.balance) / 1000000).toFixed(2)}
- After debit: $${(Number(newBalance) / 1000000).toFixed(2)}
`);

    // ==========================================================================
    // STEP 5: Multiple session payments until exhausted
    // ==========================================================================
    let currentBalance = BigInt(newBalance);

    for (let i = 3; i <= 9; i++) {
      if (escrowScheme.sessions.hasValid(TEST_RECEIVER, '10000')) {
        const payload = await escrowScheme.createPaymentPayload(2, secondRequirements);
        // Should still have session object (usage payload)
        expect(payload.payload.session).toBeDefined();

        // Simulate debit
        currentBalance -= 10000n;
        escrowScheme.sessions.updateBalance(settleResponse.sessionId, currentBalance.toString());
      }
    }

    // After 8 debits of $0.01, only $0.01 remains
    expect(currentBalance.toString()).toBe('10000');

    console.log(`
STEP 5: After 8 session payments
- Remaining balance: $${(Number(currentBalance) / 1000000).toFixed(2)}
- One more payment possible
`);

    // ==========================================================================
    // STEP 6: Session exhausted, fall back to ESCROW
    // ==========================================================================
    // Last session payment
    await escrowScheme.createPaymentPayload(2, secondRequirements);
    currentBalance -= 10000n;
    escrowScheme.sessions.updateBalance(settleResponse.sessionId, currentBalance.toString());

    // Now balance is 0
    expect(currentBalance.toString()).toBe('0');

    // Session no longer valid for this amount
    expect(escrowScheme.sessions.hasValid(TEST_RECEIVER, '10000')).toBe(false);

    // Must use escrow for next payment (will create new session)
    const newEscrowPayload = await escrowScheme.createPaymentPayload(2, escrowRequirements);
    // Back to CREATION payload (has signature)
    expect(newEscrowPayload.payload.signature).toBeDefined();
    // Should NOT have session object
    expect(newEscrowPayload.payload.session).toBeUndefined();

    console.log(`
STEP 6: Session exhausted, back to ESCROW
- Session balance: $0.00
- Created new escrow payment with signature
- This will create a NEW session
`);
  });

  it('priority: session over escrow when both available', async () => {
    const { EscrowScheme } = await import('@/lib/x402-schemes/client');

    const escrowScheme = new EscrowScheme(walletClient);

    // Store a valid session
    escrowScheme.sessions.store({
      sessionId: 'sess_existing',
      sessionToken: 'existing_token',
      network: 'eip155:84532',
      payer: walletClient.account!.address,
      receiver: TEST_RECEIVER,
      balance: '50000',
      authorizationExpiry: Math.floor(Date.now() / 1000) + 3600,
    });

    const requirements = {
      scheme: 'escrow',
      network: 'eip155:84532' as const,
      amount: '10000',
      asset: USDC_ADDRESS,
      payTo: TEST_RECEIVER,
      maxTimeoutSeconds: 3600,
      extra: {},
    };

    // Session exists - EscrowScheme auto-uses it
    expect(escrowScheme.sessions.hasValid(TEST_RECEIVER, '10000')).toBe(true);

    const payload = await escrowScheme.createPaymentPayload(2, requirements);

    // Should be USAGE payload (has session object)
    expect(payload.payload.session).toBeDefined();
    const session = payload.payload.session as { id: string; token: string };
    expect(session.token).toBe('existing_token');
    expect(payload.payload.signature).toBeUndefined();
    console.log('✅ Used SESSION (no signature needed)');
  });
});

describe('Client Integration Pattern', () => {
  it('shows complete recommended client setup', async () => {
    const { EscrowScheme } = await import('@/lib/x402-schemes/client');
    const { x402Client, x402HTTPClient } = await import('@x402/core/client');

    const walletClient = createWalletClient({
      account: privateKeyToAccount(TEST_PRIVATE_KEY),
      chain: baseSepolia,
      transport: http(),
    });

    // ==========================================================================
    // RECOMMENDED CLIENT SETUP (x402 v2 with Unified EscrowScheme)
    // ==========================================================================

    // 1. Create unified EscrowScheme (handles both creation and usage)
    const escrowScheme = new EscrowScheme(walletClient);

    // 2. Register with x402Client
    const client = new x402Client().register('eip155:84532', escrowScheme);

    // 3. Create HTTP client for payment handling
    const httpClient = new x402HTTPClient(client);

    expect(httpClient).toBeDefined();

    console.log(`
=============================================================================
RECOMMENDED CLIENT INTEGRATION (x402 v2 with Unified EscrowScheme)
=============================================================================

import { x402Client, x402HTTPClient } from '@x402/core/client';
import { EscrowScheme } from './lib/x402-schemes/client';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';

// 1. Create wallet (you already have this)
const walletClient = createWalletClient({
  account: privateKeyToAccount('0x...'),
  chain: baseSepolia,
  transport: http(),
});

// 2. Create unified EscrowScheme (handles BOTH creation AND usage)
const escrowScheme = new EscrowScheme(walletClient);

// 3. Register with x402Client
const client = new x402Client()
  .register('eip155:84532', escrowScheme);

// 4. Create HTTP client
const httpClient = new x402HTTPClient(client);

// 5. Make a request to a 402-protected endpoint
const response = await fetch('https://api.example.com/premium-data');

if (response.status === 402) {
  // Parse payment requirements from response header
  const paymentRequired = httpClient.getPaymentRequired(
    (name) => response.headers.get(name)
  );

  // Create payment (uses session if available, otherwise creates new session)
  const payment = await httpClient.createPaymentPayload(paymentRequired);

  // Retry with payment
  const paidResponse = await fetch('https://api.example.com/premium-data', {
    headers: {
      'PAYMENT-SIGNATURE': httpClient.serializePaymentPayload(payment),
    },
  });

  // Store session from settlement for future use
  const settlement = httpClient.getPaymentSettleResponse(
    (name) => paidResponse.headers.get(name)
  );
  if (settlement?.session) {
    escrowScheme.sessions.store({
      sessionId: settlement.session.id,
      sessionToken: settlement.session.token,
      network: 'eip155:84532',
      payer: walletClient.account.address,
      receiver: paymentRequired.payTo,
      balance: settlement.session.balance,
      authorizationExpiry: settlement.session.expiresAt,
    });
  }
}

// Future requests with session - no signature needed!

=============================================================================
PAYMENT FLOW (Auto-detected by EscrowScheme)
=============================================================================

Request 1 (no session):
  Client                    Server                  Facilitator
    |                         |                         |
    |-- GET /api/premium ---->|                         |
    |<-- 402 + PAYMENT-REQ ---|                         |
    |                         |                         |
    |   [EscrowScheme: no session, create CREATION payload]
    |   [Sign ERC-3009 authorization]                   |
    |                         |                         |
    |-- GET + PAYMENT-SIG --->|                         |
    |                         |-- verify -------------->|
    |                         |<-- valid + payer -------|
    |                         |                         |
    |                         |   [Process request]     |
    |                         |                         |
    |                         |-- settle -------------->|
    |                         |<-- session + balance ---|
    |                         |                         |
    |<-- 200 + PAYMENT-RES ---|                         |
    |                         |                         |
    |   [escrowScheme.sessions.store()]                   |

Request 2+ (has session):
  Client                    Server                  Facilitator
    |                         |                         |
    |-- GET /api/premium ---->|                         |
    |<-- 402 + PAYMENT-REQ ---|                         |
    |                         |                         |
    |   [EscrowScheme: has session, create USAGE payload]
    |   [No signature needed!]                          |
    |                         |                         |
    |-- GET + PAYMENT-SIG --->|                         |
    |                         |-- verify -------------->|
    |                         |<-- valid + payer -------|
    |                         |                         |
    |                         |   [Debit session]       |
    |                         |                         |
    |<-- 200 + PAYMENT-RES ---|                         |
    |                         |                         |
    |   [escrowScheme.sessions.updateBalance()]                  |

=============================================================================
HEADERS (x402 v2)
=============================================================================

- PAYMENT-REQUIRED: Server -> Client (402 response with payment options)
- PAYMENT-SIGNATURE: Client -> Server (escrow payment proof)
- PAYMENT-RESPONSE: Server -> Client (settlement confirmation + new balance)

=============================================================================
`);
  });
});

describe('Server Integration Pattern', () => {
  it('shows server-side middleware setup', async () => {
    const { EscrowServerScheme } = await import('@/lib/x402-schemes/server');

    // Only EscrowServerScheme needed (unified - handles both creation and usage)
    const escrowScheme = new EscrowServerScheme({
      escrowContract: ESCROW_CONTRACT,
      facilitator: FACILITATOR,
      tokenCollector: TOKEN_COLLECTOR,
      usdcAddress: USDC_ADDRESS,
    });

    expect(escrowScheme.scheme).toBe('escrow');

    console.log(`
=============================================================================
SERVER INTEGRATION (Unified EscrowServerScheme)
=============================================================================

import { HTTPFacilitatorClient } from "@x402/core/server";
import { createEscrowServer, escrowPaymentMiddleware } from "@x402/escrow/server";

const facilitator = new HTTPFacilitatorClient({
  url: "https://facilitator.agentokratia.com",
  createAuthHeaders: async () => ({
    verify: { Authorization: \`Bearer \${process.env.X402_API_KEY}\` },
    settle: { Authorization: \`Bearer \${process.env.X402_API_KEY}\` },
    supported: {},
  }),
});

const server = await createEscrowServer(facilitator);

// Single scheme handles both session creation and usage!
app.use(escrowPaymentMiddleware({
  "GET /api/premium": {
    accepts: [
      { scheme: "escrow", network: "eip155:8453", price: "$0.01", payTo: "0x..." },
    ],
  },
}, server));

=============================================================================
`);
  });
});
