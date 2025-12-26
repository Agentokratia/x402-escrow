# x402 Escrow Facilitator

Session-based x402 payments for high-frequency APIs. One signature creates a session, no more signing per request. Reclaim unused funds anytime.

**Live:** [facilitator.agentokratia.com](https://facilitator.agentokratia.com)

## Features

- **Session-based payments** - Sign once, make unlimited API calls
- **Zero per-request gas** - Facilitator handles on-chain transactions
- **100% reclaimable** - Withdraw unused funds anytime
- **ERC-3009 gasless** - Users sign off-chain, no wallet transaction needed
- **Base Mainnet + Sepolia** - Production and testnet support

## Quick Start

### Server Integration

```bash
npm install @x402/core @x402/express @agentokratia/x402-escrow
```

```typescript
import { x402ResourceServer, HTTPFacilitatorClient } from '@x402/core/server';
import { paymentMiddleware } from '@x402/express';
import { EscrowScheme } from '@agentokratia/x402-escrow/server';

const facilitator = new HTTPFacilitatorClient({
  url: 'https://facilitator.agentokratia.com',
  createAuthHeaders: async () => ({
    verify: { Authorization: `Bearer ${process.env.X402_API_KEY}` },
    settle: { Authorization: `Bearer ${process.env.X402_API_KEY}` },
    supported: {},
  }),
});

const server = new x402ResourceServer(facilitator).register('eip155:8453', new EscrowScheme());

app.use(
  paymentMiddleware(
    {
      'GET /api/premium': {
        accepts: { scheme: 'escrow', price: '$0.01', payTo: '0x...' },
      },
    },
    server
  )
);
```

### Client Integration

```typescript
import { createEscrowFetch } from '@agentokratia/x402-escrow/client';

const { fetch: escrowFetch, scheme } = createEscrowFetch(walletClient);

// Payments handled automatically
const response = await escrowFetch('https://api.example.com/premium');

// Access sessions
scheme.sessions.getAll();
```

## How It Works

```
1. User signs ERC-3009 authorization (gasless)
2. Facilitator deposits funds to escrow contract
3. Session created with balance
4. Each API call debits from session (no signature needed)
5. User can reclaim unused funds anytime
```

## API Endpoints

| Endpoint             | Description                       |
| -------------------- | --------------------------------- |
| `GET /api/supported` | Get supported networks and config |
| `POST /api/verify`   | Verify payment payload            |
| `POST /api/settle`   | Settle payment on-chain           |

## Networks

| Network      | Chain ID | Escrow Contract                              |
| ------------ | -------- | -------------------------------------------- |
| Base Mainnet | 8453     | `0xbDEa0d1BCc5966192b070fDF62ab4eF5B4420Cff` |
| Base Sepolia | 84532    | `0xbDEa0d1BCc5966192b070fDF62ab4eF5B4420Cff` |

## Environment Variables

```bash
# Required
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_KEY=
JWT_SECRET=                    # 32+ chars
NEXT_PUBLIC_WALLETCONNECT_ID=

# CDP Wallet (production)
CDP_API_KEY_ID=
CDP_API_KEY_SECRET=
CDP_WALLET_SECRET=

# Or Private Key (development)
WALLET_PROVIDER=private-key
FACILITATOR_PRIVATE_KEY=0x...
```

## Development

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Run tests
npm test

# Build for production
npm run build
```

## Documentation

- [API Reference](./docs/API.md)
- [Usage Guide](./docs/GUIDE.md)
- [Specification](./docs/SPEC.md)

## License

| Component                 | License                          |
| ------------------------- | -------------------------------- |
| Facilitator Server        | [AGPL-3.0](./LICENSE)            |
| @agentokratia/x402-escrow | [MIT](./packages/escrow/LICENSE) |
