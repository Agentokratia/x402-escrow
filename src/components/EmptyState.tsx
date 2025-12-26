'use client';

import { LucideIcon, Inbox, Zap, CreditCard, FileText } from 'lucide-react';
import Link from 'next/link';
import styles from './EmptyState.module.css';

type EmptyStateVariant = 'sessions' | 'usage' | 'payments' | 'generic';

interface EmptyStateProps {
  variant?: EmptyStateVariant;
  icon?: LucideIcon;
  title?: string;
  description?: string;
  action?: {
    label: string;
    href: string;
  };
}

const variants: Record<
  EmptyStateVariant,
  { icon: LucideIcon; defaultTitle: string; defaultDescription: string }
> = {
  sessions: {
    icon: Inbox,
    defaultTitle: 'No sessions yet',
    defaultDescription: 'Sessions will appear here when users authorize payments to your service',
  },
  usage: {
    icon: Zap,
    defaultTitle: 'No usage recorded',
    defaultDescription: 'Usage will appear here as the service charges your balance',
  },
  payments: {
    icon: CreditCard,
    defaultTitle: 'No payment activity',
    defaultDescription: 'When you use AI services with x402 escrow, your deposits will appear here',
  },
  generic: {
    icon: FileText,
    defaultTitle: 'Nothing here yet',
    defaultDescription: 'Content will appear here once available',
  },
};

export function EmptyState({
  variant = 'generic',
  icon: CustomIcon,
  title,
  description,
  action,
}: EmptyStateProps) {
  const config = variants[variant];
  const Icon = CustomIcon || config.icon;

  return (
    <div className={styles.container}>
      <div className={styles.iconWrapper}>
        <Icon size={32} />
      </div>
      <h3 className={styles.title}>{title || config.defaultTitle}</h3>
      <p className={styles.description}>{description || config.defaultDescription}</p>
      {action && (
        <Link href={action.href} className={styles.action}>
          {action.label}
        </Link>
      )}
    </div>
  );
}
