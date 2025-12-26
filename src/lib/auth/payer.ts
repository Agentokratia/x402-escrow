import { verifyToken } from './jwt';
import { extractBearerToken } from '../auth';

export interface PayerAuth {
  userId: string;
  wallet: string;
}

/**
 * Get authenticated payer from JWT.
 * Only JWT auth is allowed for payer routes (no API keys).
 * Returns the payer's wallet address which is used to query sessions.
 */
export async function getAuthenticatedPayer(request: Request): Promise<PayerAuth | null> {
  const token = extractBearerToken(request);
  if (!token) return null;

  // API keys are not allowed for payer routes
  if (token.startsWith('x402_')) {
    return null;
  }

  // JWT auth only
  const payload = await verifyToken(token);
  if (!payload?.sub || !payload?.address) {
    return null;
  }

  return {
    userId: payload.sub,
    wallet: payload.address.toLowerCase(),
  };
}
