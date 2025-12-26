import { NextResponse } from 'next/server';
import { supabase } from '@/lib/db';
import { generateNonce } from '@/lib/auth/siwe';
import { createLogger, getRequestId } from '@/lib/logger';
import { checkNonceRateLimit, getClientIp, rateLimitHeaders } from '@/lib/rate-limit';

// Nonce expires in 5 minutes
const NONCE_EXPIRY_MS = 5 * 60 * 1000;

export async function GET(request: Request) {
  const reqId = getRequestId(request);
  const log = createLogger(reqId);
  const clientIp = getClientIp(request);

  try {
    // Rate limit check
    const rateLimit = checkNonceRateLimit(clientIp);
    if (!rateLimit.allowed) {
      log.warn('Nonce rate limit exceeded', { ip: clientIp });
      return NextResponse.json(
        { error: 'Rate limit exceeded' },
        { status: 429, headers: rateLimitHeaders(rateLimit) }
      );
    }

    const nonce = generateNonce();
    const expiresAt = new Date(Date.now() + NONCE_EXPIRY_MS);

    // Cleanup expired nonces (fire and forget, don't block response)
    supabase
      .from('auth_nonces')
      .delete()
      .lt('expires_at', new Date().toISOString())
      .then(({ error }) => {
        if (error) log.debug('Nonce cleanup error', { error: error.message });
      });

    const { error } = await supabase.from('auth_nonces').insert({
      nonce,
      expires_at: expiresAt.toISOString(),
    });

    if (error) {
      log.error('Failed to create nonce', new Error(error.message));
      return NextResponse.json(
        { error: 'Failed to create nonce' },
        { status: 500, headers: rateLimitHeaders(rateLimit) }
      );
    }

    log.debug('Nonce created', { ip: clientIp });
    return NextResponse.json({ nonce }, { headers: rateLimitHeaders(rateLimit) });
  } catch (err) {
    log.error('Nonce error', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
