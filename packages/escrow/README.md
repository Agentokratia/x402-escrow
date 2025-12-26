# @x402/escrow

Escrow payment scheme for the x402 protocol. Session-based payments for high-frequency APIs.

## Features

- **Session-based payments** - Sign once, make unlimited API calls
- **Zero per-request gas** - Facilitator handles on-chain transactions
- **100% reclaimable** - Withdraw unused funds anytime
- **ERC-3009 gasless** - Users sign off-chain, no wallet transaction needed

## Installation

```bash
npm install @x402/escrow
```

## Client Usage

For apps and agents paying for APIs.

### Simple (recommended)

```typescript
import { createEscrowFetch } from '@x402/escrow/client';

const { fetch: escrowFetch, scheme, x402 } = createEscrowFetch(walletClient);

// Payments handled automatically
const response = await escrowFetch('https://api.example.com/premium');

// Access sessions
scheme.sessions.getAll();
scheme.sessions.hasValid(receiverAddress, '10000');
```

### With hooks

```typescript
const { fetch: escrowFetch, x402 } = createEscrowFetch(walletClient);

// Add hooks for user control
x402.onBeforePaymentCreation(async (ctx) => {
  console.log('About to pay:', ctx.paymentRequirements);
});

x402.onAfterPaymentCreation(async (ctx) => {
  console.log('Payment created:', ctx.paymentPayload);
});
```

### Advanced (manual setup)

```typescript
import { x402Client } from '@x402/core/client';
import { wrapFetchWithPayment } from '@x402/fetch';
import { EscrowScheme, withSessionExtraction } from '@x402/escrow/client';

const escrowScheme = new EscrowScheme(walletClient);
const x402 = new x402Client().register('eip155:84532', escrowScheme);
const paidFetch = wrapFetchWithPayment(fetch, x402);
const escrowFetch = withSessionExtraction(paidFetch, escrowScheme);
```

## Server Usage

For APIs accepting payments. Config is auto-discovered from facilitator.

### Express

```typescript
import { x402ResourceServer, HTTPFacilitatorClient } from '@x402/core/server';
import { paymentMiddleware } from '@x402/express';
import { EscrowScheme } from '@x402/escrow/server';

const facilitator = new HTTPFacilitatorClient({
  url: 'https://facilitator.agentokratia.com',
  createAuthHeaders: async () => ({
    verify: { Authorization: `Bearer ${process.env.X402_API_KEY}` },
    settle: { Authorization: `Bearer ${process.env.X402_API_KEY}` },
    supported: {},
  }),
});

const server = new x402ResourceServer(facilitator).register('eip155:84532', new EscrowScheme());

app.use(
  paymentMiddleware(
    {
      'GET /api/premium': {
        accepts: {
          scheme: 'escrow',
          price: '$0.01',
          network: 'eip155:84532',
          payTo: ownerAddress,
        },
      },
    },
    server
  )
);
```

### Next.js

```typescript
import { paymentProxy } from '@x402/next';
import { EscrowScheme } from '@x402/escrow/server';

const server = new x402ResourceServer(facilitator).register('eip155:84532', new EscrowScheme());

export const proxy = paymentProxy(
  {
    '/api/premium': {
      accepts: { scheme: 'escrow', network: 'eip155:84532', payTo: ownerAddress, price: '$0.01' },
    },
  },
  server
);
```

## How It Works

```
1. User signs ERC-3009 authorization (gasless)
2. Facilitator deposits funds to escrow contract
3. Session created with balance
4. Each API call debits from session (no signature needed)
5. User can reclaim unused funds anytime
```

## Networks

| Network      | Chain ID | Escrow Contract                              |
| ------------ | -------- | -------------------------------------------- |
| Base Mainnet | 8453     | `0xbDEa0d1BCc5966192b070fDF62ab4eF5B4420Cff` |
| Base Sepolia | 84532    | `0xbDEa0d1BCc5966192b070fDF62ab4eF5B4420Cff` |

## API

### Client

| Export                                      | Description                                   |
| ------------------------------------------- | --------------------------------------------- |
| `createEscrowFetch(walletClient, options?)` | Creates fetch with automatic payment handling |
| `EscrowScheme`                              | Core scheme class for x402Client              |
| `withSessionExtraction(fetch, scheme)`      | Wrapper to extract sessions from responses    |
| `withAxiosSessionExtraction(scheme)`        | Axios interceptor for session extraction      |

### Server

| Export                  | Description                          |
| ----------------------- | ------------------------------------ |
| `EscrowScheme`          | Server scheme for x402ResourceServer |
| `HTTPFacilitatorClient` | Re-export from @x402/core            |

## License

MIT
