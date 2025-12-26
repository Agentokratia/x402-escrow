'use client';

import { useState } from 'react';
import { Wallet, Zap, Server, RefreshCw, Shield, LucideIcon } from 'lucide-react';
import styles from './HowItWorks.module.css';

interface Step {
  id: number;
  icon: LucideIcon;
  title: string;
  description: string;
  detail: string;
  scheme?: string;
}

const steps: Step[] = [
  {
    id: 1,
    icon: Wallet,
    title: 'Sign Once',
    description: 'Authorize a deposit with one signature',
    detail: 'ERC-3009 authorization - funds stay in your wallet until used',
    scheme: 'escrow',
  },
  {
    id: 2,
    icon: Server,
    title: 'Session Created',
    description: 'Facilitator creates a session with balance',
    detail: 'Your deposit becomes a reusable session token',
    scheme: 'escrow',
  },
  {
    id: 3,
    icon: Zap,
    title: 'Instant Payments',
    description: 'Subsequent calls use session - no signing!',
    detail: 'Micropayments as low as $0.001, instant confirmation',
    scheme: 'session',
  },
  {
    id: 4,
    icon: RefreshCw,
    title: 'Auto Top-Up',
    description: 'Session low? Seamlessly create new one',
    detail: 'One new signature, another session ready',
    scheme: 'escrow',
  },
];

export function HowItWorks() {
  const [activeStep, setActiveStep] = useState(1);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h3 className={styles.title}>Escrow + Session Flow</h3>
        <div className={styles.trustBadge}>
          <Shield size={14} />
          <span>x402 Protocol</span>
        </div>
      </div>

      <div className={styles.flowDiagram}>
        <div className={styles.flowStep}>
          <span className={styles.flowLabel}>1st Request</span>
          <div className={styles.flowBox} data-scheme="escrow">
            <strong>ESCROW</strong>
            <span>Sign ERC-3009</span>
          </div>
        </div>
        <div className={styles.flowArrow}>
          <span>creates</span>
        </div>
        <div className={styles.flowStep}>
          <span className={styles.flowLabel}>Session</span>
          <div className={styles.flowBox} data-scheme="session">
            <strong>SESSION</strong>
            <span>Token + Balance</span>
          </div>
        </div>
        <div className={styles.flowArrow}>
          <span>enables</span>
        </div>
        <div className={styles.flowStep}>
          <span className={styles.flowLabel}>2nd+ Requests</span>
          <div className={styles.flowBox} data-scheme="instant">
            <strong>INSTANT</strong>
            <span>No signature!</span>
          </div>
        </div>
      </div>

      <div className={styles.timeline}>
        {steps.map((step, index) => {
          const Icon = step.icon;
          return (
            <div
              key={step.id}
              className={`${styles.step} ${activeStep === step.id ? styles.active : ''}`}
              onMouseEnter={() => setActiveStep(step.id)}
              onFocus={() => setActiveStep(step.id)}
              tabIndex={0}
              role="button"
              aria-pressed={activeStep === step.id}
              data-scheme={step.scheme}
            >
              <div className={styles.stepIcon}>
                <Icon size={20} />
              </div>
              <div className={styles.stepContent}>
                <div className={styles.stepHeader}>
                  <h4>{step.title}</h4>
                  {step.scheme && (
                    <span className={styles.schemeBadge} data-scheme={step.scheme}>
                      {step.scheme}
                    </span>
                  )}
                </div>
                <p>{step.description}</p>
                {activeStep === step.id && <span className={styles.detail}>{step.detail}</span>}
              </div>
              {index < steps.length - 1 && <div className={styles.connector} />}
            </div>
          );
        })}
      </div>

      <div className={styles.protocolNote}>
        <Shield size={16} />
        <span>
          Built on <strong>x402 Protocol v2</strong>
        </span>
      </div>
    </div>
  );
}
