// Shared session types for both operator and payer views

export interface SessionBalance {
  authorized: string;
  captured: string; // "settled" on-chain
  pending: string;
  available: string;
  reclaimed?: string; // only for voided sessions
}

export interface SessionTransactions {
  authorize: string | null;
  captures: string[]; // settled tx hashes
  void: string | null;
}

export interface SessionDebit {
  id: string;
  amount: string;
  requestId: string;
  description: string | null;
  createdAt: string;
}

export interface SessionData {
  id: string;
  networkId: string;
  networkName: string;
  payer: string;
  receiver: string;
  operator?: string;
  balance: SessionBalance;
  status: string;
  authorizationExpiry: string | number;
  refundExpiry?: string | number;
  createdAt: string;
  blockExplorerUrl: string | null;
  authorizeTxHash?: string | null;
  voidTxHash?: string | null;
  transactions?: SessionTransactions;
  debits?: SessionDebit[];
}

export type ViewMode = 'operator' | 'payer';
