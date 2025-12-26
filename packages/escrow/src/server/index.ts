/**
 * x402 Escrow Server
 *
 * Server-side escrow scheme for x402. Compatible with @x402/express and @x402/next.
 * Config is auto-discovered from facilitator - no manual config needed!
 *
 * @example
 * ```typescript
 * import { x402ResourceServer, HTTPFacilitatorClient } from '@x402/core/server';
 * import { paymentMiddleware } from '@x402/express';
 * import { EscrowScheme } from '@agentokratia/x402-escrow/server';
 *
 * const facilitator = new HTTPFacilitatorClient({
 *   url: 'https://facilitator.agentokratia.com',
 *   createAuthHeaders: async () => ({
 *     verify: { Authorization: `Bearer ${process.env.X402_API_KEY}` },
 *     settle: { Authorization: `Bearer ${process.env.X402_API_KEY}` },
 *     supported: {},
 *   }),
 * });
 *
 * const server = new x402ResourceServer(facilitator)
 *   .register('eip155:84532', new EscrowScheme())
 *   .onAfterSettle(ctx => console.log('Settled:', ctx));
 *
 * app.use(paymentMiddleware({
 *   'GET /api/premium': {
 *     accepts: {
 *       scheme: 'escrow',
 *       price: '$0.01',
 *       network: 'eip155:84532',
 *       payTo: ownerAddress,
 *     },
 *   },
 * }, server));
 * ```
 */

// Escrow scheme (use with x402ResourceServer.register)
export { EscrowScheme, type EscrowSchemeConfig } from './escrow';

// Backward compatibility aliases
export { EscrowServerScheme, type EscrowServerSchemeConfig } from './escrow';

// Re-export x402 core types for convenience
export { HTTPFacilitatorClient, type FacilitatorClient } from '@x402/core/server';
