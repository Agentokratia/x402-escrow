# API Reference

## Endpoints

| Endpoint                                | Auth    | Purpose                |
| --------------------------------------- | ------- | ---------------------- |
| `GET /api/supported`                    | None    | List supported schemes |
| `POST /api/verify`                      | API Key | Verify payment         |
| `POST /api/settle`                      | API Key | Execute payment        |
| `GET /api/auth/nonce`                   | None    | Get SIWE nonce         |
| `POST /api/auth/verify`                 | None    | SIWE login → JWT       |
| `GET /api/payer/sessions`               | JWT     | List your sessions     |
| `POST /api/payer/sessions/[id]/reclaim` | JWT     | Reclaim funds          |
| `GET /api/keys`                         | JWT     | List API keys          |
| `POST /api/keys`                        | JWT     | Create API key         |

---

## POST /api/settle

**Headers:** `Authorization: Bearer <api_key>`

**Request:**

```json
{
  "paymentPayload": { "x402Version": 2, "accepted": {...}, "payload": {...} },
  "paymentRequirements": { "scheme": "escrow", "amount": "50000", "payTo": "0x..." }
}
```

**Response - Session Creation:**

```json
{
  "success": true,
  "session": { "id": "0x...", "token": "sess_...", "balance": "9950000" }
}
```

**Response - Session Usage:**

```json
{
  "success": true,
  "session": { "id": "0x...", "balance": "9900000" }
}
```

> `session.token` returned ONLY on creation. Store it securely.

---

## Error Codes

| Code                    | Meaning                   |
| ----------------------- | ------------------------- |
| `invalid_signature`     | ERC-3009 signature failed |
| `invalid_session_token` | Wrong session token       |
| `session_expired`       | Past authorization expiry |
| `insufficient_balance`  | Not enough balance        |

---

## Rate Limits

| Endpoint                     | Limit                |
| ---------------------------- | -------------------- |
| `/api/verify`, `/api/settle` | 1000/min per API key |
| Auth endpoints               | 10/min per IP        |
