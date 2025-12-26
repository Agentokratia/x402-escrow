import { NextResponse } from 'next/server';
import { SiweMessage } from 'siwe';
import { z } from 'zod';
import { supabase } from '@/lib/db';
import { verifySiweMessage } from '@/lib/auth/siwe';
import { createToken } from '@/lib/auth/jwt';
import { createLogger, getRequestId } from '@/lib/logger';
import { checkSiweVerifyRateLimit, getClientIp, rateLimitHeaders } from '@/lib/rate-limit';

// Zod schema for SIWE verify request
const verifyRequestSchema = z.object({
  message: z.string().min(1, 'Message is required'),
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/, 'Invalid signature format'),
});

export async function POST(request: Request) {
  const reqId = getRequestId(request);
  const log = createLogger(reqId);
  const clientIp = getClientIp(request);

  try {
    // Rate limit check
    const rateLimit = checkSiweVerifyRateLimit(clientIp);
    if (!rateLimit.allowed) {
      log.warn('SIWE verify rate limit exceeded', { ip: clientIp });
      return NextResponse.json(
        { error: 'Rate limit exceeded' },
        { status: 429, headers: rateLimitHeaders(rateLimit) }
      );
    }

    // Parse and validate request body
    const rawBody = await request.json();
    const parseResult = verifyRequestSchema.safeParse(rawBody);

    if (!parseResult.success) {
      log.warn('Invalid verify request', { errors: parseResult.error.issues });
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400, headers: rateLimitHeaders(rateLimit) }
      );
    }

    const { message, signature } = parseResult.data;

    // Parse SIWE message to get nonce
    let siweMessage: SiweMessage;
    try {
      siweMessage = new SiweMessage(message);
    } catch {
      log.warn('Invalid SIWE message format', { ip: clientIp });
      return NextResponse.json(
        { error: 'Invalid SIWE message' },
        { status: 400, headers: rateLimitHeaders(rateLimit) }
      );
    }

    const { nonce } = siweMessage;

    // Verify SIWE signature first (before touching DB)
    const verifyResult = await verifySiweMessage(message, signature);

    if (!verifyResult.success || !verifyResult.address) {
      log.warn('SIWE signature verification failed', { ip: clientIp, error: verifyResult.error });
      return NextResponse.json(
        { error: verifyResult.error || 'Signature verification failed' },
        { status: 401, headers: rateLimitHeaders(rateLimit) }
      );
    }

    const walletAddress = verifyResult.address.toLowerCase();

    // Atomically claim nonce: UPDATE returns the row only if conditions met
    // This prevents race conditions (TOCTOU) where two requests use same nonce
    const { data: claimedNonce, error: claimError } = await supabase
      .from('auth_nonces')
      .update({ used_at: new Date().toISOString(), wallet: walletAddress })
      .eq('nonce', nonce)
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .select('id')
      .single();

    if (claimError || !claimedNonce) {
      log.warn('Invalid or expired nonce', { ip: clientIp, nonce: nonce.substring(0, 8) });
      return NextResponse.json(
        { error: 'Invalid or expired nonce' },
        { status: 401, headers: rateLimitHeaders(rateLimit) }
      );
    }

    // Find or create user
    let { data: user } = await supabase
      .from('users')
      .select('id, wallet, name')
      .eq('wallet', walletAddress)
      .single();

    if (!user) {
      // Create new user
      const { data: newUser, error: createError } = await supabase
        .from('users')
        .insert({ wallet: walletAddress })
        .select('id, wallet, name')
        .single();

      if (createError || !newUser) {
        log.error('Failed to create user', new Error(createError?.message || 'Unknown error'));
        return NextResponse.json(
          { error: 'Failed to create user' },
          { status: 500, headers: rateLimitHeaders(rateLimit) }
        );
      }
      user = newUser;
      log.info('New user created', { wallet: walletAddress });
    }

    // Create JWT token
    const token = await createToken(user.id, walletAddress);

    log.info('SIWE verification successful', { wallet: walletAddress, userId: user.id });
    return NextResponse.json(
      {
        token,
        user: {
          id: user.id,
          wallet: user.wallet,
          name: user.name,
        },
      },
      { headers: rateLimitHeaders(rateLimit) }
    );
  } catch (err) {
    log.error('Verify error', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
