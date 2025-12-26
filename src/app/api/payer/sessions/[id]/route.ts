import { NextResponse } from 'next/server';
import {
  supabase,
  getNetwork,
  getSessionBalance,
  type DbSession,
  type DbUsageLog,
  type DbCaptureLog,
} from '@/lib/db';
import { getAuthenticatedPayer } from '@/lib/auth/payer';
import { getEffectiveStatus } from '@/lib/session-filters';
import { createLogger, getRequestId } from '@/lib/logger';
import { checkManagementRateLimit, rateLimitHeaders } from '@/lib/rate-limit';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/payer/sessions/[id] - Get session detail for payer
export async function GET(request: Request, { params }: RouteParams) {
  const reqId = getRequestId(request);
  const log = createLogger(reqId);

  try {
    const { id: sessionId } = await params;

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

    // Get session
    const { data: session, error: fetchError } = await supabase
      .from('sessions')
      .select('*')
      .eq('id', sessionId)
      .single<DbSession>();

    if (fetchError || !session) {
      log.debug('Session not found', { sessionId });
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404, headers: rateLimitHeaders(rateLimit) }
      );
    }

    // Verify session belongs to this payer
    if (session.payer !== payer.wallet) {
      log.warn('Session access denied', { sessionId, wallet: payer.wallet });
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404, headers: rateLimitHeaders(rateLimit) }
      );
    }

    // Get usage logs, capture logs, balance, and network in parallel
    const [usageLogsResult, captureLogsResult, balance, network] = await Promise.all([
      supabase
        .from('usage_logs')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: false })
        .limit(50)
        .returns<DbUsageLog[]>(),
      supabase
        .from('capture_logs')
        .select('*')
        .eq('session_id', sessionId)
        .eq('status', 'confirmed')
        .order('created_at', { ascending: false })
        .returns<DbCaptureLog[]>(),
      getSessionBalance(sessionId),
      getNetwork(session.network_id),
    ]);

    const usageLogs = usageLogsResult.data || [];
    const captureLogs = captureLogsResult.data || [];

    // Calculate status
    const status = getEffectiveStatus(session);

    // Use balance from view (source of truth)
    const authorized = BigInt(balance?.authorized_amount || session.authorized_amount);
    const captured = BigInt(balance?.captured_amount || '0');
    const pending = BigInt(balance?.pending_amount || '0');
    const availableFromView = BigInt(balance?.available_amount || '0');

    const available = status === 'active' ? availableFromView : BigInt(0);
    const reclaimed = status === 'voided' ? authorized - captured : BigInt(0);

    // Collect unique capture tx hashes
    const captureTxHashes = Array.from(
      new Set(captureLogs.map((c) => c.tx_hash).filter((h): h is string => h !== null))
    );

    log.debug('Payer session detail fetched', { sessionId, wallet: payer.wallet });

    // Build response
    const response: Record<string, unknown> = {
      id: session.id,
      networkId: session.network_id,
      networkName: network?.name || session.network_id,
      payer: session.payer,
      receiver: session.receiver,
      operator: session.operator,
      balance: {
        authorized: authorized.toString(),
        captured: captured.toString(),
        pending: pending.toString(),
        available: available.toString(),
        reclaimed: reclaimed.toString(),
      },
      authorizationExpiry: Math.floor(new Date(session.authorization_expiry).getTime() / 1000),
      refundExpiry: Math.floor(new Date(session.refund_expiry).getTime() / 1000),
      status,
      createdAt: session.created_at,
      blockExplorerUrl: network?.block_explorer_url || null,
      transactions: {
        authorize: session.authorize_tx_hash || null,
        captures: captureTxHashes,
        void: session.void_tx_hash || null,
      },
      debits: usageLogs.map((d) => ({
        id: d.id,
        amount: d.amount,
        requestId: d.request_id,
        description: d.description,
        createdAt: d.created_at,
      })),
    };

    return NextResponse.json(response, { headers: rateLimitHeaders(rateLimit) });
  } catch (err) {
    log.error('Get payer session error', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
