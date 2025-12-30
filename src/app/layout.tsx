import type { Metadata } from 'next';
import { DM_Sans, Newsreader, Space_Mono } from 'next/font/google';
import { Providers } from '@/components/Providers';
import './globals.css';

const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});

const newsreader = Newsreader({
  subsets: ['latin'],
  weight: ['400', '500'],
  style: ['normal', 'italic'],
  variable: '--font-serif',
  display: 'swap',
});

const spaceMono = Space_Mono({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'x402 Escrow Facilitator | Agentokratia',
  description: 'Session-based payments for AI agents. Authorize once, use many times.',
  icons: {
    icon: '/favicon.svg',
    apple: '/logo.svg',
  },
  openGraph: {
    title: 'x402 Escrow Facilitator | Agentokratia',
    description: 'Session-based payments for AI agents. Authorize once, use many times.',
    url: 'https://facilitator.agentokratia.com',
    siteName: 'Agentokratia',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'x402 Escrow Facilitator - Session-based payments for AI agents',
      },
    ],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'x402 Escrow Facilitator | Agentokratia',
    description: 'Session-based payments for AI agents. Authorize once, use many times.',
    images: ['/og-image.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${dmSans.variable} ${newsreader.variable} ${spaceMono.variable}`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
