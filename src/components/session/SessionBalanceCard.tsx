'use client';

import { formatUsdAmount } from '@/lib/format';
import type { SessionBalance, ViewMode } from './types';
import styles from './session.module.css';

interface SessionBalanceCardProps {
  balance: SessionBalance;
  status: string;
  viewMode: ViewMode;
}

export function SessionBalanceCard({ balance, status, viewMode }: SessionBalanceCardProps) {
  const authorized = parseFloat(balance.authorized);
  const captured = parseFloat(balance.captured);
  const pending = parseFloat(balance.pending);
  const available = parseFloat(balance.available);
  const reclaimed = parseFloat(balance.reclaimed || '0');

  // Calculate percentages for bar
  const pct =
    authorized === 0
      ? { settled: 0, pending: 0, available: 100 }
      : {
          settled: (captured / authorized) * 100,
          pending: (pending / authorized) * 100,
          available:
            status === 'voided' ? (reclaimed / authorized) * 100 : (available / authorized) * 100,
        };

  // Ensure minimum width for visibility
  const minWidth = (val: number) => (val > 0 ? Math.max(2, val) : 0);

  // Labels differ by view mode
  const settledLabel = viewMode === 'operator' ? 'Settled' : 'Spent';

  return (
    <div className={styles.card}>
      <h3>Balance</h3>
      <div
        className={styles.balanceBar}
        role="img"
        aria-label={`Balance: ${formatUsdAmount(balance.captured)} ${settledLabel.toLowerCase()}, ${formatUsdAmount(balance.pending)} pending, ${status === 'voided' ? formatUsdAmount(balance.reclaimed || '0') + ' reclaimed' : formatUsdAmount(balance.available) + ' available'}`}
      >
        <div
          className={styles.barSettled}
          style={{ width: `${minWidth(pct.settled)}%` }}
          title={`${settledLabel}: ${formatUsdAmount(balance.captured)}`}
        />
        <div
          className={styles.barPending}
          style={{ width: `${minWidth(pct.pending)}%` }}
          title={`Pending: ${formatUsdAmount(balance.pending)}`}
        />
        <div
          className={styles.barAvailable}
          style={{ width: `${minWidth(pct.available)}%` }}
          title={
            status === 'voided'
              ? `Reclaimed: ${formatUsdAmount(balance.reclaimed || '0')}`
              : `Available: ${formatUsdAmount(balance.available)}`
          }
        />
      </div>

      <div className={styles.balanceDetails}>
        <div className={styles.balanceRow}>
          <span className={styles.legendDot} style={{ background: 'var(--stone)' }} />
          <span className={styles.balanceLabel}>{settledLabel}</span>
          <span className={styles.balanceValue}>{formatUsdAmount(balance.captured)}</span>
        </div>
        <div className={styles.balanceRow}>
          <span className={styles.legendDot} style={{ background: 'var(--warning)' }} />
          <span className={styles.balanceLabel}>Pending</span>
          <span className={styles.balanceValue}>{formatUsdAmount(balance.pending)}</span>
        </div>
        {status === 'voided' ? (
          <div className={styles.balanceRow}>
            <span className={styles.legendDot} style={{ background: 'var(--success)' }} />
            <span className={styles.balanceLabel}>Reclaimed</span>
            <span className={styles.balanceValue}>{formatUsdAmount(balance.reclaimed || '0')}</span>
          </div>
        ) : (
          <div className={styles.balanceRow}>
            <span className={styles.legendDot} style={{ background: 'var(--success)' }} />
            <span className={styles.balanceLabel}>
              {viewMode === 'operator' ? 'Available' : 'Available to Reclaim'}
            </span>
            <span className={styles.balanceValue}>{formatUsdAmount(balance.available)}</span>
          </div>
        )}
        <div className={`${styles.balanceRow} ${styles.balanceTotal}`}>
          <span className={styles.balanceLabel}>
            {viewMode === 'operator' ? 'Authorized' : 'Total Deposited'}
          </span>
          <span className={styles.balanceValue}>{formatUsdAmount(balance.authorized)}</span>
        </div>
      </div>
    </div>
  );
}
