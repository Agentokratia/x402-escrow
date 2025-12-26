/**
 * Format USDC amount (6 decimals) as USD string.
 * Always uses 6 decimal precision then trims trailing zeros.
 */
export function formatUsdAmount(amount: string | number | bigint): string {
  const value = typeof amount === 'string' ? parseFloat(amount) / 1e6 : Number(amount) / 1e6;

  if (value === 0) return '$0';

  // Use full 6 decimal precision, trim trailing zeros
  const formatted = value.toFixed(6).replace(/\.?0+$/, '');
  return `$${formatted}`;
}

/**
 * Format wallet/session address for display.
 * Shows first 6 and last 4 characters.
 */
export function formatAddress(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Get user-friendly status label for session status.
 */
export function getStatusLabel(status: string): string {
  switch (status) {
    case 'voided':
      return 'Reclaimed';
    case 'captured':
      return 'Settled';
    default:
      return status.charAt(0).toUpperCase() + status.slice(1);
  }
}

/**
 * Get CSS class name for session status styling.
 */
export function getStatusClassName(status: string, styles: Record<string, string>): string {
  switch (status) {
    case 'active':
      return styles.statusActive || '';
    case 'captured':
      return styles.statusCaptured || '';
    case 'voided':
      return styles.statusVoided || '';
    case 'expired':
      return styles.statusExpired || '';
    default:
      return '';
  }
}

/**
 * Format timestamp to relative time (e.g., "5m ago", "2h ago").
 */
export function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}
