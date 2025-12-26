'use client';

import { CheckCircle2, Loader2, XCircle, ExternalLink } from 'lucide-react';
import styles from './TransactionStatus.module.css';

type Status = 'pending' | 'confirming' | 'success' | 'error';

interface TransactionStatusProps {
  status: Status;
  message: string;
  txHash?: string;
  networkId?: string;
  onClose?: () => void;
}

function getExplorerUrl(txHash: string, networkId?: string): string {
  // Default to Base mainnet, use Sepolia for testnet
  if (networkId === 'base-sepolia' || networkId === 'sepolia') {
    return `https://sepolia.basescan.org/tx/${txHash}`;
  }
  return `https://basescan.org/tx/${txHash}`;
}

export function TransactionStatus({
  status,
  message,
  txHash,
  networkId,
  onClose,
}: TransactionStatusProps) {
  const getIcon = () => {
    switch (status) {
      case 'pending':
      case 'confirming':
        return <Loader2 size={20} className={styles.spinner} />;
      case 'success':
        return <CheckCircle2 size={20} />;
      case 'error':
        return <XCircle size={20} />;
    }
  };

  return (
    <div className={`${styles.container} ${styles[status]}`} role="status" aria-live="polite">
      <div className={styles.icon}>{getIcon()}</div>
      <div className={styles.content}>
        <p className={styles.message}>{message}</p>
        {txHash && (
          <a
            href={getExplorerUrl(txHash, networkId)}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.txLink}
          >
            View transaction
            <ExternalLink size={12} />
          </a>
        )}
      </div>
      {(status === 'success' || status === 'error') && onClose && (
        <button onClick={onClose} className={styles.closeBtn} aria-label="Dismiss notification">
          Dismiss
        </button>
      )}
    </div>
  );
}
