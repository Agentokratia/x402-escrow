import { supabase, type DbSession } from './db';
import { batchCapture, sessionToPaymentInfo } from './escrow';

// Default 1 USDC (6 decimals), handle empty/undefined env
const CAPTURE_THRESHOLD = BigInt(process.env.CAPTURE_THRESHOLD || '1000000');
const BATCH_SIZE = 50; // Max sessions per batch capture

export interface CaptureResult {
  sessionId: string;
  amount: string;
  success: boolean;
  txHash?: string;
  error?: string;
}

// Session with pending amount from log-based balance
interface SessionWithPending extends Omit<
  DbSession,
  'captured_amount' | 'pending_amount' | 'authorize_tx_hash' | 'void_tx_hash' | 'created_at'
> {
  pending_from_logs: string;
}

// TIER 1: Batch capture when threshold reached (every 15 min)
export async function captureTier1(): Promise<CaptureResult[]> {
  // Get sessions with pending amount >= threshold using log-based balance
  const { data: sessions, error } = await supabase.rpc('get_sessions_for_capture_tier1', {
    p_threshold: CAPTURE_THRESHOLD.toString(),
    p_limit: BATCH_SIZE,
  });

  if (error || !sessions || sessions.length === 0) {
    if (error) console.error('TIER 1: Failed to fetch sessions:', error);
    return [];
  }

  return batchCaptureWithDb(sessions as SessionWithPending[], 1);
}

// TIER 2: Batch capture approaching expiry (every 30 min, < 2h to expiry)
export async function captureTier2(): Promise<CaptureResult[]> {
  // Get sessions expiring within 2 hours with pending amount using log-based balance
  const twoHoursFromNow = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

  const { data: sessions, error } = await supabase.rpc('get_sessions_for_capture_tier2', {
    p_expiry_before: twoHoursFromNow,
    p_limit: BATCH_SIZE,
  });

  if (error || !sessions || sessions.length === 0) {
    if (error) console.error('TIER 2: Failed to fetch sessions:', error);
    return [];
  }

  return batchCaptureWithDb(sessions as SessionWithPending[], 2);
}

// Batch capture with Multicall3 and atomic DB updates - groups by network
async function batchCaptureWithDb(
  sessions: SessionWithPending[],
  tier: number
): Promise<CaptureResult[]> {
  const sessionsWithPending = sessions.filter((s) => BigInt(s.pending_from_logs) > BigInt(0));

  if (sessionsWithPending.length === 0) {
    return [];
  }

  // Group sessions by network_id for efficient batch captures
  const byNetwork = new Map<string, SessionWithPending[]>();
  for (const session of sessionsWithPending) {
    const networkSessions = byNetwork.get(session.network_id) || [];
    networkSessions.push(session);
    byNetwork.set(session.network_id, networkSessions);
  }

  const results: CaptureResult[] = [];

  // Process each network's sessions as a batch
  for (const [networkId, networkSessions] of byNetwork) {
    // Build captures with full PaymentInfo for each session
    const captures = networkSessions.map((s) => ({
      sessionId: s.id,
      paymentInfo: sessionToPaymentInfo(s as unknown as DbSession),
      amount: BigInt(s.pending_from_logs),
    }));

    // Call escrow batch capture via Multicall3 for this network
    const { results: escrowResults, txHash } = await batchCapture(
      networkId,
      captures.map((c) => ({ paymentInfo: c.paymentInfo, amount: c.amount }))
    );

    // Update DB atomically for each session
    for (let i = 0; i < captures.length; i++) {
      const { sessionId, amount } = captures[i];
      const escrowResult = escrowResults[i];

      if (!escrowResult.success) {
        results.push({
          sessionId,
          amount: amount.toString(),
          success: false,
          error: escrowResult.error,
        });
        continue;
      }

      // Use atomic DB function to update session
      const { data: dbResult, error: rpcError } = await supabase.rpc('batch_capture', {
        p_session_id: sessionId,
        p_tx_hash: txHash,
        p_tier: tier,
      });

      if (rpcError) {
        console.error(`TIER ${tier}: batch_capture RPC error for ${sessionId}:`, rpcError);
        results.push({
          sessionId,
          amount: amount.toString(),
          success: false,
          txHash,
          error: 'DB update failed after on-chain capture',
        });
        continue;
      }

      const captureDbResult = dbResult?.[0];
      if (!captureDbResult?.success) {
        results.push({
          sessionId,
          amount: amount.toString(),
          success: false,
          txHash,
          error: captureDbResult?.error_message || 'DB update failed',
        });
        continue;
      }

      results.push({
        sessionId,
        amount: captureDbResult.captured_amount?.toString() || amount.toString(),
        success: true,
        txHash,
      });
    }
  }

  return results;
}
