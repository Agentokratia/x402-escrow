'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import styles from './CodeBlock.module.css';

interface CodeBlockProps {
  code: string;
  language?: string;
  showLineNumbers?: boolean;
}

export function CodeBlock({ code, language, showLineNumbers = false }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const lines = code.split('\n');

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        {language && <span className={styles.language}>{language}</span>}
        <button
          onClick={handleCopy}
          className={styles.copyBtn}
          title="Copy to clipboard"
          aria-label={copied ? 'Copied!' : 'Copy to clipboard'}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          <span>{copied ? 'Copied!' : 'Copy'}</span>
        </button>
      </div>
      <pre className={styles.pre}>
        {showLineNumbers ? (
          <code className={styles.code}>
            {lines.map((line, i) => (
              <div key={i} className={styles.line}>
                <span className={styles.lineNumber}>{i + 1}</span>
                <span className={styles.lineContent}>{line}</span>
              </div>
            ))}
          </code>
        ) : (
          <code className={styles.code}>{code}</code>
        )}
      </pre>
    </div>
  );
}

// Inline code component for single-line code
export function InlineCode({ children }: { children: React.ReactNode }) {
  return <code className={styles.inline}>{children}</code>;
}
