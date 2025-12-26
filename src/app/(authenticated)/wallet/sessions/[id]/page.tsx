'use client';

import { useState, useEffect, useRef, use } from 'react';
import Link from 'next/link';
import { ArrowLeft, AlertCircle } from 'lucide-react';
import { formatUsdAmount, getStatusLabel, getStatusClassName } from '@/lib/format';
import { usePayerSessionDetail, useReclaimSession } from '@/lib/hooks/useQueries';
import {
  SessionBalanceCard,
  SessionInfoCard,
  TransactionsCard,
  UsageHistoryCard,
} from '@/components/session';
import styles from './page.module.css';

export default function SessionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = use(params);
  const { data: session, isLoading, error: queryError } = usePayerSessionDetail(sessionId);
  const reclaimMutation = useReclaimSession(sessionId);

  const [reclaimSuccess, setReclaimSuccess] = useState<string | null>(null);
  const [showReclaimConfirm, setShowReclaimConfirm] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  // Close modal on Escape key
  useEffect(() => {
    if (!showReclaimConfirm) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowReclaimConfirm(false);
    };

    document.addEventListener('keydown', handleEscape);
    modalRef.current?.focus();

    return () => document.removeEventListener('keydown', handleEscape);
  }, [showReclaimConfirm]);

  const humanizeError = (error: string): string => {
    const errorMap: Record<string, string> = {
      SESSION_NOT_FOUND: 'This session could not be found. It may have been deleted.',
      SESSION_INACTIVE: 'This session is no longer active and cannot be reclaimed.',
      SESSION_EXPIRED: 'This session has expired. Please contact support if you need assistance.',
      INSUFFICIENT_BALANCE: 'There are no funds available to reclaim.',
      NETWORK_ERROR: 'Network connection failed. Please check your internet and try again.',
      'Failed to reclaim funds': 'Unable to process your request. Please try again in a moment.',
    };
    return errorMap[error] || error;
  };

  const handleReclaimClick = () => {
    setShowReclaimConfirm(true);
  };

  const handleReclaimConfirm = async () => {
    if (!session || reclaimMutation.isPending) return;

    setShowReclaimConfirm(false);
    setReclaimSuccess(null);

    try {
      const data = await reclaimMutation.mutateAsync();
      setReclaimSuccess(`Reclaimed ${formatUsdAmount(data.reclaimedAmount)} USDC`);
    } catch {
      // Error handled by mutation
    }
  };

  // Can reclaim funds via backend API (works for active and expired sessions)
  const canReclaim = () => {
    if (!session) return false;
    if (session.status !== 'active' && session.status !== 'expired') return false;
    const authorized = parseFloat(session.balance.authorized);
    const captured = parseFloat(session.balance.captured);
    return authorized > captured;
  };

  const error = queryError || reclaimMutation.error;
  const reclaimError = reclaimMutation.error
    ? humanizeError(
        reclaimMutation.error instanceof Error ? reclaimMutation.error.message : 'Failed to reclaim'
      )
    : null;

  if (isLoading) {
    return (
      <div className={styles.page}>
        <div className={styles.loading}>Loading session...</div>
      </div>
    );
  }

  if (queryError || !session) {
    return (
      <div className={styles.page}>
        <div className={styles.error}>
          <AlertCircle size={24} />
          <p>{error instanceof Error ? error.message : 'Session not found'}</p>
          <Link href="/wallet/sessions" className={styles.backLink}>
            Back to sessions
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/wallet/sessions" className={styles.backBtn}>
          <ArrowLeft size={18} />
          Back
        </Link>
        <div className={styles.headerMain}>
          <h1>Session Details</h1>
          <span className={`${styles.status} ${getStatusClassName(session.status, styles)}`}>
            {getStatusLabel(session.status)}
          </span>
        </div>
      </header>

      {reclaimError && (
        <div className={styles.errorBanner} role="alert">
          {reclaimError}
        </div>
      )}
      {reclaimSuccess && (
        <div className={styles.successBanner} role="status">
          {reclaimSuccess}
        </div>
      )}

      <div className={styles.grid}>
        {/* Balance Card with Reclaim Button */}
        <div className={styles.balanceWrapper}>
          <SessionBalanceCard balance={session.balance} status={session.status} viewMode="payer" />
          {canReclaim() && (
            <button
              className={styles.reclaimBtn}
              onClick={handleReclaimClick}
              disabled={reclaimMutation.isPending}
              aria-describedby="reclaim-description"
            >
              {reclaimMutation.isPending ? 'Processing...' : 'Reclaim Unused Funds'}
            </button>
          )}
          <span id="reclaim-description" className={styles.srOnly}>
            Returns unused funds to your wallet. This action cannot be undone.
          </span>
          {session.status === 'voided' && (
            <p className={styles.voidedNote}>Funds have been reclaimed.</p>
          )}
        </div>

        <SessionInfoCard session={session} viewMode="payer" />
      </div>

      <TransactionsCard session={session} />

      {session.debits && <UsageHistoryCard debits={session.debits} />}

      {/* Reclaim Confirmation Modal */}
      {showReclaimConfirm && (
        <div
          className={styles.modalOverlay}
          onClick={() => setShowReclaimConfirm(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="reclaim-modal-title"
        >
          <div
            ref={modalRef}
            className={styles.modal}
            onClick={(e) => e.stopPropagation()}
            tabIndex={-1}
          >
            <h3 id="reclaim-modal-title">Confirm Reclaim</h3>
            <p className={styles.modalText}>
              You are about to reclaim your unused funds. This will:
            </p>
            <ul className={styles.modalList}>
              <li>
                Return{' '}
                <strong>
                  {formatUsdAmount(
                    (
                      parseFloat(session.balance.authorized) - parseFloat(session.balance.captured)
                    ).toString()
                  )}
                </strong>{' '}
                to your wallet
              </li>
              <li>Settle any pending charges ({formatUsdAmount(session.balance.pending)})</li>
              <li>Close this payment session permanently</li>
            </ul>
            <p className={styles.modalWarning}>This action cannot be undone.</p>
            <div className={styles.modalActions}>
              <button
                className={styles.modalCancelBtn}
                onClick={() => setShowReclaimConfirm(false)}
              >
                Cancel
              </button>
              <button className={styles.modalConfirmBtn} onClick={handleReclaimConfirm}>
                Reclaim Funds
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
