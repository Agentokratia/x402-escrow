/**
 * x402 Server Integration Tests
 *
 * Tests for resource provider integration with x402 v2 protocol.
 * Config is auto-discovered from facilitator - no manual config needed!
 *
 * The unified escrow scheme handles both:
 * - Session CREATION: Client sends signature + authorization (wallet signed)
 * - Session USAGE: Client sends session.id + session.token (no signature)
 */

import { describe, it, expect, beforeAll } from 'vitest';

import { EscrowScheme } from '@x402/escrow/server';

// Test configuration (simulates what facilitator would return)
const CHAIN_ID = 84532; // Base Sepolia
const NETWORK_ID = `eip155:${CHAIN_ID}` as const;

const facilitatorConfig = {
  escrowContract: '0x8F3490Eb78bDE0b5e40504ad4e09F1A17A1fac1E' as `0x${string}`,
  facilitator: '0xf040b60e95a5eb56c1eb33f25cbce9aaeee5d423' as `0x${string}`,
  tokenCollector: '0x8F3490Eb78bDE0b5e40504ad4e09F1A17A1fac1E' as `0x${string}`,
  asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as `0x${string}`,
  minDeposit: '5000000',
  maxDeposit: '100000000',
  name: 'USDC',
  version: '2',
};

const testReceiver = '0x1234567890123456789012345678901234567890' as `0x${string}`;

/**
 * =============================================================================
 * SERVER SCHEME TESTS
 * =============================================================================
 *
 * EscrowScheme is now config-less - all config comes from facilitator.
 */
describe('EscrowScheme', () => {
  let scheme: EscrowScheme;

  beforeAll(() => {
    // No config needed! Config comes from facilitator's supportedKind.extra
    scheme = new EscrowScheme();
  });

  it('has correct scheme name', () => {
    expect(scheme.scheme).toBe('escrow');
  });

  describe('parsePrice', () => {
    it('parses numeric price as USD', async () => {
      const result = await scheme.parsePrice(0.1, NETWORK_ID);

      expect(result.amount).toBe('100000'); // $0.10 = 100000 micro USDC
      // Asset is empty - will be populated from facilitator's extra.asset
      expect(result.asset).toBe('');
    });

    it('parses string price with $ prefix', async () => {
      const result = await scheme.parsePrice('$1.50', NETWORK_ID);

      expect(result.amount).toBe('1500000'); // $1.50 = 1500000 micro USDC
    });

    it('parses string price without prefix', async () => {
      const result = await scheme.parsePrice('0.25', NETWORK_ID);

      expect(result.amount).toBe('250000'); // $0.25 = 250000 micro USDC
    });

    it('passes through AssetAmount objects', async () => {
      const input = { amount: '1000000', asset: facilitatorConfig.asset };
      const result = await scheme.parsePrice(input, NETWORK_ID);

      expect(result.amount).toBe('1000000');
      expect(result.asset).toBe(facilitatorConfig.asset);
    });

    it('handles zero price', async () => {
      const result = await scheme.parsePrice(0, NETWORK_ID);
      expect(result.amount).toBe('0');
    });

    it('throws on invalid price', async () => {
      await expect(scheme.parsePrice('invalid', NETWORK_ID)).rejects.toThrow('Invalid price');
    });
  });

  describe('enhancePaymentRequirements', () => {
    it('copies facilitator config to extra', async () => {
      const baseRequirements = {
        scheme: 'escrow',
        network: NETWORK_ID,
        asset: facilitatorConfig.asset,
        amount: '100000',
        payTo: testReceiver,
        maxTimeoutSeconds: 86400,
        extra: {},
      };

      // supportedKind.extra contains ALL config from facilitator
      const supportedKind = {
        x402Version: 2,
        scheme: 'escrow',
        network: NETWORK_ID,
        extra: facilitatorConfig,
      };

      const result = await scheme.enhancePaymentRequirements(baseRequirements, supportedKind, []);

      // All facilitator config is now in extra
      expect(result.extra).toMatchObject({
        escrowContract: facilitatorConfig.escrowContract,
        facilitator: facilitatorConfig.facilitator,
        tokenCollector: facilitatorConfig.tokenCollector,
        minDeposit: '5000000',
        maxDeposit: '100000000',
        name: 'USDC',
        version: '2',
        asset: facilitatorConfig.asset,
      });
    });

    it('preserves existing extra fields from route config', async () => {
      const baseRequirements = {
        scheme: 'escrow',
        network: NETWORK_ID,
        asset: facilitatorConfig.asset,
        amount: '100000',
        payTo: testReceiver,
        maxTimeoutSeconds: 86400,
        extra: { customField: 'preserved' },
      };

      const supportedKind = {
        x402Version: 2,
        scheme: 'escrow',
        network: NETWORK_ID,
        extra: facilitatorConfig,
      };

      const result = await scheme.enhancePaymentRequirements(baseRequirements, supportedKind, []);

      // Custom field from route config is preserved
      expect(result.extra.customField).toBe('preserved');
      // Facilitator config is added
      expect(result.extra.escrowContract).toBe(facilitatorConfig.escrowContract);
    });
  });
});

