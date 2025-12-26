'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { RefreshCw, X } from 'lucide-react';
import { formatUsdAmount } from '@/lib/format';
import {
  usePayerSessions,
  useReclaimable,
  useReclaimAll,
  type FilterStatus,
} from '@/lib/hooks/useQueries';
import { SessionTable, SessionFilterButtons } from '@/components/SessionTable';
import styles from './page.module.css';

export default function WalletSessionsPage() {
  const searchParams = useSearchParams();
  const initialFilter = (searchParams.get('status') as FilterStatus) || 'all';

  const [filter, setFilter] = useState<FilterStatus>(initialFilter);
  const [showReclaimModal, setShowReclaimModal] = useState(false);
  const [reclaimSuccess, setReclaimSuccess] = useState<string | null>(null);

  // React Query hooks
  const { data: sessions = [], isLoading, error: sessionsError } = usePayerSessions(filter);
  const { data: reclaimable } = useReclaimable();
  const reclaimAllMutation = useReclaimAll();

  const error = sessionsError || reclaimAllMutation.error;

  // Handle reclaim all
  const handleReclaimAll = async () => {
    setReclaimSuccess(null);

    try {
      const result = await reclaimAllMutation.mutateAsync();
      setShowReclaimModal(false);

      setReclaimSuccess(
        `Successfully reclaimed ${formatUsdAmount(result.totalReclaimed)} from ${result.reclaimedCount} session${result.reclaimedCount !== 1 ? 's' : ''}`
      );
    } catch {
      // Error handled by mutation
    }
  };

  const hasReclaimable = reclaimable && reclaimable.count > 0;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerContent}>
          <h1>My Sessions</h1>
          <p className={styles.headerSubtitle}>Track your deposits and spending across services</p>
        </div>
        <div className={styles.headerActions}>
          {hasReclaimable && (
            <button className={styles.reclaimBtn} onClick={() => setShowReclaimModal(true)}>
              <RefreshCw size={16} />
              Reclaim All ({formatUsdAmount(reclaimable.totalAvailable)})
            </button>
          )}
          <SessionFilterButtons filter={filter} onFilterChange={setFilter} />
        </div>
      </header>

      {/* Reclaim All Modal */}
      {showReclaimModal && reclaimable && (
        <div className={styles.modalOverlay} onClick={() => setShowReclaimModal(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <button className={styles.modalClose} onClick={() => setShowReclaimModal(false)}>
              <X size={20} />
            </button>
            <h2>Reclaim All Funds</h2>
            <p className={styles.modalDesc}>
              You are about to reclaim funds from {reclaimable.count} active session
              {reclaimable.count !== 1 ? 's' : ''}.
            </p>
            <div className={styles.modalAmount}>
              <span>Total to reclaim</span>
              <strong>{formatUsdAmount(reclaimable.totalAvailable)}</strong>
            </div>
            <p className={styles.modalHint}>
              This will capture any pending amounts owed to service providers and return the
              remaining funds to your wallet in a single transaction.
            </p>
            <div className={styles.modalActions}>
              <button
                className={styles.modalCancel}
                onClick={() => setShowReclaimModal(false)}
                disabled={reclaimAllMutation.isPending}
              >
                Cancel
              </button>
              <button
                className={styles.modalConfirm}
                onClick={handleReclaimAll}
                disabled={reclaimAllMutation.isPending}
              >
                {reclaimAllMutation.isPending ? 'Processing...' : 'Confirm Reclaim'}
              </button>
            </div>
          </div>
        </div>
      )}

      {reclaimSuccess && <div className={styles.success}>{reclaimSuccess}</div>}
      {error && (
        <div className={styles.error}>
          {error instanceof Error ? error.message : 'Failed to load sessions'}
        </div>
      )}

      <SessionTable
        sessions={sessions}
        isLoading={isLoading}
        variant="payer"
        basePath="/wallet/sessions"
        emptyTitle="Your sessions will appear here"
        emptyDescription="When you authorize a payment to an AI service, you can track and manage it here."
      />
    </div>
  );
}
