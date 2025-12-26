# Protocol Specification

## Schemes

| Scheme   | Description                                |
| -------- | ------------------------------------------ |
| `exact`  | Direct ERC-3009 payment (1 tx per request) |
| `escrow` | Session-based (1 tx create, 0 tx per use)  |

---

## Session Creation Payload

Client sends when creating a new session:

```typescript
{
  x402Version: 2,
  accepted: PaymentRequirements,
  payload: {
    signature: string,        // ERC-3009 signature
    authorization: {
      from: string,
      to: string,             // tokenCollector
      value: string,          // deposit amount
      validAfter: number,
      validBefore: number,
      nonce: string,          // derived from paymentInfoHash
    },
    sessionParams: {
      authorizationExpiry: number,
      refundExpiry: number,
      salt: string,           // random bytes32
    },
  },
}
```

---

## Session Usage Payload

Client sends for subsequent requests:

```typescript
{
  x402Version: 2,
  accepted: PaymentRequirements,
  payload: {
    session: {
      id: string,             // from creation response
      token: string,          // SECRET from creation response
    },
    requestId: string,        // idempotency key
    amount: string,
  },
}
```

---

## Session Token

- 256-bit random, returned ONCE at creation
- Stored as bcrypt hash by facilitator
- Required for all session usage
- Prevents unauthorized session access

---

## Capture Strategy

Facilitator must capture before `authorizationExpiry`:

| Trigger        | Action                     |
| -------------- | -------------------------- |
| Pending > $1   | Batch capture (cron)       |
| Expiry < 2h    | Batch capture (cron)       |
| Expiry < 30min | Sync capture (per request) |

After expiry, payer can call `reclaim()` directly on escrow contract.

---

## Payload Detection

Facilitator auto-detects operation:

- Has `signature` + `authorization` → Session Creation
- Has `session.id` + `session.token` → Session Usage
