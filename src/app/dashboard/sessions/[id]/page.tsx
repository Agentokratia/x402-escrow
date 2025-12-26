'use client';

import { use } from 'react';
import Link from 'next/link';
import { ArrowLeft, AlertCircle } from 'lucide-react';
import { useOperatorSessionDetail } from '@/lib/hooks/useQueries';
import { getStatusLabel, getStatusClassName } from '@/lib/format';
import {
  SessionBalanceCard,
  SessionInfoCard,
  TransactionsCard,
  UsageHistoryCard,
} from '@/components/session';
import styles from './page.module.css';

export default function SessionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = use(params);
  const { data: session, isLoading, error } = useOperatorSessionDetail(sessionId);

  if (isLoading) {
    return (
      <div className={styles.page}>
        <div className={styles.loading}>Loading session...</div>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className={styles.page}>
        <div className={styles.error}>
          <AlertCircle size={24} />
          <p>{error instanceof Error ? error.message : 'Session not found'}</p>
          <Link href="/dashboard/sessions" className={styles.backLink}>
            Back to sessions
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/dashboard/sessions" className={styles.backBtn}>
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

      <div className={styles.grid}>
        <SessionBalanceCard balance={session.balance} status={session.status} viewMode="operator" />
        <SessionInfoCard session={session} viewMode="operator" />
      </div>

      <TransactionsCard session={session} />

      {session.debits && <UsageHistoryCard debits={session.debits} />}
    </div>
  );
}
