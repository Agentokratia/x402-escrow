'use client';

import Link from 'next/link';
import {
  Key,
  Wallet,
  ArrowRight,
  Shield,
  CheckCircle2,
  Circle,
  Zap,
  RefreshCw,
  TrendingUp,
  Activity,
  DollarSign,
  Clock,
  Users,
} from 'lucide-react';
import { StatCardSkeleton } from '@/components/Skeleton';
import { formatUsdAmount, formatAddress, formatTimeAgo, getStatusLabel } from '@/lib/format';
import { useDashboardStats } from '@/lib/hooks/useQueries';
import styles from './page.module.css';

type OnboardingStep = 'create-key' | 'integrate' | 'first-payment';

export default function DashboardPage() {
  const { operatorStats, payerStats, isLoading: loading } = useDashboardStats();

  // Determine onboarding progress
  const hasApiKey = operatorStats && operatorStats.apiKeys > 0;
  const hasIncomingPayments =
    operatorStats &&
    (operatorStats.activeSessions > 0 || parseFloat(operatorStats.totalCaptured) > 0);
  const hasPayerActivity =
    payerStats && (payerStats.activeSessions > 0 || parseFloat(payerStats.totalAvailable) > 0);

  // Determine current step
  const getCurrentStep = (): OnboardingStep => {
    if (!hasApiKey) return 'create-key';
    if (!hasIncomingPayments) return 'integrate';
    return 'first-payment';
  };

  const currentStep = getCurrentStep();
  const isNewUser = !hasApiKey && !hasIncomingPayments && !hasPayerActivity;

  // Calculate percentages for donut chart
  const getStatusPercentages = () => {
    if (!operatorStats?.statusDistribution) return null;
    const total = operatorStats.totalSessions;
    if (total === 0) return null;

    const { active, captured, voided, expired } = operatorStats.statusDistribution;
    return {
      active: (active / total) * 100,
      captured: (captured / total) * 100,
      voided: (voided / total) * 100,
      expired: (expired / total) * 100,
    };
  };

  const statusPercentages = getStatusPercentages();

  return (
    <div className={styles.page}>
      {/* Welcome Header */}
      <header className={styles.header}>
        <div className={styles.headerContent}>
          <h1>{isNewUser ? 'Welcome to x402 Escrow' : 'Dashboard'}</h1>
          <p className={styles.intro}>
            {isNewUser
              ? 'Secure, on-chain payments for AI services. Get started in minutes.'
              : 'Real-time payment observability and metrics'}
          </p>
        </div>
      </header>

      {/* New User: Getting Started Journey */}
      {isNewUser && (
        <section className={styles.onboarding}>
          <div className={styles.journeyHeader}>
            <h2>Get started accepting payments</h2>
            <p>Follow these steps to start receiving escrow payments from your users</p>
          </div>

          <div className={styles.journey}>
            {/* Step 1: Create API Key */}
            <div
              className={`${styles.step} ${currentStep === 'create-key' ? styles.stepActive : ''}`}
            >
              <div className={styles.stepIndicator}>
                {hasApiKey ? (
                  <CheckCircle2 size={24} className={styles.stepComplete} />
                ) : (
                  <div className={styles.stepNumber}>1</div>
                )}
              </div>
              <div className={styles.stepContent}>
                <h3>Secure your integration</h3>
                <p>
                  Your API key authenticates requests and ensures only you can capture payments.
                  Takes 30 seconds.
                </p>
                {currentStep === 'create-key' && (
                  <Link href="/dashboard/api-keys" className={styles.stepAction}>
                    <Key size={16} />
                    Create API Key
                    <ArrowRight size={16} />
                  </Link>
                )}
              </div>
            </div>

            {/* Step 2: Integrate */}
            <div
              className={`${styles.step} ${currentStep === 'integrate' ? styles.stepActive : ''} ${!hasApiKey ? styles.stepLocked : ''}`}
            >
              <div className={styles.stepIndicator}>
                {hasIncomingPayments ? (
                  <CheckCircle2 size={24} className={styles.stepComplete} />
                ) : hasApiKey ? (
                  <div className={styles.stepNumber}>2</div>
                ) : (
                  <Circle size={24} className={styles.stepPending} />
                )}
              </div>
              <div className={styles.stepContent}>
                <h3>Add escrow to your API</h3>
                <p>
                  One API call validates payments before processing requests. We handle all the
                  blockchain complexity.
                </p>
                {currentStep === 'integrate' && (
                  <div className={styles.codePreview}>
                    <code>
                      POST /api/session/{'{'}
                      <span className={styles.codeHighlight}>id</span>
                      {'}'}/use
                    </code>
                    <Link href="/dashboard/api-keys" className={styles.docsLink}>
                      Get your API key first
                      <ArrowRight size={14} />
                    </Link>
                  </div>
                )}
              </div>
            </div>

            {/* Step 3: First Payment */}
            <div className={`${styles.step} ${!hasApiKey ? styles.stepLocked : ''}`}>
              <div className={styles.stepIndicator}>
                {hasIncomingPayments ? (
                  <CheckCircle2 size={24} className={styles.stepComplete} />
                ) : (
                  <Circle size={24} className={styles.stepPending} />
                )}
              </div>
              <div className={styles.stepContent}>
                <h3>Start earning</h3>
                <p>
                  When users pay your service, funds are held safely in escrow. You capture what you
                  earn, they keep the rest.
                </p>
              </div>
            </div>
          </div>

          {/* How it works summary */}
          <div className={styles.howItWorks}>
            <div className={styles.howItem}>
              <Shield size={20} />
              <div>
                <strong>Secure escrow</strong>
                <span>Funds held on-chain until earned</span>
              </div>
            </div>
            <div className={styles.howItem}>
              <Zap size={20} />
              <div>
                <strong>Pay-per-call</strong>
                <span>Charge micro-amounts per API request</span>
              </div>
            </div>
            <div className={styles.howItem}>
              <RefreshCw size={20} />
              <div>
                <strong>Auto-refund</strong>
                <span>Unused funds return to users</span>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Returning User: Dashboard Overview */}
      {!isNewUser && (
        <div className={styles.dashboard}>
          {/* Operator Section */}
          {(hasApiKey || hasIncomingPayments) && (
            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <Key size={20} />
                <h2>Incoming Payments</h2>
              </div>

              {/* Show encouraging message for operators with no activity yet */}
              {!hasIncomingPayments ? (
                <div className={styles.awaitingPayments}>
                  <div className={styles.awaitingIcon}>
                    <Zap size={24} />
                  </div>
                  <div className={styles.awaitingContent}>
                    <h3>Ready to receive payments</h3>
                    <p>
                      Your API key is set up. Stats will appear here once users start authorizing
                      payments to your service.
                    </p>
                    <Link href="/dashboard/api-keys" className={styles.awaitingLink}>
                      View integration guide
                      <ArrowRight size={14} />
                    </Link>
                  </div>
                </div>
              ) : (
                <>
                  {/* Enhanced Stat Cards with Icons */}
                  {loading ? (
                    <div className={styles.statsGrid}>
                      <StatCardSkeleton />
                      <StatCardSkeleton />
                      <StatCardSkeleton />
                      <StatCardSkeleton />
                    </div>
                  ) : (
                    <div className={styles.statsGrid}>
                      <div className={styles.statCard}>
                        <div className={styles.statIcon}>
                          <DollarSign size={20} />
                        </div>
                        <div className={styles.statContent}>
                          <span className={styles.statLabel}>Total Earned</span>
                          <span className={styles.statValue}>
                            {formatUsdAmount(operatorStats?.totalCaptured || '0')}
                          </span>
                          <span className={styles.statHint}>Settled to your wallet</span>
                        </div>
                      </div>
                      <div className={styles.statCard}>
                        <div className={`${styles.statIcon} ${styles.iconWarning}`}>
                          <Clock size={20} />
                        </div>
                        <div className={styles.statContent}>
                          <span className={styles.statLabel}>Pending</span>
                          <span className={styles.statValue}>
                            {formatUsdAmount(operatorStats?.pendingAmount || '0')}
                          </span>
                          <span className={styles.statHint}>Awaiting settlement</span>
                        </div>
                      </div>
                      <div className={styles.statCard}>
                        <div className={`${styles.statIcon} ${styles.iconInfo}`}>
                          <Activity size={20} />
                        </div>
                        <div className={styles.statContent}>
                          <span className={styles.statLabel}>Active Sessions</span>
                          <span className={styles.statValue}>
                            {operatorStats?.activeSessions || 0}
                          </span>
                          <span className={styles.statHint}>Open payment budgets</span>
                        </div>
                      </div>
                      <div className={styles.statCard}>
                        <div className={`${styles.statIcon} ${styles.iconNeutral}`}>
                          <Users size={20} />
                        </div>
                        <div className={styles.statContent}>
                          <span className={styles.statLabel}>Total Sessions</span>
                          <span className={styles.statValue}>
                            {operatorStats?.totalSessions || 0}
                          </span>
                          <span className={styles.statHint}>All time</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Charts Row */}
                  <div className={styles.chartsRow}>
                    {/* Status Distribution */}
                    <div className={styles.chartCard}>
                      <h3>Status Distribution</h3>
                      {statusPercentages ? (
                        <div className={styles.donutContainer}>
                          <svg className={styles.donutChart} viewBox="0 0 42 42">
                            <circle
                              className={styles.donutRing}
                              cx="21"
                              cy="21"
                              r="15.91549430918954"
                              fill="transparent"
                              stroke="var(--cloud)"
                              strokeWidth="3"
                            />
                            {/* Active segment */}
                            <circle
                              className={styles.donutSegment}
                              cx="21"
                              cy="21"
                              r="15.91549430918954"
                              fill="transparent"
                              stroke="var(--info)"
                              strokeWidth="3"
                              strokeDasharray={`${statusPercentages.active} ${100 - statusPercentages.active}`}
                              strokeDashoffset="25"
                            />
                            {/* Captured/Settled segment */}
                            <circle
                              className={styles.donutSegment}
                              cx="21"
                              cy="21"
                              r="15.91549430918954"
                              fill="transparent"
                              stroke="var(--success)"
                              strokeWidth="3"
                              strokeDasharray={`${statusPercentages.captured} ${100 - statusPercentages.captured}`}
                              strokeDashoffset={`${25 - statusPercentages.active}`}
                            />
                            {/* Voided/Reclaimed segment */}
                            <circle
                              className={styles.donutSegment}
                              cx="21"
                              cy="21"
                              r="15.91549430918954"
                              fill="transparent"
                              stroke="var(--stone)"
                              strokeWidth="3"
                              strokeDasharray={`${statusPercentages.voided} ${100 - statusPercentages.voided}`}
                              strokeDashoffset={`${25 - statusPercentages.active - statusPercentages.captured}`}
                            />
                            {/* Expired segment */}
                            <circle
                              className={styles.donutSegment}
                              cx="21"
                              cy="21"
                              r="15.91549430918954"
                              fill="transparent"
                              stroke="var(--warning)"
                              strokeWidth="3"
                              strokeDasharray={`${statusPercentages.expired} ${100 - statusPercentages.expired}`}
                              strokeDashoffset={`${25 - statusPercentages.active - statusPercentages.captured - statusPercentages.voided}`}
                            />
                          </svg>
                          <div className={styles.donutLegend}>
                            <div className={styles.legendItem}>
                              <span
                                className={styles.legendDot}
                                style={{ background: 'var(--info)' }}
                              />
                              <span>Active</span>
                              <span className={styles.legendValue}>
                                {operatorStats?.statusDistribution.active || 0}
                              </span>
                            </div>
                            <div className={styles.legendItem}>
                              <span
                                className={styles.legendDot}
                                style={{ background: 'var(--success)' }}
                              />
                              <span>Settled</span>
                              <span className={styles.legendValue}>
                                {operatorStats?.statusDistribution.captured || 0}
                              </span>
                            </div>
                            <div className={styles.legendItem}>
                              <span
                                className={styles.legendDot}
                                style={{ background: 'var(--stone)' }}
                              />
                              <span>Reclaimed</span>
                              <span className={styles.legendValue}>
                                {operatorStats?.statusDistribution.voided || 0}
                              </span>
                            </div>
                            <div className={styles.legendItem}>
                              <span
                                className={styles.legendDot}
                                style={{ background: 'var(--warning)' }}
                              />
                              <span>Expired</span>
                              <span className={styles.legendValue}>
                                {operatorStats?.statusDistribution.expired || 0}
                              </span>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className={styles.emptyChart}>
                          <p>No sessions yet</p>
                        </div>
                      )}
                    </div>

                    {/* Recent Sessions */}
                    <div className={styles.chartCard}>
                      <h3>Recent Sessions</h3>
                      {operatorStats?.recentSessions && operatorStats.recentSessions.length > 0 ? (
                        <div className={styles.recentList}>
                          {operatorStats.recentSessions.map((session) => (
                            <div key={session.id} className={styles.recentItem}>
                              <div className={styles.recentInfo}>
                                <span className={styles.recentPayer}>
                                  {formatAddress(session.payer)}
                                </span>
                                <span className={styles.recentTime}>
                                  {formatTimeAgo(session.createdAt)}
                                </span>
                              </div>
                              <div className={styles.recentMeta}>
                                <span className={styles.recentAmount}>
                                  {formatUsdAmount(session.amount)}
                                </span>
                                <span
                                  className={`${styles.recentStatus} ${styles[`status${session.status.charAt(0).toUpperCase() + session.status.slice(1)}`]}`}
                                >
                                  {getStatusLabel(session.status)}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className={styles.emptyChart}>
                          <p>No recent activity</p>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className={styles.sectionActions}>
                    <Link href="/dashboard/api-keys" className={styles.actionLink}>
                      Manage API Keys
                      <ArrowRight size={16} />
                    </Link>
                    <Link href="/dashboard/sessions" className={styles.actionLink}>
                      View All Sessions
                      <ArrowRight size={16} />
                    </Link>
                  </div>
                </>
              )}
            </section>
          )}

          {/* Payer Section */}
          {hasPayerActivity && (
            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <Wallet size={20} />
                <h2>Your Spending</h2>
              </div>

              {loading ? (
                <div className={styles.statsGrid}>
                  <StatCardSkeleton />
                  <StatCardSkeleton />
                  <StatCardSkeleton />
                </div>
              ) : (
                <div className={styles.statsGrid}>
                  <div className={styles.statCard}>
                    <div className={`${styles.statIcon} ${styles.iconSuccess}`}>
                      <TrendingUp size={20} />
                    </div>
                    <div className={styles.statContent}>
                      <span className={styles.statLabel}>Available to Reclaim</span>
                      <span className={styles.statValue}>
                        {formatUsdAmount(payerStats?.totalAvailable || '0')}
                      </span>
                      <span className={styles.statHint}>Unused funds</span>
                    </div>
                  </div>
                  <div className={styles.statCard}>
                    <div className={styles.statIcon}>
                      <DollarSign size={20} />
                    </div>
                    <div className={styles.statContent}>
                      <span className={styles.statLabel}>Total Deposited</span>
                      <span className={styles.statValue}>
                        {formatUsdAmount(payerStats?.totalAuthorized || '0')}
                      </span>
                      <span className={styles.statHint}>Across all services</span>
                    </div>
                  </div>
                  <div className={styles.statCard}>
                    <div className={`${styles.statIcon} ${styles.iconInfo}`}>
                      <Activity size={20} />
                    </div>
                    <div className={styles.statContent}>
                      <span className={styles.statLabel}>Active Sessions</span>
                      <span className={styles.statValue}>{payerStats?.activeSessions || 0}</span>
                      <span className={styles.statHint}>Open budgets</span>
                    </div>
                  </div>
                </div>
              )}

              <div className={styles.sectionActions}>
                <Link href="/wallet" className={styles.actionLink}>
                  View All Funds
                  <ArrowRight size={16} />
                </Link>
                <Link href="/wallet/sessions" className={styles.actionLink}>
                  View Sessions
                  <ArrowRight size={16} />
                </Link>
              </div>
            </section>
          )}

          {/* Quick Actions for returning users without payer activity */}
          {hasApiKey && !hasPayerActivity && (
            <section className={styles.infoSection}>
              <div className={styles.infoCard}>
                <Wallet size={24} />
                <div>
                  <h3>Track your spending</h3>
                  <p>When you use AI services with x402 escrow, your deposits will appear here.</p>
                </div>
                <Link href="/wallet" className={styles.infoLink}>
                  Learn more
                  <ArrowRight size={16} />
                </Link>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
