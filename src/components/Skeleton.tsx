'use client';

import styles from './Skeleton.module.css';

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  variant?: 'text' | 'circular' | 'rectangular';
  className?: string;
}

export function Skeleton({
  width = '100%',
  height = 20,
  variant = 'text',
  className = '',
}: SkeletonProps) {
  return (
    <div
      className={`${styles.skeleton} ${styles[variant]} ${className}`}
      style={{
        width: typeof width === 'number' ? `${width}px` : width,
        height: typeof height === 'number' ? `${height}px` : height,
      }}
    />
  );
}

export function StatCardSkeleton() {
  return (
    <div className={styles.statCard}>
      <Skeleton width={80} height={32} />
      <Skeleton width={100} height={16} />
    </div>
  );
}

export function SessionCardSkeleton() {
  return (
    <div className={styles.sessionCard}>
      <div className={styles.sessionCardHeader}>
        <Skeleton width={120} height={20} />
        <Skeleton width={60} height={24} variant="rectangular" />
      </div>
      <Skeleton width="100%" height={8} variant="rectangular" />
      <div className={styles.sessionCardFooter}>
        <Skeleton width={80} height={16} />
        <Skeleton width={80} height={16} />
      </div>
    </div>
  );
}

export function TableRowSkeleton() {
  return (
    <div className={styles.tableRow}>
      <Skeleton width={100} height={16} />
      <Skeleton width={80} height={16} />
      <Skeleton width={80} height={16} />
      <Skeleton width={60} height={24} variant="rectangular" />
    </div>
  );
}
