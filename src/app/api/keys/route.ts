import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabase, type DbApiKey } from '@/lib/db';
import { generateApiKey, hashApiKey } from '@/lib/auth';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { createLogger, getRequestId } from '@/lib/logger';
import { checkManagementRateLimit, rateLimitHeaders } from '@/lib/rate-limit';

// Zod schema for creating API key
const createKeySchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name too long').trim(),
});

// GET /api/keys - List API keys for authenticated user
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

    const { data: apiKeys, error } = await supabase
      .from('api_keys')
      .select('id, name, status, created_at')
      .eq('user_id', auth.userId)
      .order('created_at', { ascending: false })
      .returns<Pick<DbApiKey, 'id' | 'name' | 'status' | 'created_at'>[]>();

    if (error) {
      log.error('Failed to list API keys', new Error(error.message));
      return NextResponse.json(
        { error: 'Failed to list API keys' },
        { status: 500, headers: rateLimitHeaders(rateLimit) }
      );
    }

    log.debug('API keys listed', { userId: auth.userId, count: apiKeys?.length || 0 });
    return NextResponse.json(
      {
        apiKeys: (apiKeys || []).map((k) => ({
          id: k.id,
          name: k.name,
          status: k.status,
          createdAt: k.created_at,
        })),
      },
      { headers: rateLimitHeaders(rateLimit) }
    );
  } catch (err) {
    log.error('List API keys error', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/keys - Create a new API key for authenticated user
export async function POST(request: Request) {
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
    const parseResult = createKeySchema.safeParse(rawBody);

    if (!parseResult.success) {
      log.warn('Invalid create key request', { errors: parseResult.error.issues });
      return NextResponse.json(
        { error: 'Invalid request body', details: parseResult.error.issues },
        { status: 400, headers: rateLimitHeaders(rateLimit) }
      );
    }

    const { name } = parseResult.data;

    const apiKey = generateApiKey();
    const apiKeyHash = hashApiKey(apiKey);

    const { data: apiKeyRecord, error: apiKeyError } = await supabase
      .from('api_keys')
      .insert({
        user_id: auth.userId,
        name,
        api_key_hash: apiKeyHash,
        status: 'active',
      })
      .select('id, name, created_at')
      .single();

    if (apiKeyError || !apiKeyRecord) {
      log.error('Failed to create API key', new Error(apiKeyError?.message || 'Unknown error'));
      return NextResponse.json(
        { error: 'Failed to create API key' },
        { status: 500, headers: rateLimitHeaders(rateLimit) }
      );
    }

    log.info('API key created', { userId: auth.userId, keyId: apiKeyRecord.id });
    return NextResponse.json(
      {
        id: apiKeyRecord.id,
        name: apiKeyRecord.name,
        apiKey, // Only returned once
        createdAt: apiKeyRecord.created_at,
      },
      { status: 201, headers: rateLimitHeaders(rateLimit) }
    );
  } catch (err) {
    log.error('Create API key error', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
