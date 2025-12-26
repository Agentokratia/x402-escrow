# x402 Escrow Facilitator

> Session-based payments for high-frequency APIs using x402 v2

## What It Does

- **Sign once, pay many** - Create a session with one signature, make unlimited API calls
- **Zero per-request gas** - Session usage is off-chain, instant
- **100% reclaimable** - Unused funds can be reclaimed anytime
- **x402 v2 compatible** - Works with the standard x402 protocol

## Supported Schemes

| Scheme   | Description                                  |
| -------- | -------------------------------------------- |
| `exact`  | Direct ERC-3009 payment (1 tx per request)   |
| `escrow` | Session-based (1 tx to create, 0 tx per use) |

## How It Works

```
1. Client requests protected resource
2. Server returns 402 + payment requirements
3. Client signs ERC-3009 → creates session (gets session.token)
4. Subsequent requests use session.token (instant, no gas)
5. User can reclaim unused funds anytime
```

## Documentation

| Doc                             | Description                        |
| ------------------------------- | ---------------------------------- |
| [API Reference](./API.md)       | All endpoints, payloads, responses |
| [Integration Guide](./GUIDE.md) | Client + server integration        |
| [Protocol Spec](./SPEC.md)      | Payload structures, security model |

## Quick Start

```bash
npm install @x402/core @agentokratia/x402-escrow
```

**Server** - Protect an endpoint:

```typescript
app.get('/api/premium', requirePayment('10000', '0xYourAddress'), handler);
```

**Client** - Pay for access:

```typescript
const response = await escrowFetch('https://api.example.com/premium');
```

See [Integration Guide](./GUIDE.md) for full examples.
