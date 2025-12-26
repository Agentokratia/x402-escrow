'use client';

import { useAccount, useChainId, useSignMessage, useDisconnect } from 'wagmi';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useCallback, useRef } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import Link from 'next/link';
import { useAuthStore, authApi, createSiweMessage } from '@/lib/store/authStore';
import { ThemeToggle } from '@/components/ThemeToggle';
import styles from './page.module.css';

type SigningState = 'idle' | 'signing' | 'verifying' | 'rejected' | 'error';

// Copy to clipboard helper
function copyToClipboard(text: string, setCopied: (id: string) => void, id: string) {
  navigator.clipboard.writeText(text).then(() => {
    setCopied(id);
    setTimeout(() => setCopied(''), 2000);
  });
}

export default function Home() {
  const { isConnected, address } = useAccount();
  const chainId = useChainId();
  const { signMessageAsync } = useSignMessage();
  const { disconnect } = useDisconnect();
  const router = useRouter();

  const { isAuthenticated, setAuth, clearAuth, walletAddress } = useAuthStore();
  const [signingState, setSigningState] = useState<SigningState>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [copiedId, setCopiedId] = useState('');
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const isSigningRef = useRef(false);
  const hasInitiatedRef = useRef(false);

  // Clear auth if wallet disconnected or changed
  useEffect(() => {
    if (!isConnected) {
      clearAuth();
      setSigningState('idle');
      hasInitiatedRef.current = false;
      return;
    }

    if (walletAddress && address && walletAddress !== address.toLowerCase()) {
      clearAuth();
    }
  }, [isConnected, address, walletAddress, clearAuth]);

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated && isConnected) {
      router.push('/dashboard');
    }
  }, [isAuthenticated, isConnected, router]);

  // SIWE sign-in flow
  const performSiweSign = useCallback(async () => {
    if (!address || !chainId || isSigningRef.current) return;

    isSigningRef.current = true;
    setSigningState('signing');
    setErrorMessage('');

    try {
      const nonce = await authApi.getNonce();
      const siweMessage = createSiweMessage(address, chainId, nonce);
      const message = siweMessage.prepareMessage();
      const signature = await signMessageAsync({ message });

      setSigningState('verifying');
      const { token, wallet } = await authApi.verify(message, signature);

      setAuth(token, wallet);
      router.push('/dashboard');
    } catch (err) {
      console.error('SIWE authentication failed:', err);
      const error = err as Error;
      if (
        error.message?.includes('rejected') ||
        error.message?.includes('denied') ||
        error.message?.includes('User rejected')
      ) {
        setSigningState('rejected');
      } else {
        setSigningState('error');
        setErrorMessage(error.message || 'Authentication failed');
      }
    } finally {
      isSigningRef.current = false;
    }
  }, [address, chainId, signMessageAsync, setAuth, router]);

  // Auto-trigger SIWE when wallet connects
  useEffect(() => {
    if (isConnected && address && signingState === 'idle') {
      if (isAuthenticated) {
        router.push('/dashboard');
        return;
      }
      if (hasInitiatedRef.current) return;
      hasInitiatedRef.current = true;

      const timer = setTimeout(() => performSiweSign(), 300);
      return () => clearTimeout(timer);
    }
  }, [isConnected, address, signingState, performSiweSign, isAuthenticated, router]);

  const handleTryAgain = () => {
    hasInitiatedRef.current = false;
    setSigningState('idle');
  };

  const handleDifferentWallet = () => {
    setSigningState('idle');
    disconnect();
  };

  // Signing state
  if (isConnected && signingState === 'signing') {
    return (
      <div className={styles.pageCentered}>
        <div className={styles.card}>
          <div className={styles.cardLogo}>
            <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M24 6L9 42H17L19 36H29L31 42H39L24 6Z" fill="currentColor" />
              <path d="M24 16L21 28H27L24 16Z" fill="var(--paper)" />
              <circle cx="13" cy="10" r="2" fill="currentColor" />
              <circle cx="24" cy="5" r="2" fill="currentColor" />
              <circle cx="35" cy="10" r="2" fill="currentColor" />
            </svg>
          </div>
          <div className={styles.spinner} />
          <h1 className={styles.cardTitle}>Check your wallet</h1>
          <p className={styles.cardDesc}>Approve the sign-in request to continue</p>
          <p className={styles.cardHint}>Free - No transaction required</p>
        </div>
      </div>
    );
  }

  if (isConnected && signingState === 'verifying') {
    return (
      <div className={styles.pageCentered}>
        <div className={styles.card}>
          <div className={styles.cardLogo}>
            <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M24 6L9 42H17L19 36H29L31 42H39L24 6Z" fill="currentColor" />
              <path d="M24 16L21 28H27L24 16Z" fill="var(--paper)" />
              <circle cx="13" cy="10" r="2" fill="currentColor" />
              <circle cx="24" cy="5" r="2" fill="currentColor" />
              <circle cx="35" cy="10" r="2" fill="currentColor" />
            </svg>
          </div>
          <div className={styles.spinner} />
          <h1 className={styles.cardTitle}>Verifying</h1>
          <p className={styles.cardDesc}>Just a moment...</p>
        </div>
      </div>
    );
  }

  if (isConnected && signingState === 'rejected') {
    return (
      <div className={styles.pageCentered}>
        <div className={styles.card}>
          <div className={styles.cardLogo}>
            <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M24 6L9 42H17L19 36H29L31 42H39L24 6Z" fill="currentColor" />
              <path d="M24 16L21 28H27L24 16Z" fill="var(--paper)" />
              <circle cx="13" cy="10" r="2" fill="currentColor" />
              <circle cx="24" cy="5" r="2" fill="currentColor" />
              <circle cx="35" cy="10" r="2" fill="currentColor" />
            </svg>
          </div>
          <h1 className={styles.cardTitle}>Sign-in cancelled</h1>
          <p className={styles.cardDesc}>You declined the signature request</p>
          <div className={styles.cardActions}>
            <button className={styles.btnPrimary} onClick={handleTryAgain}>
              Try again
            </button>
            <button className={styles.btnGhost} onClick={handleDifferentWallet}>
              Use different wallet
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (isConnected && signingState === 'error') {
    return (
      <div className={styles.pageCentered}>
        <div className={styles.card}>
          <div className={styles.cardLogo}>
            <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M24 6L9 42H17L19 36H29L31 42H39L24 6Z" fill="currentColor" />
              <path d="M24 16L21 28H27L24 16Z" fill="var(--paper)" />
              <circle cx="13" cy="10" r="2" fill="currentColor" />
              <circle cx="24" cy="5" r="2" fill="currentColor" />
              <circle cx="35" cy="10" r="2" fill="currentColor" />
            </svg>
          </div>
          <h1 className={styles.cardTitle}>Something went wrong</h1>
          <p className={styles.cardDesc}>{errorMessage || "We couldn't verify your wallet"}</p>
          <div className={styles.cardActions}>
            <button className={styles.btnPrimary} onClick={handleTryAgain}>
              Try again
            </button>
            <button className={styles.btnGhost} onClick={handleDifferentWallet}>
              Use different wallet
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (isConnected && signingState === 'idle') {
    return (
      <div className={styles.pageCentered}>
        <div className={styles.card}>
          <div className={styles.cardLogo}>
            <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M24 6L9 42H17L19 36H29L31 42H39L24 6Z" fill="currentColor" />
              <path d="M24 16L21 28H27L24 16Z" fill="var(--paper)" />
              <circle cx="13" cy="10" r="2" fill="currentColor" />
              <circle cx="24" cy="5" r="2" fill="currentColor" />
              <circle cx="35" cy="10" r="2" fill="currentColor" />
            </svg>
          </div>
          <div className={styles.spinner} />
          <p className={styles.cardDesc}>Connecting...</p>
        </div>
      </div>
    );
  }

  // Landing page - split screen with additional sections
  return (
    <>
      {/* Hero - Split screen */}
      <section className={styles.hero}>
        <div className={styles.page}>
          {/* Left - Brand side */}
          <div className={styles.brandSide}>
            <Link href="https://agentokratia.com" className={styles.logo}>
              <svg
                viewBox="0 0 40 40"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                width="36"
                height="36"
              >
                <path d="M20 6L7 34H13L15 29H25L27 34H33L20 6Z" fill="#FFFFFF" />
                <path d="M20 14L17 24H23L20 14Z" fill="#1A1A1A" />
                <circle cx="11" cy="9" r="2" fill="#FFFFFF" />
                <circle cx="20" cy="5" r="2" fill="#FFFFFF" />
                <circle cx="29" cy="9" r="2" fill="#FFFFFF" />
              </svg>
              <span>Agentokratia</span>
            </Link>

            <div className={styles.brandContent}>
              <h1 className={styles.brandTitle}>
                x402 Escrow
                <br />
                Facilitator
              </h1>
              <p className={styles.brandSubtitle}>
                High-frequency x402 payments. One signature creates a session, no more signing per
                request. Reclaim unused funds anytime.
              </p>

              <div className={styles.heroMeta}>
                <span>Base</span>
                <span className={styles.dot}></span>
                <span>USDC</span>
                <span className={styles.dot}></span>
                <span>$0 fees</span>
              </div>
            </div>

            <footer className={styles.brandFooter}>
              <a href="https://agentokratia.com/terms">Terms</a>
              <a href="https://agentokratia.com/privacy">Privacy</a>
              <a href="https://github.com/agentokratia/x402-escrow">Docs</a>
            </footer>
          </div>

          {/* Right - Connect side */}
          <div className={styles.connectSide}>
            <div className={styles.themeToggleWrapper}>
              <ThemeToggle />
            </div>
            <div className={styles.connectCard}>
              <div className={styles.badgeBeta}>Beta</div>

              <h2 className={styles.connectTitle}>Get Started</h2>
              <p className={styles.connectDesc}>
                Connect your wallet to accept payments or track your spending
              </p>

              <div className={styles.connectAction}>
                <ConnectButton label="Connect Wallet" />
              </div>

              <div className={styles.benefitsList}>
                <div className={styles.benefitItem}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path
                      d="M13.5 4.5L6 12L2.5 8.5"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span>Accept payments as a developer</span>
                </div>
                <div className={styles.benefitItem}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path
                      d="M13.5 4.5L6 12L2.5 8.5"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span>Track spending as a user</span>
                </div>
                <div className={styles.benefitItem}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path
                      d="M13.5 4.5L6 12L2.5 8.5"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span>Reclaim unused funds anytime</span>
                </div>
              </div>

              <p className={styles.walletHelp}>
                <a
                  href="https://ethereum.org/en/wallets/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  What is a wallet?
                </a>
              </p>
            </div>
          </div>
        </div>

        {/* Scroll indicator */}
        <a
          href="#how-it-works"
          className={styles.scrollIndicator}
          aria-label="Scroll to learn more"
        >
          <span>Learn more</span>
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M12 5v14M5 12l7 7 7-7" />
          </svg>
        </a>
      </section>

      {/* How It Works - Animated Flow */}
      <section id="how-it-works" className={styles.howItWorks}>
        <div className={styles.container}>
          <h2 className={styles.sectionTitle}>How It Works</h2>
          <p className={styles.sectionSubtitle}>One signature. Unlimited calls. Reclaim anytime.</p>

          {/* Animated Flow Diagram */}
          <div className={styles.flowDiagram}>
            {/* User Wallet */}
            <div className={styles.flowNode}>
              <div className={styles.flowNodeIcon}>
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" />
                  <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" />
                </svg>
              </div>
              <span className={styles.flowNodeLabel}>Your Wallet</span>
            </div>

            {/* Arrow 1 - Signature */}
            <div className={styles.flowArrow}>
              <div className={styles.flowArrowLine}>
                <div className={styles.flowArrowPulse}></div>
              </div>
              <span className={styles.flowArrowLabel}>Sign once</span>
            </div>

            {/* Escrow Contract */}
            <div className={`${styles.flowNode} ${styles.flowNodeCenter}`}>
              <div className={styles.flowNodeIcon}>
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 8v8" />
                  <path d="M8 12h8" />
                </svg>
              </div>
              <span className={styles.flowNodeLabel}>Escrow Contract</span>
              <span className={styles.flowNodeSublabel}>Funds locked on-chain</span>
            </div>

            {/* Arrow 2 - Session */}
            <div className={styles.flowArrow}>
              <div className={styles.flowArrowLine}>
                <div className={styles.flowArrowPulse}></div>
              </div>
              <span className={styles.flowArrowLabel}>Session token</span>
            </div>

            {/* API Calls */}
            <div className={styles.flowNode}>
              <div className={styles.flowNodeIcon}>
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M18.178 8c5.096 0 5.096 8 0 8-5.095 0-7.133-8-12.739-8-4.781 0-4.781 8 0 8 5.606 0 7.644-8 12.74-8z" />
                </svg>
              </div>
              <span className={styles.flowNodeLabel}>Unlimited Calls</span>
              <span className={styles.flowNodeSublabel}>Zero gas per request</span>
            </div>
          </div>

          {/* Reclaim callout */}
          <div className={styles.flowReclaim}>
            <div className={styles.flowReclaimArrow}>
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                <path d="M21 3v5h-5" />
              </svg>
            </div>
            <span>Unused funds? Reclaim anytime from the contract.</span>
          </div>
        </div>
      </section>

      {/* Why Escrow - Scheme Comparison */}
      <section className={styles.comparison}>
        <div className={styles.container}>
          <h2 className={styles.sectionTitle}>Why Escrow?</h2>
          <p className={styles.sectionSubtitle}>Compare x402 payment schemes for your use case</p>

          <div className={styles.comparisonTable}>
            <div className={styles.comparisonHeader}>
              <div className={styles.comparisonCell}></div>
              <div className={styles.comparisonCell}>exact</div>
              <div className={styles.comparisonCell}>upto</div>
              <div className={`${styles.comparisonCell} ${styles.comparisonHighlight}`}>escrow</div>
            </div>

            <div className={styles.comparisonRow}>
              <div className={styles.comparisonLabel}>Per-request gas</div>
              <div className={styles.comparisonCell}>
                <span className={styles.comparisonBad}>Yes</span>
              </div>
              <div className={styles.comparisonCell}>
                <span className={styles.comparisonBad}>Yes</span>
              </div>
              <div className={`${styles.comparisonCell} ${styles.comparisonHighlight}`}>
                <span className={styles.comparisonGood}>No (session-based)</span>
              </div>
            </div>

            <div className={styles.comparisonRow}>
              <div className={styles.comparisonLabel}>User signatures</div>
              <div className={styles.comparisonCell}>
                <span className={styles.comparisonBad}>Every request</span>
              </div>
              <div className={styles.comparisonCell}>
                <span className={styles.comparisonBad}>Every request</span>
              </div>
              <div className={`${styles.comparisonCell} ${styles.comparisonHighlight}`}>
                <span className={styles.comparisonGood}>Once per session</span>
              </div>
            </div>

            <div className={styles.comparisonRow}>
              <div className={styles.comparisonLabel}>Unused funds</div>
              <div className={styles.comparisonCell}>
                <span>N/A (exact amt)</span>
              </div>
              <div className={styles.comparisonCell}>
                <span>N/A (max limit)</span>
              </div>
              <div className={`${styles.comparisonCell} ${styles.comparisonHighlight}`}>
                <span className={styles.comparisonGood}>100% reclaimable</span>
              </div>
            </div>

            <div className={styles.comparisonRow}>
              <div className={styles.comparisonLabel}>Best for</div>
              <div className={styles.comparisonCell}>
                <span>One-off payments</span>
              </div>
              <div className={styles.comparisonCell}>
                <span>Variable pricing</span>
              </div>
              <div className={`${styles.comparisonCell} ${styles.comparisonHighlight}`}>
                <span className={styles.comparisonGood}>High-frequency APIs</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Quick Start */}
      <section className={styles.quickStart}>
        <div className={styles.container}>
          <h2 className={styles.sectionTitle}>Quick Start</h2>
          <p className={styles.sectionSubtitle}>
            Integrate x402 payments in minutes with our simple SDK
          </p>

          {/* Install command */}
          <div className={styles.installBlock}>
            <div className={styles.codeHeader}>
              <span className={styles.codeLabel}>Install</span>
              <button
                className={styles.copyButton}
                onClick={() =>
                  copyToClipboard(
                    'npm install @x402/core @x402/express @agentokratia/x402-escrow',
                    setCopiedId,
                    'install'
                  )
                }
                aria-label="Copy install command"
              >
                {copiedId === 'install' ? (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                ) : (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                )}
              </button>
            </div>
            <pre className={styles.codeContent}>
              npm install @x402/core @x402/express @agentokratia/x402-escrow
            </pre>
          </div>

          <div className={styles.codeGrid}>
            <div className={styles.codeBlock}>
              <div className={styles.codeHeader}>
                <span className={styles.codeLabel}>Server - Express Middleware</span>
                <button
                  className={styles.copyButton}
                  onClick={() =>
                    copyToClipboard(
                      `import { x402ResourceServer, HTTPFacilitatorClient } from '@x402/core/server';
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
}, server));`,
                      setCopiedId,
                      'server'
                    )
                  }
                  aria-label="Copy server code"
                >
                  {copiedId === 'server' ? (
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  ) : (
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                  )}
                </button>
              </div>
              <pre
                className={styles.codeContent}
              >{`import { x402ResourceServer, HTTPFacilitatorClient } from '@x402/core/server';
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
            <div className={styles.codeBlock}>
              <div className={styles.codeHeader}>
                <span className={styles.codeLabel}>Client - 2 Lines</span>
                <button
                  className={styles.copyButton}
                  onClick={() =>
                    copyToClipboard(
                      `import { createEscrowFetch } from '@agentokratia/x402-escrow/client';

// walletClient from wagmi or viem
const { fetch } = createEscrowFetch(walletClient);

// That's it! Payment handled automatically
const response = await fetch('https://api.example.com/premium');

// Sessions reused - no signature needed for subsequent calls
const data = await response.json();`,
                      setCopiedId,
                      'client'
                    )
                  }
                  aria-label="Copy client code"
                >
                  {copiedId === 'client' ? (
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  ) : (
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                  )}
                </button>
              </div>
              <pre
                className={styles.codeContent}
              >{`import { createEscrowFetch } from '@agentokratia/x402-escrow/client';

// walletClient from wagmi or viem
const { fetch } = createEscrowFetch(walletClient);

// That's it! Payment handled automatically
const response = await fetch('https://api.example.com/premium');

// Sessions reused - no signature needed for subsequent calls
const data = await response.json();`}</pre>
            </div>
          </div>
          <div className={styles.quickStartLinks}>
            <a
              href="https://github.com/agentokratia/x402-escrow"
              className={styles.quickStartLink}
              target="_blank"
              rel="noopener noreferrer"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
              </svg>
              View on GitHub
            </a>
            <a
              href="https://github.com/agentokratia/x402-escrow/tree/main/docs"
              className={styles.quickStartLink}
              target="_blank"
              rel="noopener noreferrer"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
              Read Documentation
            </a>
          </div>
        </div>
      </section>

      {/* Guarantees */}
      <section className={styles.security}>
        <div className={styles.container}>
          <h2 className={styles.sectionTitle}>Guarantees</h2>
          <p className={styles.sectionSubtitle}>
            What the smart contract enforces, not what we promise
          </p>
          <div className={styles.securityGrid}>
            <div className={styles.securityCard}>
              <div className={styles.securityIcon}>
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  <path d="M9 12l2 2 4-4" />
                </svg>
              </div>
              <h3 className={styles.securityTitle}>On-Chain Escrow</h3>
              <p className={styles.securityDesc}>
                Funds held in audited smart contract. Non-custodial - only you control your
                deposits.
              </p>
            </div>
            <div className={styles.securityCard}>
              <div className={styles.securityIcon}>
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                  <path d="m15 5 4 4" />
                </svg>
              </div>
              <h3 className={styles.securityTitle}>ERC-3009 Standard</h3>
              <p className={styles.securityDesc}>
                Gasless authorization using industry-standard signatures. No transaction needed to
                approve.
              </p>
            </div>
            <div className={styles.securityCard}>
              <div className={styles.securityIcon}>
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                  <path d="M21 3v5h-5" />
                  <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                  <path d="M8 16H3v5" />
                </svg>
              </div>
              <h3 className={styles.securityTitle}>Full Reclaim Rights</h3>
              <p className={styles.securityDesc}>
                Withdraw unused funds anytime. 100% reclaimable via dashboard or direct contract
                call.
              </p>
            </div>
            <div className={styles.securityCard}>
              <div className={styles.securityIcon}>
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                  <polyline points="14 2 14 8 20 8" />
                  <path d="m9 15 2 2 4-4" />
                </svg>
              </div>
              <h3 className={styles.securityTitle}>Open Source</h3>
              <p className={styles.securityDesc}>
                All code publicly auditable on GitHub. Transparency is our default.
              </p>
            </div>
          </div>
          <div className={styles.contractInfoGrid}>
            <div className={styles.contractInfo}>
              <span className={styles.contractLabel}>Base Mainnet</span>
              <code className={styles.contractAddress}>
                0xbDEa0d1BCc5966192b070fDF62ab4eF5B4420Cff
              </code>
              <a
                href="https://basescan.org/address/0xbDEa0d1BCc5966192b070fDF62ab4eF5B4420Cff"
                target="_blank"
                rel="noopener noreferrer"
                className={styles.contractLink}
              >
                BaseScan
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </a>
            </div>
            <div className={styles.contractInfo}>
              <span className={styles.contractLabel}>Base Sepolia</span>
              <code className={styles.contractAddress}>
                0xbDEa0d1BCc5966192b070fDF62ab4eF5B4420Cff
              </code>
              <a
                href="https://sepolia.basescan.org/address/0xbDEa0d1BCc5966192b070fDF62ab4eF5B4420Cff"
                target="_blank"
                rel="noopener noreferrer"
                className={styles.contractLink}
              >
                BaseScan
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className={styles.faq}>
        <div className={styles.container}>
          <h2 className={styles.sectionTitle}>Frequently Asked Questions</h2>
          <div className={styles.faqList}>
            {[
              {
                q: 'What are the gas costs?',
                a: 'Zero for users. You sign gaslessly via ERC-3009, the facilitator handles the on-chain deposit transaction. All subsequent requests are also gasless.',
              },
              {
                q: 'Which tokens are supported?',
                a: 'Currently USDC, which supports ERC-3009 transferWithAuthorization for gasless signatures. Permit2 support is next, enabling any ERC-20 token.',
              },
              {
                q: 'Can I reclaim unused funds?',
                a: 'Yes, 100% of unused funds are reclaimable anytime. Use the dashboard or call the smart contract directly.',
              },
              {
                q: 'What happens if the service is unavailable?',
                a: 'Your funds remain safely in escrow. You can reclaim them anytime regardless of service availability - no trust in the server required.',
              },
            ].map((faq, i) => (
              <div key={i} className={styles.faqItem}>
                <button
                  className={`${styles.faqQuestion} ${openFaq === i ? styles.faqOpen : ''}`}
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  aria-expanded={openFaq === i}
                >
                  <span>{faq.q}</span>
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className={styles.faqChevron}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                {openFaq === i && (
                  <div className={styles.faqAnswer}>
                    <p>{faq.a}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className={styles.siteFooter}>
        <div className={styles.container}>
          <div className={styles.footerContent}>
            <div className={styles.footerBrand}>
              <Link href="https://agentokratia.com" className={styles.footerLogo}>
                <svg
                  viewBox="0 0 40 40"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  width="28"
                  height="28"
                >
                  <path d="M20 6L7 34H13L15 29H25L27 34H33L20 6Z" fill="currentColor" />
                  <path d="M20 14L17 24H23L20 14Z" fill="var(--paper)" />
                  <circle cx="11" cy="9" r="2" fill="currentColor" />
                  <circle cx="20" cy="5" r="2" fill="currentColor" />
                  <circle cx="29" cy="9" r="2" fill="currentColor" />
                </svg>
                <span>x402 Escrow Facilitator</span>
              </Link>
              <p className={styles.footerTagline}>The payment layer for AI agents</p>
            </div>
            <div className={styles.footerLinks}>
              <div className={styles.footerColumn}>
                <h4>Resources</h4>
                <a
                  href="https://github.com/agentokratia/x402-escrow/tree/main/docs"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Documentation
                </a>
                <a
                  href="https://github.com/agentokratia/x402-escrow"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  GitHub
                </a>
                <a href="/api/supported" target="_blank" rel="noopener noreferrer">
                  API Reference
                </a>
              </div>
              <div className={styles.footerColumn}>
                <h4>Networks</h4>
                <span className={styles.networkBadge}>Base Mainnet</span>
                <span className={styles.networkBadge}>Base Sepolia</span>
              </div>
            </div>
          </div>
          <div className={styles.footerBottom}>
            <p>&copy; 2025 Agentokratia. Open source.</p>
          </div>
        </div>
      </footer>
    </>
  );
}
