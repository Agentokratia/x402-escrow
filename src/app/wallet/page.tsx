'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Shield, RefreshCw, Code } from 'lucide-react';
import { fetchWithAuth } from '@/lib/store/authStore';
import { StatCardSkeleton, Skeleton } from '@/components/Skeleton';
import { formatUsdAmount } from '@/lib/format';
import styles from './page.module.css';

interface PayerStats {
  totalAuthorized: string;
  totalCaptured: string;
  totalPending: string;
  totalAvailable: string;
  activeSessions: number;
  totalSessions: number;
}

export default function WalletPage() {
  const [stats, setStats] = useState<PayerStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        setError(null);
        const response = await fetchWithAuth('/api/payer/stats');
        if (!response.ok) {
          throw new Error('Failed to load stats');
        }
        const data = await response.json();
        setStats(data);
      } catch (err) {
        console.error('Failed to fetch stats:', err);
        setError(err instanceof Error ? err.message : 'Failed to load stats');
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, []);

  const hasActivity = stats && (parseFloat(stats.totalAuthorized) > 0 || stats.totalSessions > 0);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Your Escrow Funds</h1>
        <p className={styles.intro}>
          When you use AI services, your payment goes into a secure escrow. You only pay for what
          you use. Unused funds can always be reclaimed.
        </p>
      </header>

      {error && <div className={styles.error}>{error}</div>}

      {!loading && !hasActivity ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>
            <Shield size={32} />
          </div>
          <h2>Ready to use AI services safely</h2>
          <p>
            When you pay an AI service with x402 escrow, your funds will appear here. Track your
            spending and reclaim unused funds anytime.
          </p>
        </div>
      ) : (
        <>
          {/* Prominent Reclaim CTA when funds are available */}
          {stats && parseFloat(stats.totalAvailable) > 0 && (
            <div className={styles.reclaimCta}>
              <div className={styles.reclaimCtaContent}>
                <div className={styles.reclaimCtaIcon}>
                  <RefreshCw size={24} />
                </div>
                <div className={styles.reclaimCtaText}>
                  <h3>You have {formatUsdAmount(stats.totalAvailable)} available to reclaim</h3>
                  <p>Unused funds can be returned to your wallet anytime</p>
                </div>
              </div>
              <Link href="/wallet/sessions?status=active" className={styles.reclaimCtaBtn}>
                Review & Reclaim
                <ArrowRight size={16} />
              </Link>
            </div>
          )}

          {loading ? (
            <>
              <div className={styles.balanceCard}>
                <div className={styles.balanceMain}>
                  <Skeleton width={120} height={16} />
                  <Skeleton width={100} height={36} />
                  <Skeleton width={200} height={14} />
                </div>
              </div>
              <div className={styles.stats}>
                <StatCardSkeleton />
                <StatCardSkeleton />
                <StatCardSkeleton />
              </div>
            </>
          ) : (
            <>
              <div className={styles.balanceCard}>
                <div className={styles.balanceMain}>
                  <span className={styles.balanceLabel}>Available to reclaim</span>
                  <span className={styles.balanceValue}>
                    {formatUsdAmount(stats?.totalAvailable || '0')}
                  </span>
                  <p className={styles.balanceHint}>
                    This is your unused balance across all sessions
                  </p>
                </div>
                {stats && parseFloat(stats.totalAvailable) > 0 && (
                  <Link href="/wallet/sessions?status=active" className={styles.reclaimBtn}>
                    <RefreshCw size={16} />
                    Reclaim Funds
                  </Link>
                )}
              </div>

              <div className={styles.stats}>
                <div className={styles.stat}>
                  <span className={styles.statValue}>
                    {formatUsdAmount(stats?.totalAuthorized || '0')}
                  </span>
                  <span className={styles.statLabel}>Total deposited</span>
                </div>
                <div className={styles.stat}>
                  <span className={styles.statValue}>
                    {formatUsdAmount(stats?.totalCaptured || '0')}
                  </span>
                  <span className={styles.statLabel}>Actually spent</span>
                </div>
                <div className={styles.stat}>
                  <span className={styles.statValue}>{stats?.activeSessions || 0}</span>
                  <span className={styles.statLabel}>Active sessions</span>
                </div>
              </div>
            </>
          )}

          <section className={styles.section}>
            <Link href="/wallet/sessions" className={styles.actionCard}>
              <div>
                <h4>View all sessions</h4>
                <p>See detailed breakdown of each escrow session</p>
              </div>
              <ArrowRight size={20} />
            </Link>
          </section>
        </>
      )}

      {/* Client Integration Guide */}
      <section className={styles.integrationGuide}>
        <div className={styles.guideHeader}>
          <Code size={20} />
          <h3>Client Integration Guide</h3>
        </div>

        {/* How Escrow Protects You */}
        <div className={styles.guideSection}>
          <h4>How Escrow Protects You</h4>
          <div className={styles.benefitsRow}>
            <div className={styles.benefitCard}>
              <span className={styles.benefitNum}>1</span>
              <strong>Deposit once</strong>
              <p>Authorize a budget with a single signature</p>
            </div>
            <div className={styles.benefitCard}>
              <span className={styles.benefitNum}>2</span>
              <strong>Pay per use</strong>
              <p>Each API call charges from your deposit</p>
            </div>
            <div className={styles.benefitCard}>
              <span className={styles.benefitNum}>3</span>
              <strong>Reclaim anytime</strong>
              <p>Get unused funds back whenever you want</p>
            </div>
          </div>
        </div>

        {/* Client Integration */}
        <div className={styles.guideSection}>
          <h4>Client Integration</h4>
          <p className={styles.guideNote}>Simple 2-line API - sessions handled automatically</p>
          <div className={styles.codeBlock}>
            <pre>{`import { createEscrowFetch } from '@x402/escrow/client';

// walletClient from wagmi or viem
const { fetch: escrowFetch, scheme } = createEscrowFetch(walletClient);

// Make paid requests - sessions handled automatically
const response = await escrowFetch('https://api.example.com/premium');

// Access sessions
scheme.sessions.getAll();
scheme.sessions.clear();`}</pre>
          </div>
        </div>
      </section>
    </div>
  );
}
