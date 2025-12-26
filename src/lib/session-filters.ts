import type { DbSession } from './db';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseQuery = any;

/**
 * Apply status filter to session query.
 * Handles the distinction between DB status and effective status (expired sessions).
 */
export function applyStatusFilter(query: SupabaseQuery, status: string | null): SupabaseQuery {
  if (!status || !['active', 'voided', 'expired', 'captured'].includes(status)) {
    return query;
  }

  const now = new Date().toISOString();

  switch (status) {
    case 'active':
      // Only truly active: DB status = 'active' AND not expired
      return query.eq('status', 'active').gt('authorization_expiry', now);
    case 'expired':
      // Either explicitly expired OR active but past expiry
      return query.or(`status.eq.expired,and(status.eq.active,authorization_expiry.lt.${now})`);
    default:
      return query.eq('status', status);
  }
}

/**
 * Compute effective status for a session (accounts for expiry).
 */
export function getEffectiveStatus(session: DbSession): DbSession['status'] {
  if (session.status !== 'active') {
    return session.status;
  }
  const isExpired = new Date(session.authorization_expiry).getTime() < Date.now();
  return isExpired ? 'expired' : 'active';
}
