import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabase, getNetwork, type DbSession, type DbSessionBalance } from '@/lib/db';
import { getAuthenticatedPayer } from '@/lib/auth/payer';
import { applyStatusFilter, getEffectiveStatus } from '@/lib/session-filters';
import { createLogger, getRequestId } from '@/lib/logger';
import { checkManagementRateLimit, rateLimitHeaders } from '@/lib/rate-limit';

// Zod schema for query params validation
const queryParamsSchema = z.object({
  status: z.enum(['active', 'expired', 'voided', 'captured']).optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
});

// GET /api/payer/sessions - List sessions where payer = authenticated wallet
export async function GET(request: Request) {
  const reqId = getRequestId(request);
  const log = createLogger(reqId);

  try {
    const { searchParams } = new URL(request.url);

    const payer = await getAuthenticatedPayer(request);

    if (!payer) {
      return NextResponse.json({ error: 'Unauthorized - JWT required' }, { status: 401 });
    }

    // Rate limit check (by user ID from JWT)
    const rateLimit = checkManagementRateLimit(payer.userId);
    if (!rateLimit.allowed) {
      log.warn('Management rate limit exceeded', { userId: payer.userId });
      return NextResponse.json(
        { error: 'Rate limit exceeded' },
        { status: 429, headers: rateLimitHeaders(rateLimit) }
      );
    }

    // Parse and validate query params
    const parseResult = queryParamsSchema.safeParse({
      status: searchParams.get('status') || undefined,
      limit: searchParams.get('limit') || 50,
      offset: searchParams.get('offset') || 0,
    });

    if (!parseResult.success) {
      log.warn('Invalid query params', { errors: parseResult.error.issues });
      return NextResponse.json(
        { error: 'Invalid query parameters', details: parseResult.error.issues },
        { status: 400, headers: rateLimitHeaders(rateLimit) }
      );
    }

    const { status, limit, offset } = parseResult.data;

    // Query sessions by payer wallet
    let query = supabase
      .from('sessions')
      .select('*', { count: 'exact' })
      .eq('payer', payer.wallet)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    query = applyStatusFilter(query, status || null);

    const { data: sessions, error, count } = await query.returns<DbSession[]>();

    if (error) {
      log.error('Failed to list payer sessions', new Error(error.message));
      return NextResponse.json(
        { error: 'Failed to list sessions' },
        { status: 500, headers: rateLimitHeaders(rateLimit) }
      );
    }

    // Get network names and session balances in parallel
    const sessionIds = sessions?.map((s) => s.id) || [];
    const networkIds = [...new Set(sessions?.map((s) => s.network_id) || [])];

    const [networks, balancesResult] = await Promise.all([
      Promise.all(networkIds.map((id) => getNetwork(id))),
      sessionIds.length > 0
        ? supabase
            .from('session_balances')
            .select('*')
            .in('session_id', sessionIds)
            .returns<DbSessionBalance[]>()
        : Promise.resolve({ data: [] }),
    ]);

    const networkMap = new Map(networks.filter(Boolean).map((n) => [n!.id, n!.name]));
    const balanceMap = new Map((balancesResult.data || []).map((b) => [b.session_id, b]));

    log.debug('Payer sessions listed', { wallet: payer.wallet, count: sessions?.length || 0 });

    // Return sessions with balance breakdown from view
    return NextResponse.json(
      {
        sessions:
          sessions?.map((s) => {
            const status = getEffectiveStatus(s);
            const balance = balanceMap.get(s.id);
            const available =
              status === 'active' ? BigInt(balance?.available_amount || '0') : BigInt(0);

            return {
              id: s.id,
              networkId: s.network_id,
              networkName: networkMap.get(s.network_id) || s.network_id,
              receiver: s.receiver,
              balance: {
                authorized: balance?.authorized_amount || s.authorized_amount,
                captured: balance?.captured_amount || '0',
                pending: balance?.pending_amount || '0',
                available: available.toString(),
              },
              authorizationExpiry: Math.floor(new Date(s.authorization_expiry).getTime() / 1000),
              refundExpiry: Math.floor(new Date(s.refund_expiry).getTime() / 1000),
              status,
              createdAt: s.created_at,
            };
          }) || [],
        total: count || 0,
        limit,
        offset,
      },
      { headers: rateLimitHeaders(rateLimit) }
    );
  } catch (err) {
    log.error('List payer sessions error', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
