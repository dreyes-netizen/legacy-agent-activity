import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';

// Self-hosted at build time by next/font (no runtime request, no layout shift).
// Inter = body/UI text; JetBrains Mono = durations and micro-labels.
// JetBrains Mono has the largest x-height of any major mono face, a dotted zero
// for unambiguous 0/O, and a base-seriffed 1 -- all of which matter for reading
// a dense column of H:MM:SS values. Same pairing as the AGS KPI App.
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Agent Activity — AGS',
  description: 'Alliance Global Solutions — agent online, session and login time',
  icons: [
    { rel: 'icon', url: '/agslogo.png', type: 'image/png' },
    { rel: 'shortcut icon', url: '/agslogo.png', type: 'image/png' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="font-sans antialiased text-app-text">{children}</body>
    </html>
  );
}
