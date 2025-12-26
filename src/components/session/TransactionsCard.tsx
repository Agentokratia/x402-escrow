'use client';

import { ExternalLink } from 'lucide-react';
import type { SessionData } from './types';
import styles from './session.module.css';

interface TransactionsCardProps {
  session: SessionData;
}

export function TransactionsCard({ session }: TransactionsCardProps) {
  const formatTxHash = (hash: string) => `${hash.slice(0, 10)}...${hash.slice(-8)}`;

  const getExplorerUrl = (txHash: string) => {
    if (!session.blockExplorerUrl) return null;
    return `${session.blockExplorerUrl}/tx/${txHash}`;
  };

  // Support both old format (authorizeTxHash/voidTxHash) and new format (transactions object)
  const authorizeTx = session.transactions?.authorize || session.authorizeTxHash;
  const voidTx = session.transactions?.void || session.voidTxHash;
  const captureTxs = session.transactions?.captures || [];

  const hasTx = authorizeTx || voidTx || captureTxs.length > 0;

  if (!session.blockExplorerUrl || !hasTx) {
    return null;
  }

  return (
    <div className={styles.card}>
      <h3>Blockchain Transactions</h3>
      <div className={styles.detailsList}>
        {authorizeTx && (
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>Authorize</span>
            <a
              href={getExplorerUrl(authorizeTx)!}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.txLink}
            >
              <code>{formatTxHash(authorizeTx)}</code>
              <ExternalLink size={14} />
            </a>
          </div>
        )}

        {captureTxs.length > 0 && (
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>
              Settled{captureTxs.length > 1 ? ` (${captureTxs.length})` : ''}
            </span>
            <div className={styles.txList}>
              {captureTxs.map((txHash, idx) => (
                <a
                  key={idx}
                  href={getExplorerUrl(txHash)!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.txLink}
                >
                  <code>{formatTxHash(txHash)}</code>
                  <ExternalLink size={14} />
                </a>
              ))}
            </div>
          </div>
        )}

        {voidTx && (
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>Reclaimed</span>
            <a
              href={getExplorerUrl(voidTx)!}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.txLink}
            >
              <code>{formatTxHash(voidTx)}</code>
              <ExternalLink size={14} />
            </a>
          </div>
        )}

        {!authorizeTx && captureTxs.length === 0 && !voidTx && (
          <p className={styles.noTxNote}>No blockchain transactions recorded yet.</p>
        )}
      </div>
    </div>
  );
}
