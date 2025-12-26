'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { RainbowKitProvider, Theme, lightTheme, darkTheme } from '@rainbow-me/rainbowkit';
import { useState } from 'react';
import { config } from '@/lib/wagmi';
import { ThemeProvider, useTheme } from '@/lib/theme';
import { ErrorBoundary } from './ErrorBoundary';
import '@rainbow-me/rainbowkit/styles.css';

// Suppress noisy wallet extension errors
if (typeof window !== 'undefined') {
  const isExtensionNoise = (msg: string) =>
    msg.includes('chrome.runtime') || msg.includes('Extension ID') || msg.includes('inpage.js');

  const origError = console.error;
  console.error = (...args) => {
    if (!isExtensionNoise(args[0]?.toString?.() || '')) origError.apply(console, args);
  };
}

// Shared theme configuration
const sharedRadii = {
  actionButton: '8px',
  connectButton: '8px',
  menuButton: '8px',
  modal: '16px',
  modalMobile: '16px',
};

const sharedFonts = {
  body: "'DM Sans', sans-serif",
};

// Light theme
const agentokratiaLightTheme: Theme = {
  ...lightTheme(),
  colors: {
    ...lightTheme().colors,
    accentColor: '#1A1A1A',
    accentColorForeground: '#FFFFFF',
    connectButtonBackground: '#1A1A1A',
    connectButtonBackgroundError: '#EF4444',
    connectButtonInnerBackground: '#F2F2EF',
    connectButtonText: '#FFFFFF',
    connectButtonTextError: '#FFFFFF',
    modalBackground: '#FFFFFF',
    modalBorder: '#E5E5E2',
    modalText: '#1A1A1A',
    modalTextDim: '#6B6B6B',
    modalTextSecondary: '#6B6B6B',
    profileAction: '#FAFAF8',
    profileActionHover: '#F2F2EF',
    profileForeground: '#F2F2EF',
    generalBorder: '#E5E5E2',
    generalBorderDim: '#F2F2EF',
    selectedOptionBorder: '#1A1A1A',
    actionButtonBorder: '#E5E5E2',
    actionButtonBorderMobile: '#E5E5E2',
    actionButtonSecondaryBackground: '#F2F2EF',
    closeButton: '#6B6B6B',
    closeButtonBackground: '#F2F2EF',
    connectionIndicator: '#22C55E',
    downloadBottomCardBackground: '#FAFAF8',
    downloadTopCardBackground: '#FFFFFF',
    error: '#EF4444',
    menuItemBackground: '#F2F2EF',
    standby: '#F59E0B',
  },
  fonts: sharedFonts,
  radii: { ...lightTheme().radii, ...sharedRadii },
  shadows: {
    connectButton: '0 2px 8px rgba(0, 0, 0, 0.08)',
    dialog: '0 8px 32px rgba(0, 0, 0, 0.12)',
    profileDetailsAction: '0 2px 4px rgba(0, 0, 0, 0.04)',
    selectedOption: '0 2px 8px rgba(0, 0, 0, 0.08)',
    selectedWallet: '0 2px 8px rgba(0, 0, 0, 0.08)',
    walletLogo: '0 2px 8px rgba(0, 0, 0, 0.08)',
  },
};

// Dark theme
const agentokratiaDarkTheme: Theme = {
  ...darkTheme(),
  colors: {
    ...darkTheme().colors,
    accentColor: '#F5F5F5',
    accentColorForeground: '#1A1A1A',
    connectButtonBackground: '#F5F5F5',
    connectButtonBackgroundError: '#F87171',
    connectButtonInnerBackground: '#2A2A2A',
    connectButtonText: '#1A1A1A',
    connectButtonTextError: '#1A1A1A',
    modalBackground: '#1A1A1A',
    modalBorder: '#3A3A3A',
    modalText: '#F5F5F5',
    modalTextDim: '#A1A1A1',
    modalTextSecondary: '#A1A1A1',
    profileAction: '#2A2A2A',
    profileActionHover: '#3A3A3A',
    profileForeground: '#2A2A2A',
    generalBorder: '#3A3A3A',
    generalBorderDim: '#2A2A2A',
    selectedOptionBorder: '#F5F5F5',
    actionButtonBorder: '#3A3A3A',
    actionButtonBorderMobile: '#3A3A3A',
    actionButtonSecondaryBackground: '#2A2A2A',
    closeButton: '#A1A1A1',
    closeButtonBackground: '#2A2A2A',
    connectionIndicator: '#34D399',
    downloadBottomCardBackground: '#1A1A1A',
    downloadTopCardBackground: '#2A2A2A',
    error: '#F87171',
    menuItemBackground: '#2A2A2A',
    standby: '#FBBF24',
  },
  fonts: sharedFonts,
  radii: { ...darkTheme().radii, ...sharedRadii },
  shadows: {
    connectButton: '0 2px 8px rgba(0, 0, 0, 0.3)',
    dialog: '0 8px 32px rgba(0, 0, 0, 0.4)',
    profileDetailsAction: '0 2px 4px rgba(0, 0, 0, 0.2)',
    selectedOption: '0 2px 8px rgba(0, 0, 0, 0.3)',
    selectedWallet: '0 2px 8px rgba(0, 0, 0, 0.3)',
    walletLogo: '0 2px 8px rgba(0, 0, 0, 0.3)',
  },
};

function RainbowKitWrapper({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  const rainbowTheme = theme === 'dark' ? agentokratiaDarkTheme : agentokratiaLightTheme;

  return (
    <RainbowKitProvider
      theme={rainbowTheme}
      modalSize="compact"
      appInfo={{
        appName: 'x402 Escrow Facilitator',
        learnMoreUrl: 'https://x402.org',
      }}
    >
      {children}
    </RainbowKitProvider>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 1000 * 60 * 5,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    <ErrorBoundary>
      <ThemeProvider>
        <WagmiProvider config={config}>
          <QueryClientProvider client={queryClient}>
            <RainbowKitWrapper>{children}</RainbowKitWrapper>
          </QueryClientProvider>
        </WagmiProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
