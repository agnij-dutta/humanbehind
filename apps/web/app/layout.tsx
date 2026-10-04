import type { Metadata } from 'next';
import Link from 'next/link';
import { Instrument_Serif, Inter, JetBrains_Mono } from 'next/font/google';
import { config } from '@/lib/config';
import './globals.css';

const serif = Instrument_Serif({ subsets: ['latin'], weight: '400', style: ['normal', 'italic'], variable: '--font-serif' });
const sans = Inter({ subsets: ['latin'], variable: '--font-sans' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' });

export const metadata: Metadata = {
  title: 'Human Behind the Agent',
  description: 'A zero-knowledge proof that a unique, adult human owns this AI agent. Zero personal data.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        <div className="wrap">
          <header className="top">
            <Link href="/" className="wordmark">
              human<em>behind</em>
            </Link>
            {config.devMode && <span className="testflag">DEV MODE · TEST AADHAAR ONLY</span>}
          </header>
          {children}
          <footer>
            Binds an ERC-8004 agent to an anon-aadhaar proof: unique human, 18+, nothing else revealed.
            Local and testnet only.
          </footer>
        </div>
      </body>
    </html>
  );
}