/**
 * =============================================================================
 * RESOURCE SERVER INTEGRATION
 * =============================================================================
 *
 * Shows how schemes integrate with x402ResourceServer and HTTPFacilitatorClient.
 */
describe('Resource Server Integration (Simulated)', () => {
  it('demonstrates server-side payment flow', async () => {
    console.log(`
=============================================================================
SERVER-SIDE PAYMENT FLOW (Resource Provider)
=============================================================================

1. Server configures protected routes:

   const routes = {
     'GET /api/premium-data': {
       accepts: [
         { scheme: 'escrow', network: 'eip155:84532', payTo: '0x...', price: 0.01 },
       ],
       description: 'Premium data endpoint',
       mimeType: 'application/json',
     },
   };

2. Client requests protected resource without payment:

   GET /api/premium-data

3. Server returns 402 with payment requirements:

   HTTP/1.1 402 Payment Required
   X-Payment-Required: <base64-encoded PaymentRequired>

4. Client creates and sends payment:

   GET /api/premium-data
   X-Payment-Signature: <base64-encoded PaymentPayload>

5. Server verifies with facilitator:

   POST https://facilitator/api/verify
   { paymentPayload, paymentRequirements }

   Response: { isValid: true, payer: '0x...' }

6. Server processes request and settles:

   POST https://facilitator/api/settle
   { paymentPayload, paymentRequirements }

   Response: { success: true, transaction: '0x...', session: { id, token, balance } }

7. Server returns response with settlement header:

   HTTP/1.1 200 OK
   PAYMENT-RESPONSE: <base64-encoded SettleResponse with session>
   Content-Type: application/json

   { "data": "premium content" }

=============================================================================
`);

    expect(true).toBe(true);
  });

  it('demonstrates x402ResourceServer registration', async () => {
    // Config-less scheme - all config comes from facilitator
    const escrowScheme = new EscrowScheme();

    // Simulate what x402ResourceServer.register() does
    const registeredSchemes = new Map<string, EscrowScheme>();
    registeredSchemes.set(`${NETWORK_ID}:escrow`, escrowScheme);

    // Verify scheme is registered correctly
    expect(registeredSchemes.get(`${NETWORK_ID}:escrow`)?.scheme).toBe('escrow');

    console.log('\nRegistered server schemes:');
    console.log('- escrow on', NETWORK_ID, '(handles both session creation and usage)');
  });

  it('builds payment requirements from route config + facilitator', async () => {
    const escrowScheme = new EscrowScheme();

    // Simulate route configuration (user's code)
    const routeConfig = {
      scheme: 'escrow',
      network: NETWORK_ID,
      payTo: testReceiver,
      price: 0.1, // $0.10
      maxTimeoutSeconds: 86400,
    };

    // Step 1: Parse price
    const { amount } = await escrowScheme.parsePrice(routeConfig.price, NETWORK_ID);

    // Step 2: Build base requirements
    const baseRequirements = {
      scheme: routeConfig.scheme,
      network: routeConfig.network,
      asset: '', // Will come from facilitator
      amount,
      payTo: routeConfig.payTo,
      maxTimeoutSeconds: routeConfig.maxTimeoutSeconds,
      extra: {},
    };

    // Step 3: Enhance with facilitator's config (auto-discovered)
    const supportedKind = {
      x402Version: 2,
      scheme: 'escrow',
      network: NETWORK_ID,
      extra: facilitatorConfig, // All config from facilitator
    };

    const requirements = await escrowScheme.enhancePaymentRequirements(
      baseRequirements,
      supportedKind,
      []
    );

    // Verify final requirements
    expect(requirements.scheme).toBe('escrow');
    expect(requirements.network).toBe(NETWORK_ID);
    expect(requirements.amount).toBe('100000');
    expect(requirements.payTo).toBe(testReceiver);
    // All escrow config comes from facilitator's extra
    expect(requirements.extra.escrowContract).toBe(facilitatorConfig.escrowContract);
    expect(requirements.extra.facilitator).toBe(facilitatorConfig.facilitator);
    expect(requirements.extra.asset).toBe(facilitatorConfig.asset);

    console.log('\nBuilt payment requirements:');
    console.log(JSON.stringify(requirements, null, 2));
  });
});

/**
 * =============================================================================
 * FACILITATOR COMMUNICATION
 * =============================================================================
 */
