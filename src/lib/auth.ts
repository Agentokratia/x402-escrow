import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { supabase, DbApiKey } from './db';

export function generateApiKey(): string {
  return `x402_${randomBytes(32).toString('hex')}`;
}

export function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex');
}

// Session tokens - similar to API keys but for session access
export function generateSessionToken(): string {
  return `sess_${randomBytes(32).toString('hex')}`;
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Constant-time comparison of two hex strings to prevent timing attacks.
 * Returns true if the strings are equal, false otherwise.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  try {
    const bufA = Buffer.from(a, 'hex');
    const bufB = Buffer.from(b, 'hex');
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

export async function validateApiKey(apiKey: string | null): Promise<{
  valid: boolean;
  userId?: string;
  apiKeyId?: string;
}> {
  if (!apiKey) {
    return { valid: false };
  }

  const hash = hashApiKey(apiKey);
  const { data: apiKeyRecord } = await supabase
    .from('api_keys')
    .select('id, user_id, status')
    .eq('api_key_hash', hash)
    .single<Pick<DbApiKey, 'id' | 'user_id' | 'status'>>();

  if (!apiKeyRecord || apiKeyRecord.status !== 'active') {
    return { valid: false };
  }

  // Update last_used_at (fire-and-forget, don't block on it)
  supabase
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', apiKeyRecord.id)
    .then(({ error }) => {
      if (error) console.error('Failed to update last_used_at:', error);
    });

  return {
    valid: true,
    userId: apiKeyRecord.user_id,
    apiKeyId: apiKeyRecord.id,
  };
}

// Extract Bearer token from request (can be JWT or API key)
export function extractBearerToken(request: Request): string | null {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return null;

  const [type, token] = authHeader.split(' ');
  if (type !== 'Bearer' || !token) return null;

  return token;
}
