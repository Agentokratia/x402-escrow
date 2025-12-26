# x402 Escrow Integration Tests

Integration tests for the x402 Escrow smart contract on Base Sepolia.

## Prerequisites

1. **Test Payer Wallet** - A wallet with Base Sepolia USDC
   - Get testnet USDC: https://faucet.circle.com/
   - Need at least $1.00 USDC for tests

2. **Facilitator Wallet** - The operator wallet with Base Sepolia ETH for gas
   - Need small amount of ETH for transaction fees

3. **API Key** - Create one in the dashboard after connecting your wallet

## Setup

1. Copy the environment template:

   ```bash
   cp .env.test.example .env.test
   ```

2. Fill in your credentials in `.env.test`:

   ```bash
   # Required - Supabase
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_KEY=your-service-role-key

   # Required - Facilitator wallet (operator)
   FACILITATOR_PRIVATE_KEY=0x...

   # Required - Test payer wallet (must have USDC)
   TEST_PAYER_PRIVATE_KEY=0x...

   # Optional - API key (if not provided, API tests are skipped)
   TEST_API_KEY=x402_...

   # Optional - For capture cron tests
   CRON_SECRET=your-cron-secret
   ```

3. Install dependencies:
   ```bash
   npm install
   ```

## Running Tests

### Run all integration tests

```bash
npm run test:integration
```

### Run with watch mode

```bash
npm run test:watch
```

### Run with coverage

```bash
npm run test:coverage
```

## Test Structure

```
tests/
├── setup.ts                    # Basic test setup
├── setup.integration.ts        # Integration test setup (clients, accounts)
├── utils/
│   └── escrow.ts              # Test utilities (signing, API helpers)
└── integration/
    ├── escrow-flow.test.ts    # Full escrow lifecycle tests
    └── contract.test.ts       # Direct smart contract tests
```

## Test Categories

### Escrow Flow Tests (`escrow-flow.test.ts`)

- **Authorization Flow**: Create escrow sessions with ERC-3009 signatures
- **Session Usage**: Debit from sessions, idempotency, balance validation
- **Void Flow**: Capture pending + release authorization
- **Capture Tiers**: Threshold, expiry, and synchronous capture
- **Balance Invariants**: Verify `authorized = captured + pending + available`
- **Error Handling**: Invalid inputs, missing auth, etc.

### Contract Tests (`contract.test.ts`)

- **Read Functions**: Hash computation, payment status
- **State Verification**: Contract deployment, bytecode
- **Gas Estimation**: Estimate transaction costs
- **Network Config**: Chain ID, block number, gas price
- **Account Validation**: Signature verification
- **USDC Token**: Decimals, allowances, balances

## Test Configuration

Key configuration in `vitest.integration.config.ts`:

- **Timeout**: 120 seconds per test (for blockchain transactions)
- **Pool**: Single fork (sequential execution to avoid nonce conflicts)
- **Alias**: `@/` maps to `./src/`

## Common Issues

### "Payer USDC balance low"

Get testnet USDC from the Circle faucet: https://faucet.circle.com/

### "Facilitator ETH balance low"

Get Base Sepolia ETH from a faucet (search "Base Sepolia faucet")

### "No API key"

Create an API key in the dashboard:

1. Connect wallet at http://localhost:3000
2. Go to Dashboard → API Keys
3. Create a new key
4. Add to `.env.test` as `TEST_API_KEY`

### Nonce errors

Tests run sequentially. If you see nonce errors, wait for pending transactions to confirm or use a different test wallet.

## Contract Addresses (Base Sepolia)

| Contract           | Address                                      |
| ------------------ | -------------------------------------------- |
| AuthCaptureEscrow  | `0xbdea0d1bcc5966192b070fdf62ab4ef5b4420cff` |
| ERC-3009 Collector | `0x0e3df9510de65469c4518d7843919c0b8c7a7757` |
| USDC               | `0x036cbd53842c5426634e7929541ec2318f3dcf7e` |
| Multicall3         | `0xca11bde05977b3631167028862be2a173976ca11` |
