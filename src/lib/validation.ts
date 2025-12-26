/**
 * Zod Validation Schemas for x402 API
 *
 * Provides type-safe validation for all API payloads.
 * Use safeParseVerifyRequest() and safeParseSettleRequest() for request validation.
 */

import { z } from 'zod';
import type { PaymentRequirements } from './types';

// =============================================================================
// Base Schemas
// =============================================================================

/** Ethereum address (0x-prefixed hex, 42 chars) */
const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address');

/** Hex string (0x-prefixed) */
const hexSchema = z.string().regex(/^0x[a-fA-F0-9]*$/, 'Invalid hex string');

/** Numeric string (for BigInt-safe amounts) */
const amountSchema = z.string().regex(/^\d+$/, 'Amount must be numeric string');

/** Network ID (CAIP-2 format: eip155:chainId) */
const networkSchema = z
  .string()
  .regex(/^eip155:\d+$/, 'Invalid network format (expected eip155:chainId)');

// =============================================================================
// ERC-3009 Authorization Schema
// =============================================================================

const authorizationSchema = z.object({
  from: addressSchema,
  to: addressSchema,
  value: z.union([amountSchema, z.number().transform(String)]),
  validAfter: z.union([amountSchema, z.number().transform(String)]),
  validBefore: z.union([amountSchema, z.number().transform(String)]),
  nonce: hexSchema,
});

// =============================================================================
// Session Parameters Schema
// =============================================================================

const sessionParamsSchema = z.object({
  salt: hexSchema,
  authorizationExpiry: z.number().int().positive(),
  refundExpiry: z.number().int().positive(),
});

// =============================================================================
// Unified Escrow Payload Schemas
// Discriminated by 'signature' (creation) vs 'session' (usage)
// =============================================================================

/**
 * Session CREATION payload schema
 * Client creates a new session with wallet signature
 */
export const escrowCreationPayloadSchema = z.object({
  signature: hexSchema,
  authorization: authorizationSchema,
  sessionParams: sessionParamsSchema,
  requestId: z.string().min(1),
});

/**
 * Session USAGE payload schema
 * Client uses existing session - nested session object
 */
export const escrowUsagePayloadSchema = z.object({
  session: z.object({
    id: z.string().min(1),
    token: z.string().min(1),
  }),
  amount: z.union([amountSchema, z.number().transform(String)]),
  requestId: z.string().min(1),
});

/**
 * Unified escrow payload - union of creation and usage
 * Zod automatically handles discrimination
 */
export const escrowUnifiedPayloadSchema = z.union([
  escrowCreationPayloadSchema,
  escrowUsagePayloadSchema,
]);

// Inferred types
export type EscrowCreationPayloadZod = z.infer<typeof escrowCreationPayloadSchema>;
export type EscrowUsagePayloadZod = z.infer<typeof escrowUsagePayloadSchema>;
export type EscrowUnifiedPayloadZod = z.infer<typeof escrowUnifiedPayloadSchema>;

/**
 * Validate escrow payload and determine type
 */
export function parseEscrowPayload(
  payload: unknown
):
  | { type: 'creation'; data: EscrowCreationPayloadZod }
  | { type: 'usage'; data: EscrowUsagePayloadZod }
  | { type: 'invalid'; error: z.ZodError } {
  // Try creation first (more fields = more specific)
  const creationResult = escrowCreationPayloadSchema.safeParse(payload);
  if (creationResult.success) {
    return { type: 'creation', data: creationResult.data };
  }

  // Try usage
  const usageResult = escrowUsagePayloadSchema.safeParse(payload);
  if (usageResult.success) {
    return { type: 'usage', data: usageResult.data };
  }

  // Neither matched - return the union error
  const unionResult = escrowUnifiedPayloadSchema.safeParse(payload);
  return { type: 'invalid', error: unionResult.error! };
}

// =============================================================================
// Payment Requirements Schema
// =============================================================================

const paymentRequirementsSchema = z.object({
  scheme: z.string(),
  network: networkSchema,
  amount: z.union([amountSchema, z.number().transform(String)]),
  asset: addressSchema,
  payTo: addressSchema,
  maxTimeoutSeconds: z.number().int().positive().default(86400),
  extra: z.record(z.string(), z.unknown()).default({}),
});

// =============================================================================
// Request Schemas
// =============================================================================

const verifyRequestSchema = z.object({
  paymentPayload: z.object({
    x402Version: z.number(),
    accepted: z
      .object({
        scheme: z.string(),
        network: networkSchema,
      })
      .passthrough(),
    payload: z.record(z.string(), z.unknown()),
  }),
  paymentRequirements: paymentRequirementsSchema,
});

const settleRequestSchema = z.object({
  paymentPayload: z.object({
    x402Version: z.number(),
    accepted: z
      .object({
        scheme: z.string(),
        network: networkSchema,
      })
      .passthrough(),
    payload: z.record(z.string(), z.unknown()),
    extensions: z.record(z.string(), z.unknown()).optional(),
  }),
  paymentRequirements: paymentRequirementsSchema,
});

// =============================================================================
// Types
// =============================================================================

type VerifyRequestRaw = z.infer<typeof verifyRequestSchema>;
type SettleRequestRaw = z.infer<typeof settleRequestSchema>;

export interface VerifyRequest {
  paymentPayload: VerifyRequestRaw['paymentPayload'];
  paymentRequirements: PaymentRequirements;
}

export interface SettleRequest {
  paymentPayload: SettleRequestRaw['paymentPayload'];
  paymentRequirements: PaymentRequirements;
}

// =============================================================================
// Parsing Functions
// =============================================================================

/**
 * Safely parse verify request (returns error instead of throwing).
 */
export function safeParseVerifyRequest(
  body: unknown
): { success: true; data: VerifyRequest } | { success: false; error: z.ZodError } {
  const result = verifyRequestSchema.safeParse(body);
  if (!result.success) {
    return result;
  }
  // Cast to proper types (network is validated by regex, safe to cast)
  return {
    success: true,
    data: {
      paymentPayload: result.data.paymentPayload,
      paymentRequirements: {
        ...result.data.paymentRequirements,
        network: result.data.paymentRequirements.network as `${string}:${string}`,
      },
    },
  };
}

/**
 * Safely parse settle request (returns error instead of throwing).
 */
export function safeParseSettleRequest(
  body: unknown
): { success: true; data: SettleRequest } | { success: false; error: z.ZodError } {
  const result = settleRequestSchema.safeParse(body);
  if (!result.success) {
    return result;
  }
  // Cast to proper types (network is validated by regex, safe to cast)
  return {
    success: true,
    data: {
      paymentPayload: result.data.paymentPayload,
      paymentRequirements: {
        ...result.data.paymentRequirements,
        network: result.data.paymentRequirements.network as `${string}:${string}`,
      },
    },
  };
}

/**
 * Parse and validate verify request body.
 * Throws ZodError if validation fails.
 */
export function parseVerifyRequest(body: unknown): VerifyRequest {
  const result = safeParseVerifyRequest(body);
  if (!result.success) {
    throw result.error;
  }
  return result.data;
}

/**
 * Parse and validate settle request body.
 * Throws ZodError if validation fails.
 */
export function parseSettleRequest(body: unknown): SettleRequest {
  const result = safeParseSettleRequest(body);
  if (!result.success) {
    throw result.error;
  }
  return result.data;
}

// Re-export Zod for downstream use
export { z };
