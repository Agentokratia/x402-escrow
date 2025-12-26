# Integration Guide

## Client

```typescript
import { createEscrowFetch } from '@agentokratia/x402-escrow/client';

const escrowFetch = createEscrowFetch({ wallet, facilitatorUrl });

// Use like normal fetch - sessions handled automatically
const response = await escrowFetch('https://api.example.com/premium');
```

**What happens:**

1. First request → signs ERC-3009 → creates session → stores `session.token`
2. Next requests → uses stored token → instant (no signature)

---

## Server

```typescript
import { x402ResourceServer, HTTPFacilitatorClient } from '@x402/core/server';
import { EscrowScheme } from '@agentokratia/x402-escrow/server';

const facilitator = new HTTPFacilitatorClient({
  url: process.env.FACILITATOR_URL,
  createAuthHeaders: async () => ({
    verify: { Authorization: `Bearer ${process.env.X402_API_KEY}` },
    settle: { Authorization: `Bearer ${process.env.X402_API_KEY}` },
    supported: {},
  }),
});

const x402 = new x402ResourceServer(facilitator).register('eip155:8453', new EscrowScheme());

// Protect a route
app.get('/api/premium', requirePayment('10000', '0xYourAddress'), handler);
```

---

## x402 Headers

| Header              | Direction       | Content                              |
| ------------------- | --------------- | ------------------------------------ |
| `PAYMENT-REQUIRED`  | Server → Client | `{ x402Version, accepts[] }`         |
| `PAYMENT-SIGNATURE` | Client → Server | `{ x402Version, accepted, payload }` |
| `PAYMENT-RESPONSE`  | Server → Client | `{ success, transaction, session? }` |

All base64-encoded JSON.

---

## Environment

```bash
FACILITATOR_URL=https://facilitator.example.com
X402_API_KEY=ak_live_...
```