describe('Facilitator Communication (Simulated)', () => {
  it('demonstrates verify request/response flow', async () => {
    // Simulate a verify request that a resource server would send
    const verifyRequest = {
      paymentPayload: {
        x402Version: 2,
        resource: {
          url: 'https://api.example.com/premium',
          description: 'Premium endpoint',
          mimeType: 'application/json',
        },
        accepted: {
          scheme: 'escrow',
          network: NETWORK_ID,
          asset: facilitatorConfig.asset,
          amount: '100000',
          payTo: testReceiver,
          maxTimeoutSeconds: 86400,
          extra: {
            escrowContract: facilitatorConfig.escrowContract,
            facilitator: facilitatorConfig.facilitator,
          },
        },
        payload: {
          signature: '0x...',
          authorization: {
            from: '0xPayerAddress',
            to: facilitatorConfig.tokenCollector,
            value: '100000',
            validAfter: '0',
            validBefore: String(Math.floor(Date.now() / 1000) + 3600),
            nonce: '0x...',
          },
          sessionParams: {
            salt: '0x...',
            authorizationExpiry: Math.floor(Date.now() / 1000) + 86400,
            refundExpiry: Math.floor(Date.now() / 1000) + 604800,
          },
        },
      },
      paymentRequirements: {
        scheme: 'escrow',
        network: NETWORK_ID,
        asset: facilitatorConfig.asset,
        amount: '100000',
        payTo: testReceiver,
        maxTimeoutSeconds: 86400,
        extra: {},
      },
    };

    // This would be sent to: POST https://facilitator/api/verify
    console.log('\nVerify request structure:');
    console.log('- paymentPayload.accepted.scheme:', verifyRequest.paymentPayload.accepted.scheme);
    console.log(
      '- paymentPayload.payload keys:',
      Object.keys(verifyRequest.paymentPayload.payload)
    );

    // Expected verify response:
    const verifyResponse = {
      isValid: true,
      payer: '0xPayerAddress',
    };

    expect(verifyResponse.isValid).toBe(true);
  });

  it('demonstrates settle request/response flow', async () => {
    // Expected settle response for escrow scheme
    // Session data is in settleResponse.session (goes into PAYMENT-RESPONSE header)
    const settleResponse = {
      success: true,
      payer: '0xPayerAddress',
      transaction: '0xTransactionHash',
      network: NETWORK_ID,
      // Session created from deposit
      session: {
        id: 'sess_abc123',
        token: 'secret_token_xyz', // SECRET - client stores this
        balance: '99000', // Remaining after first charge
        expiresAt: Math.floor(Date.now() / 1000) + 86400,
      },
    };

    console.log('\nSettle response structure (escrow):');
    console.log('- success:', settleResponse.success);
    console.log('- session.id:', settleResponse.session.id);
    console.log('- session.balance:', settleResponse.session.balance);

    // x402 middleware encodes this into PAYMENT-RESPONSE header:
    // PAYMENT-RESPONSE: base64({ ...settleResponse, requirements })
    // Client extracts session from PAYMENT-RESPONSE
    expect(settleResponse.success).toBe(true);
    expect(settleResponse.session.id).toBeDefined();
    expect(settleResponse.session.token).toBeDefined();
  });
});

/**
 * =============================================================================
 * USAGE DOCUMENTATION
 * =============================================================================
 */
describe('Usage Documentation', () => {
  it('shows simplified server setup', () => {
    console.log(`
=============================================================================
SIMPLIFIED SERVER SETUP (Config Auto-Discovery)
=============================================================================

import { x402ResourceServer, HTTPFacilitatorClient } from '@x402/core/server';
import { paymentMiddleware } from '@x402/express';
import { EscrowScheme } from '@x402/escrow/server';

const facilitator = new HTTPFacilitatorClient({
  url: 'https://facilitator.agentokratia.com',
  createAuthHeaders: async () => ({
    verify: { Authorization: \`Bearer \${process.env.X402_API_KEY}\` },
    settle: { Authorization: \`Bearer \${process.env.X402_API_KEY}\` },
    supported: {},
  }),
});

// That's it! No config needed - facilitator provides everything
const server = new x402ResourceServer(facilitator)
  .register('eip155:84532', new EscrowScheme())
  .onAfterSettle(ctx => console.log('Settled:', ctx.settleResponse));

app.use(paymentMiddleware({
  'GET /api/premium': {
    accepts: {
      scheme: 'escrow',
      price: '$0.01',
      network: 'eip155:84532',
      payTo: ownerAddress,
    },
  },
}, server));

=============================================================================
`);

    expect(true).toBe(true);
  });
});

console.log(`\nTests completed in ${Date.now()}ms`);
