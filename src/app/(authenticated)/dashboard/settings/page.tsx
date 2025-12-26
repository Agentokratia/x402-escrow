'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount, useDisconnect, useChainId } from 'wagmi';
import { Copy, Check, ExternalLink, LogOut } from 'lucide-react';
import { useAuthStore, fetchWithAuth } from '@/lib/store/authStore';
import styles from './page.module.css';

interface UserProfile {
  id: string;
  wallet: string;
  name: string | null;
  email: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export default function SettingsPage() {
  const router = useRouter();
  const { address } = useAccount();
  const chainId = useChainId();
  const { disconnect } = useDisconnect();
  const { clearAuth } = useAuthStore();

  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [form, setForm] = useState({
    name: '',
    email: '',
  });

  // Fetch user profile
  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const response = await fetchWithAuth('/api/auth/me');
        if (!response.ok) {
          throw new Error('Failed to load profile');
        }
        const data = await response.json();
        const profile: UserProfile = data.user;
        setForm({
          name: profile.name || '',
          email: profile.email || '',
        });
      } catch (err) {
        console.error('Failed to fetch profile:', err);
        setError(err instanceof Error ? err.message : 'Failed to load profile');
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, []);

  const copyAddress = () => {
    if (address) {
      navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDisconnect = () => {
    disconnect();
    clearAuth();
    router.push('/');
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const response = await fetchWithAuth('/api/auth/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to save');
      }

      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const getExplorerUrl = () => {
    if (!address) return null;
    const baseUrl = chainId === 8453 ? 'https://basescan.org' : 'https://sepolia.basescan.org';
    return `${baseUrl}/address/${address}`;
  };

  const getNetworkName = () => {
    return chainId === 8453 ? 'Base Mainnet' : 'Base Sepolia';
  };

  if (loading) {
    return (
      <div className={styles.page}>
        <header className={styles.header}>
          <h1>Settings</h1>
          <p>Loading your settings...</p>
        </header>
        <div className={styles.loading}>Loading...</div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Settings</h1>
      </header>

      {error && <div className={styles.error}>{error}</div>}
      {success && <div className={styles.success}>Settings saved successfully!</div>}

      <section className={styles.section}>
        <h2>Wallet</h2>
        <div className={styles.card}>
          <div className={styles.walletRow}>
            <div className={styles.walletInfo}>
              <span className={styles.label}>Connected Wallet</span>
              <div className={styles.addressRow}>
                <code className={styles.address}>{address || 'Not connected'}</code>
                {address && (
                  <button onClick={copyAddress} className={styles.iconBtn} title="Copy address">
                    {copied ? <Check size={16} /> : <Copy size={16} />}
                  </button>
                )}
              </div>
            </div>
            <div className={styles.walletInfo}>
              <span className={styles.label}>Network</span>
              <span className={styles.networkName}>
                {getNetworkName()}
                {chainId !== 8453 && <span className={styles.testnetBadge}>Testnet</span>}
              </span>
            </div>
          </div>
          <div className={styles.walletActions}>
            {address && (
              <a
                href={getExplorerUrl() || '#'}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.explorerLink}
              >
                View on Explorer
                <ExternalLink size={14} />
              </a>
            )}
            <button onClick={handleDisconnect} className={styles.disconnectBtn}>
              <LogOut size={16} />
              Disconnect Wallet
            </button>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h2>Profile</h2>
        <div className={styles.card}>
          <div className={styles.form}>
            <div className={styles.field}>
              <label className={styles.fieldLabel}>Display Name</label>
              <input
                type="text"
                className={styles.input}
                placeholder="Your name or alias"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
              <span className={styles.hint}>Shown in your account</span>
            </div>
            <div className={styles.field}>
              <label className={styles.fieldLabel}>Email</label>
              <input
                type="email"
                className={styles.input}
                placeholder="your@email.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
              <span className={styles.hint}>Used for notifications (coming soon)</span>
            </div>
          </div>
        </div>
      </section>

      <div className={styles.actions}>
        <button onClick={handleSave} className={styles.saveBtn} disabled={saving}>
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}
