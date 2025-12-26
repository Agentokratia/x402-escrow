'use client';

import { useState } from 'react';
import { useOperatorSessions, type FilterStatus } from '@/lib/hooks/useQueries';
import { SessionTable, SessionFilterButtons } from '@/components/SessionTable';
import styles from './page.module.css';

export default function SessionsPage() {
  const [filter, setFilter] = useState<FilterStatus>('all');
  const { data: sessions = [], isLoading, error } = useOperatorSessions(filter);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerContent}>
          <h1>Incoming Sessions</h1>
          <p className={styles.headerSubtitle}>Track payments from users of your services</p>
        </div>
        <SessionFilterButtons filter={filter} onFilterChange={setFilter} />
      </header>

      {error && (
        <div className={styles.error}>
          {error instanceof Error ? error.message : 'Failed to load sessions'}
        </div>
      )}

      <SessionTable
        sessions={sessions}
        isLoading={isLoading}
        variant="operator"
        basePath="/dashboard/sessions"
        emptyTitle="Waiting for your first payment"
        emptyDescription="When users authorize payments to your service, their sessions will appear here automatically."
      />
    </div>
  );
}
