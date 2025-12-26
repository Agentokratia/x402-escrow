import { http } from 'wagmi';
import { base, baseSepolia } from 'wagmi/chains';
import { getDefaultConfig } from '@rainbow-me/rainbowkit';

// WalletConnect project ID - required for production
// Get yours at https://cloud.walletconnect.com
const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_ID;

if (!projectId) {
  console.warn('NEXT_PUBLIC_WALLETCONNECT_ID not set - wallet connections will fail');
}

const chains = [baseSepolia, base] as const;

export const config = getDefaultConfig({
  appName: 'x402 Escrow Facilitator',
  projectId: projectId || 'placeholder-for-build',
  chains,
  transports: {
    [base.id]: http(),
    [baseSepolia.id]: http(),
  },
  ssr: true,
});
