import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabase } from '@/lib/db';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { createLogger, getRequestId } from '@/lib/logger';
import { checkManagementRateLimit, rateLimitHeaders } from '@/lib/rate-limit';

// Zod schema for profile update
const updateProfileSchema = z.object({
  name: z.string().max(100).optional(),
  email: z.string().email('Invalid email format').max(255).optional().or(z.literal('')),
});

// GET /api/auth/me - Get current user profile
export async function GET(request: Request) {
  const reqId = getRequestId(request);
  const log = createLogger(reqId);

  try {
    const auth = await getAuthenticatedUser(request);

    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Rate limit check (by user ID)
    const rateLimit = checkManagementRateLimit(auth.userId);
    if (!rateLimit.allowed) {
      log.warn('Management rate limit exceeded', { userId: auth.userId });
      return NextResponse.json(
        { error: 'Rate limit exceeded' },
        { status: 429, headers: rateLimitHeaders(rateLimit) }
      );
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('id, wallet, name, email, created_at, updated_at')
      .eq('id', auth.userId)
      .single();

    if (error || !user) {
      log.warn('User not found', { userId: auth.userId });
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404, headers: rateLimitHeaders(rateLimit) }
      );
    }

    log.debug('User profile fetched', { userId: auth.userId });
    return NextResponse.json(
      {
        user: {
          id: user.id,
          wallet: user.wallet,
          name: user.name,
          email: user.email,
          createdAt: user.created_at,
          updatedAt: user.updated_at,
        },
      },
      { headers: rateLimitHeaders(rateLimit) }
    );
  } catch (err) {
    log.error('Get user error', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PATCH /api/auth/me - Update current user profile
export async function PATCH(request: Request) {
  const reqId = getRequestId(request);
  const log = createLogger(reqId);

  try {
    const auth = await getAuthenticatedUser(request);

    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Rate limit check (by user ID)
    const rateLimit = checkManagementRateLimit(auth.userId);
    if (!rateLimit.allowed) {
      log.warn('Management rate limit exceeded', { userId: auth.userId });
      return NextResponse.json(
        { error: 'Rate limit exceeded' },
        { status: 429, headers: rateLimitHeaders(rateLimit) }
      );
    }

    // Parse and validate request body
    const rawBody = await request.json();
    const parseResult = updateProfileSchema.safeParse(rawBody);

    if (!parseResult.success) {
      log.warn('Invalid profile update request', { errors: parseResult.error.issues });
      return NextResponse.json(
        { error: 'Invalid request body', details: parseResult.error.issues },
        { status: 400, headers: rateLimitHeaders(rateLimit) }
      );
    }

    const body = parseResult.data;

    // Build update object (only include fields that were provided)
    const updates: { name?: string | null; email?: string | null } = {};
    if (body.name !== undefined) {
      updates.name = body.name.trim() || null;
    }
    if (body.email !== undefined) {
      updates.email = body.email.trim() || null;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400, headers: rateLimitHeaders(rateLimit) }
      );
    }

    const { data: user, error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', auth.userId)
      .select('id, wallet, name, email, created_at, updated_at')
      .single();

    if (error) {
      log.error('Update user error', new Error(error.message));
      return NextResponse.json(
        { error: 'Failed to update profile' },
        { status: 500, headers: rateLimitHeaders(rateLimit) }
      );
    }

    log.info('User profile updated', { userId: auth.userId, fields: Object.keys(updates) });
    return NextResponse.json(
      {
        user: {
          id: user.id,
          wallet: user.wallet,
          name: user.name,
          email: user.email,
          createdAt: user.created_at,
          updatedAt: user.updated_at,
        },
      },
      { headers: rateLimitHeaders(rateLimit) }
    );
  } catch (err) {
    log.error('Update user error', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
