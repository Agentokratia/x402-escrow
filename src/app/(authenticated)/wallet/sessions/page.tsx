'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { usePayerSessions, type FilterStatus } from '@/lib/hooks/useQueries';
import { SessionTable, SessionFilterButtons } from '@/components/SessionTable';
import styles from './page.module.css';

export default function WalletSessionsPage() {
  const searchParams = useSearchParams();
  const initialFilter = (searchParams.get('status') as FilterStatus) || 'all';

  const [filter, setFilter] = useState<FilterStatus>(initialFilter);

  // React Query hooks
  const { data: sessions = [], isLoading, error: sessionsError } = usePayerSessions(filter);

  // NOTE: Reclaim All button temporarily disabled
  // Batch reclaim requires forwarder contract - see plan in compiled-launching-tulip.md
  // Individual session reclaim still works via /wallet/sessions/[id]

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerContent}>
          <h1>My Sessions</h1>
          <p className={styles.headerSubtitle}>Track your deposits and spending across services</p>
        </div>
        <div className={styles.headerActions}>
          <SessionFilterButtons filter={filter} onFilterChange={setFilter} />
        </div>
      </header>

      {sessionsError && (
        <div className={styles.error}>
          {sessionsError instanceof Error ? sessionsError.message : 'Failed to load sessions'}
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
