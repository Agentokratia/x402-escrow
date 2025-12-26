'use client';

import { ExternalLink } from 'lucide-react';
import type { SessionData, ViewMode } from './types';
import styles from './session.module.css';

interface SessionInfoCardProps {
  session: SessionData;
  viewMode: ViewMode;
}

export function SessionInfoCard({ session, viewMode }: SessionInfoCardProps) {
  const formatAddress = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  const formatDate = (dateInput: string | number) => {
    const date = typeof dateInput === 'number' ? new Date(dateInput * 1000) : new Date(dateInput);
    return date.toLocaleString();
  };

  const getExplorerUrl = (type: 'tx' | 'address', value: string) => {
    if (!session.blockExplorerUrl) return null;
    return `${session.blockExplorerUrl}/${type}/${value}`;
  };

  const getStatusClass = (status: string) => {
    switch (status) {
      case 'active':
        return styles.statusActive;
      case 'captured':
        return styles.statusSettled;
      case 'voided':
        return styles.statusVoided;
      case 'expired':
        return styles.statusExpired;
      default:
        return '';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'voided':
        return 'Reclaimed';
      case 'captured':
        return 'Settled';
      default:
        return status.charAt(0).toUpperCase() + status.slice(1);
    }
  };

  // Show payer for operator view, receiver for payer view
  const counterparty = viewMode === 'operator' ? session.payer : session.receiver;
  const counterpartyLabel = viewMode === 'operator' ? 'Payer' : 'Receiver';

  return (
    <div className={styles.card}>
      <h3>Details</h3>
      <div className={styles.detailsList}>
        <div className={styles.detailRow}>
          <span className={styles.detailLabel}>Session ID</span>
          <span className={styles.detailValue}>
            <code>{formatAddress(session.id)}</code>
          </span>
        </div>

        <div className={styles.detailRow}>
          <span className={styles.detailLabel}>{counterpartyLabel}</span>
          {session.blockExplorerUrl ? (
            <a
              href={getExplorerUrl('address', counterparty)!}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.txLink}
            >
              <code>{formatAddress(counterparty)}</code>
              <ExternalLink size={14} />
            </a>
          ) : (
            <span className={styles.detailValue}>
              <code>{formatAddress(counterparty)}</code>
            </span>
          )}
        </div>

        <div className={styles.detailRow}>
          <span className={styles.detailLabel}>Network</span>
          <span className={styles.detailValue}>{session.networkName}</span>
        </div>

        <div className={styles.detailRow}>
          <span className={styles.detailLabel}>Status</span>
          <span className={`${styles.status} ${getStatusClass(session.status)}`}>
            {getStatusLabel(session.status)}
          </span>
        </div>

        <div className={styles.detailRow}>
          <span className={styles.detailLabel}>Created</span>
          <span className={styles.detailValue}>{formatDate(session.createdAt)}</span>
        </div>

        <div className={styles.detailRow}>
          <div className={styles.detailWithHint}>
            <span className={styles.detailLabel}>
              {viewMode === 'operator' ? 'Auth Expires' : 'Charging Ends'}
            </span>
            {viewMode === 'payer' && (
              <span className={styles.detailHint}>No charges after this</span>
            )}
          </div>
          <span className={styles.detailValue}>{formatDate(session.authorizationExpiry)}</span>
        </div>

        {session.refundExpiry && (
          <div className={styles.detailRow}>
            <div className={styles.detailWithHint}>
              <span className={styles.detailLabel}>Refund By</span>
              {viewMode === 'payer' && (
                <span className={styles.detailHint}>
                  Unused auto-returns. Last date to dispute.
                </span>
              )}
            </div>
            <span className={styles.detailValue}>{formatDate(session.refundExpiry)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
