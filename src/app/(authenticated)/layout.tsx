'use client';

import { useAccount, useChainId } from 'wagmi';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { Key, Activity, BarChart3, Settings, Wallet } from 'lucide-react';
import { useAuthStore, useAuthHydrated } from '@/lib/store/authStore';
import { ThemeToggle } from '@/components/ThemeToggle';
import { formatAddress } from '@/lib/format';
import styles from './layout.module.css';

export default function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const { isConnected, address } = useAccount();
  const chainId = useChainId();
  const { isAuthenticated, clearAuth, walletAddress } = useAuthStore();
  const isHydrated = useAuthHydrated();
  const router = useRouter();
  const pathname = usePathname();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Clear pending state when navigation completes
  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);

  // Redirect to home if not connected, not authenticated, or wallet changed
  useEffect(() => {
    // Wait for hydration before making auth decisions
    if (!isHydrated) return;

    // Not connected - clear auth and redirect
    if (!isConnected) {
      clearAuth();
      router.push('/');
      return;
    }

    // Not authenticated - redirect
    if (!isAuthenticated) {
      router.push('/');
      return;
    }

    // Wallet changed - clear auth and redirect (security: prevent using old wallet's token)
    if (address && walletAddress && address.toLowerCase() !== walletAddress) {
      clearAuth();
      router.push('/');
      return;
    }
  }, [isHydrated, isConnected, isAuthenticated, address, walletAddress, router, clearAuth]);

  // Wait for hydration before rendering
  if (!isHydrated) {
    return null;
  }

  if (!isConnected || !isAuthenticated) {
    return null;
  }

  // Also guard against wallet mismatch during render
  if (address && walletAddress && address.toLowerCase() !== walletAddress) {
    return null;
  }

  const networkName = chainId === 8453 ? 'Base' : 'Sepolia';

  const isActive = (href: string, exact = true) => {
    if (exact) return pathname === href;
    return pathname.startsWith(href);
  };

  const handleNavClick = (href: string, e: React.MouseEvent) => {
    e.preventDefault();
    if (pathname === href) return;
    setPendingHref(href);
    startTransition(() => {
      router.push(href);
    });
  };

  const getLinkClass = (href: string, exact = true) => {
    const active = isActive(href, exact);
    const pending = pendingHref === href && isPending;
    return `${styles.navLink} ${active || pending ? styles.active : ''} ${pending ? styles.pending : ''}`;
  };

  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <div className={styles.header}>
          <Link href="/dashboard" className={styles.logo}>
            <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M24 6L9 42H17L19 36H29L31 42H39L24 6Z" fill="currentColor" />
              <path d="M24 16L21 28H27L24 16Z" fill="var(--paper)" />
              <circle cx="13" cy="10" r="2" fill="currentColor" />
              <circle cx="24" cy="5" r="2" fill="currentColor" />
              <circle cx="35" cy="10" r="2" fill="currentColor" />
            </svg>
            <span>x402 Escrow</span>
          </Link>
          <ThemeToggle />
        </div>

        <nav className={styles.nav}>
          <Link
            href="/dashboard"
            onClick={(e) => handleNavClick('/dashboard', e)}
            className={getLinkClass('/dashboard')}
          >
            <BarChart3 size={18} />
            Home
          </Link>

          <span className={styles.navLabel}>Accepting Payments</span>
          <Link
            href="/dashboard/api-keys"
            onClick={(e) => handleNavClick('/dashboard/api-keys', e)}
            className={getLinkClass('/dashboard/api-keys')}
          >
            <Key size={18} />
            API Keys
          </Link>
          <Link
            href="/dashboard/sessions"
            onClick={(e) => handleNavClick('/dashboard/sessions', e)}
            className={getLinkClass('/dashboard/sessions', false)}
          >
            <Activity size={18} />
            Incoming Sessions
          </Link>

          <span className={styles.navLabel}>Your Spending</span>
          <Link
            href="/wallet"
            onClick={(e) => handleNavClick('/wallet', e)}
            className={getLinkClass('/wallet')}
          >
            <Wallet size={18} />
            My Funds
          </Link>
          <Link
            href="/wallet/sessions"
            onClick={(e) => handleNavClick('/wallet/sessions', e)}
            className={getLinkClass('/wallet/sessions', false)}
          >
            <Activity size={18} />
            My Sessions
          </Link>

          <div className={styles.navSpacer} />
          <Link
            href="/dashboard/settings"
            onClick={(e) => handleNavClick('/dashboard/settings', e)}
            className={getLinkClass('/dashboard/settings')}
          >
            <Settings size={18} />
            Settings
          </Link>
        </nav>

        <Link href="/dashboard/settings" className={styles.footer}>
          <div className={styles.walletInfo}>
            <code className={styles.walletAddress}>{address ? formatAddress(address) : ''}</code>
            <span className={styles.networkBadge}>{networkName}</span>
          </div>
        </Link>
      </aside>

      <div className={styles.mainWrapper}>
        <main className={styles.main}>{children}</main>
      </div>
    </div>
  );
}
