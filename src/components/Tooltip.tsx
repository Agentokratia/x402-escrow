'use client';

import { ReactNode, useState, useRef, useId } from 'react';
import styles from './Tooltip.module.css';

interface TooltipProps {
  children: ReactNode;
  content: string;
  position?: 'top' | 'bottom';
}

export function Tooltip({ children, content, position = 'top' }: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const tooltipId = useId();
  const wrapperRef = useRef<HTMLSpanElement>(null);

  const show = () => setIsVisible(true);
  const hide = () => setIsVisible(false);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      hide();
      // Keep focus on the trigger
      wrapperRef.current?.focus();
    }
  };

  return (
    <span
      ref={wrapperRef}
      className={styles.wrapper}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="button"
      aria-describedby={isVisible ? tooltipId : undefined}
      aria-label="Show more information"
    >
      {children}
      {isVisible && (
        <span id={tooltipId} className={`${styles.tooltip} ${styles[position]}`} role="tooltip">
          {content}
          <span className={styles.arrow} />
        </span>
      )}
    </span>
  );
}
