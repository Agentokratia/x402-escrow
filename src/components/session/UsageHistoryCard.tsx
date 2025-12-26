'use client';

import { formatUsdAmount } from '@/lib/format';
import type { SessionDebit } from './types';
import styles from './session.module.css';

interface UsageHistoryCardProps {
  debits: SessionDebit[];
}

export function UsageHistoryCard({ debits }: UsageHistoryCardProps) {
  if (debits.length === 0) {
    return (
      <div className={styles.card}>
        <h3>Usage History</h3>
        <div className={styles.emptyState}>
          <p>Usage will appear here as the service charges your balance</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.card}>
      <h3>Usage History</h3>
      <div className={styles.usageTable}>
        <div className={styles.usageHeader}>
          <span>Amount</span>
          <span>Description</span>
          <span>Date</span>
        </div>
        {debits.map((debit) => (
          <div key={debit.id} className={styles.usageRow}>
            <span className={styles.usageAmount}>{formatUsdAmount(debit.amount)}</span>
            <span className={styles.usageDesc}>{debit.description || debit.requestId}</span>
            <span className={styles.usageDate}>{new Date(debit.createdAt).toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
