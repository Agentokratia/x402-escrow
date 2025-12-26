'use client';

import { useState, useEffect } from 'react';
import { Plus, Copy, Check, ArrowRight, Code } from 'lucide-react';
import Link from 'next/link';
import { fetchWithAuth } from '@/lib/store/authStore';
import { Skeleton } from '@/components/Skeleton';
import styles from './page.module.css';

interface ApiKey {
  id: string;
  name: string;
  createdAt: string;
}

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState('');
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fetchingKeys, setFetchingKeys] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    const fetchKeys = async () => {
      try {
        setFetchError(null);
        const response = await fetchWithAuth('/api/keys');
        if (!response.ok) {
          throw new Error('Failed to load API keys');
        }
        const data = await response.json();
        setKeys(data.apiKeys);
      } catch (err) {
        console.error('Failed to fetch keys:', err);
        setFetchError(err instanceof Error ? err.message : 'Failed to load API keys');
      } finally {
        setFetchingKeys(false);
      }
    };

    fetchKeys();
  }, []);

  const handleCreate = async () => {
    if (!name.trim()) return;

    setLoading(true);
    setCreateError(null);

    try {
      const response = await fetchWithAuth('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create API key');
      }

      setNewKey(data.apiKey);
      setKeys([
        {
          id: data.id,
          name: data.name,
          createdAt: data.createdAt,
        },
        ...keys,
      ]);
      setName('');
      setShowModal(false);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create API key');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerContent}>
          <h1>API Keys</h1>
          <p className={styles.headerSubtitle}>
            Create keys to accept escrow payments from your users
          </p>
        </div>
        <button
          className={styles.createBtn}
          onClick={() => {
            setCreateError(null);
            setShowModal(true);
          }}
        >
          <Plus size={18} />
          New Key
        </button>
      </header>

      {fetchError && <div className={styles.fetchError}>{fetchError}</div>}

      {newKey && (
        <div className={styles.newKey}>
          <div className={styles.newKeyHeader}>
            <Check size={24} className={styles.successIcon} />
            <div>
              <h4>API Key Created Successfully</h4>
              <p>Copy this key now. You won&apos;t be able to see it again.</p>
            </div>
          </div>
          <div className={styles.newKeyValue}>
            <code>{newKey}</code>
            <button onClick={() => copyToClipboard(newKey)} title="Copy to clipboard">
              {copied ? <Check size={18} /> : <Copy size={18} />}
            </button>
          </div>

          <div className={styles.nextSteps}>
            <h5>Next: Use this header in your API calls</h5>
            <div className={styles.codeBlock}>
              <code>
                Authorization: Bearer {newKey.slice(0, 12)}...{newKey.slice(-4)}
              </code>
            </div>
          </div>

          <div className={styles.newKeyActions}>
            <button className={styles.dismissBtn} onClick={() => setNewKey(null)}>
              I&apos;ve saved the key
            </button>
            <Link href="/dashboard" className={styles.continueBtn}>
              Continue Setup
              <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      )}

      {/* Key List - always visible, content changes */}
      <div className={styles.keyList}>
        {fetchingKeys ? (
          // Skeleton items while loading
          [1, 2].map((i) => (
            <div key={i} className={styles.keyItem}>
              <div className={styles.keyInfo}>
                <Skeleton width={140} height={16} />
                <Skeleton width={100} height={12} className={styles.skeletonMeta} />
              </div>
              <Skeleton width={120} height={16} />
            </div>
          ))
        ) : keys.length === 0 ? (
          <div className={styles.emptyInline}>
            <h3>Ready to secure your integration</h3>
            <p>Your first API key is just one click away. It takes less than 30 seconds.</p>
          </div>
        ) : (
          keys.map((key) => (
            <div key={key.id} className={styles.keyItem}>
              <div className={styles.keyInfo}>
                <span className={styles.keyName}>{key.name}</span>
                <span className={styles.keyMeta}>
                  Created {new Date(key.createdAt).toLocaleDateString()}
                </span>
              </div>
              <code className={styles.keyPreview}>x402_****...****</code>
            </div>
          ))
        )}
      </div>

      {/* Integration Guide - always visible */}
      <section className={styles.integrationGuide}>
        <div className={styles.guideHeader}>
          <Code size={20} />
          <h3>x402 v2 Integration</h3>
          <span className={styles.protocolBadge}>x402 Protocol v2</span>
        </div>

        {/* How It Works - Visual */}
        <div className={styles.howItWorks}>
          <h4>Payment Flow</h4>
          <p>
            Use official x402 middleware. It handles 402 responses, verification, and settlement
            automatically.
          </p>

          <div className={styles.flowDiagram}>
            <div className={styles.flowActor}>
              <div className={styles.flowIcon}>C</div>
              <span>Client</span>
              <span className={styles.flowLabel}>x402HTTPClient</span>
            </div>
            <div className={styles.flowArrowRight}>→</div>
            <div className={styles.flowActor}>
              <div className={styles.flowIcon}>S</div>
              <span>Your Server</span>
              <span className={styles.flowLabel}>x402ResourceServer</span>
            </div>
            <div className={styles.flowArrowRight}>→</div>
            <div className={styles.flowActor}>
              <div className={styles.flowIcon}>F</div>
              <span>Facilitator</span>
              <span className={styles.flowLabel}>verify / settle</span>
            </div>
          </div>

          <div className={styles.flowStory}>
            <div className={styles.storyStep}>
              <span className={styles.storyNum}>1</span>
              <p>
                Request without payment → Server returns <strong>402</strong> +{' '}
                <code>PAYMENT-REQUIRED</code> header
              </p>
            </div>
            <div className={styles.storyStep}>
              <span className={styles.storyNum}>2</span>
              <p>
                Client signs escrow → Retry with <strong>PAYMENT-SIGNATURE</strong> header → Session
                created
              </p>
            </div>
            <div className={styles.storyStep}>
              <span className={styles.storyNum}>3</span>
              <p>
                Next requests use <strong>session</strong> (no signature!) → Instant payments
              </p>
            </div>
          </div>
        </div>

        {/* Server Setup */}
        <div className={styles.yourJobs}>
          <h4>Server Setup</h4>

          <div className={styles.jobCard}>
            <div className={styles.jobHeader}>
              <span className={styles.jobNumber}>1</span>
              <h5>Install</h5>
            </div>
            <div className={styles.codeExample}>
              <pre>{`npm install @x402/core @x402/express @agentokratia/x402-escrow`}</pre>
            </div>
          </div>

          <div className={styles.jobCard}>
            <div className={styles.jobHeader}>
              <span className={styles.jobNumber}>2</span>
              <h5>Add middleware</h5>
            </div>
            <div className={styles.codeExample}>
              <pre>{`import { x402ResourceServer, HTTPFacilitatorClient } from '@x402/core/server';
import { paymentMiddleware } from '@x402/express';
import { EscrowScheme } from '@agentokratia/x402-escrow/server';

const facilitator = new HTTPFacilitatorClient({
  url: 'https://facilitator.agentokratia.com',
  createAuthHeaders: async () => ({
    verify: { Authorization: \`Bearer \${process.env.X402_API_KEY}\` },
    settle: { Authorization: \`Bearer \${process.env.X402_API_KEY}\` },
    supported: {},
  }),
});

const server = new x402ResourceServer(facilitator)
  .register('eip155:8453', new EscrowScheme());

app.use(paymentMiddleware({
  'GET /api/premium': {
    accepts: { scheme: 'escrow', price: '$0.01', payTo: '0x...' },
  },
}, server));`}</pre>
            </div>
          </div>
        </div>

        {/* Facilitator API */}
        <div className={styles.apiReference}>
          <h4>Facilitator Endpoints</h4>
          <p className={styles.apiNote}>
            Base URL: <code>https://facilitator.agentokratia.com</code> • Used by x402 middleware
            automatically
          </p>

          <table className={styles.apiTable}>
            <tbody>
              <tr>
                <td>
                  <span className={styles.methodGet}>GET</span>
                </td>
                <td>
                  <code>/api/supported</code>
                </td>
                <td>Get supported schemes + config (public)</td>
              </tr>
              <tr>
                <td>
                  <span className={styles.methodPost}>POST</span>
                </td>
                <td>
                  <code>/api/verify</code>
                </td>
                <td>Verify payment payload</td>
              </tr>
              <tr>
                <td>
                  <span className={styles.methodPost}>POST</span>
                </td>
                <td>
                  <code>/api/settle</code>
                </td>
                <td>Settle payment, create/use session</td>
              </tr>
            </tbody>
          </table>

          <p className={styles.apiHint}>
            The x402 middleware calls these automatically. You just define routes and prices.
          </p>
        </div>
      </section>

      {showModal && (
        <div className={styles.modal} onClick={() => setShowModal(false)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <h3>Create API Key</h3>
            <p>Give your API key a name to identify it later.</p>

            <label className={styles.label}>
              Name
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Production Server"
                className={styles.input}
              />
            </label>

            {createError && <p className={styles.error}>{createError}</p>}

            <div className={styles.modalActions}>
              <button className={styles.cancelBtn} onClick={() => setShowModal(false)}>
                Cancel
              </button>
              <button
                className={styles.confirmBtn}
                onClick={handleCreate}
                disabled={!name.trim() || loading}
              >
                {loading ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
