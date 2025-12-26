import { verifyToken } from './jwt';
import { validateApiKey, extractBearerToken } from '../auth';

export interface UserAuth {
  userId: string;
  wallet: string | null; // null for API key auth
}

/**
 * Get authenticated user from request.
 * Supports both JWT tokens (dashboard) and API keys (integration).
 * Returns userId and wallet (wallet is null for API key auth).
 */
export async function getAuthenticatedUser(request: Request): Promise<UserAuth | null> {
  const token = extractBearerToken(request);
  if (!token) return null;

  // JWT auth (dashboard) - tokens don't have x402_ prefix
  if (!token.startsWith('x402_')) {
    const payload = await verifyToken(token);
    if (!payload?.sub) return null;
    return {
      userId: payload.sub,
      wallet: payload.address?.toLowerCase() ?? null,
    };
  }

  // API key auth (integration) - no wallet
  const { valid, userId } = await validateApiKey(token);
  if (!valid || !userId) return null;
  return { userId, wallet: null };
}
