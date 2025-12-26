'use client';

import Link from 'next/link';
import { Eye } from 'lucide-react';
import { formatUsdAmount, formatAddress, getStatusLabel, getStatusClassName } from '@/lib/format';
import { TableRowSkeleton } from '@/components/Skeleton';
import type { Session, FilterStatus } from '@/lib/hooks/useQueries';
import styles from './SessionTable.module.css';

interface SessionTableProps {
  sessions: Session[];
  isLoading: boolean;
  variant: 'operator' | 'payer';
  basePath: string;
  emptyTitle?: string;
  emptyDescription?: string;
}

export function SessionTable({
  sessions,
  isLoading,
  variant,
  basePath,
  emptyTitle = 'No sessions found',
  emptyDescription = 'Sessions will appear here when available.',
}: SessionTableProps) {
  const headers =
    variant === 'operator'
      ? ['Session ID', 'Authorized', 'Settled', 'Available', 'Status', 'Actions']
      : ['Session ID', 'Deposited', 'Spent', 'Available', 'Status', 'Actions'];

  if (isLoading) {
    return (
      <div className={styles.tableWrapper}>
        <div className={styles.table}>
          <div className={styles.tableHeader}>
            {headers.map((header) => (
              <span key={header}>{header}</span>
            ))}
          </div>
          {[...Array(5)].map((_, i) => (
            <TableRowSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className={styles.empty}>
        <h3>{emptyTitle}</h3>
        <p>{emptyDescription}</p>
      </div>
    );
  }

  return (
    <div className={styles.tableWrapper}>
      <div className={styles.table}>
        <div className={styles.tableHeader}>
          {headers.map((header) => (
            <span key={header}>{header}</span>
          ))}
        </div>
        {sessions.map((session) => (
          <div key={session.id} className={styles.row}>
            <div className={styles.sessionId}>
              {formatAddress(session.id)}
              <span>
                {variant === 'operator'
                  ? formatAddress(session.payer)
                  : `To: ${formatAddress(session.receiver)}`}
              </span>
            </div>
            <span className={styles.amount}>{formatUsdAmount(session.balance.authorized)}</span>
            <span className={styles.amount}>{formatUsdAmount(session.balance.captured)}</span>
            <span className={styles.amount}>{formatUsdAmount(session.balance.available)}</span>
            <span className={`${styles.status} ${getStatusClassName(session.status, styles)}`}>
              {getStatusLabel(session.status)}
            </span>
            <div className={styles.actions}>
              <Link
                href={`${basePath}/${session.id}`}
                className={styles.actionBtn}
                title="View details"
              >
                <Eye size={14} />
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface FilterButtonsProps {
  filter: FilterStatus;
  onFilterChange: (filter: FilterStatus) => void;
}

export function SessionFilterButtons({ filter, onFilterChange }: FilterButtonsProps) {
  const filters = ['all', 'active', 'captured', 'voided', 'expired'] as const;

  return (
    <div className={styles.filters}>
      {filters.map((status) => (
        <button
          key={status}
          className={`${styles.filterBtn} ${filter === status ? styles.filterBtnActive : ''}`}
          onClick={() => onFilterChange(status)}
        >
          {status === 'voided'
            ? 'Reclaimed'
            : status === 'captured'
              ? 'Settled'
              : status.charAt(0).toUpperCase() + status.slice(1)}
        </button>
      ))}
    </div>
  );
}
