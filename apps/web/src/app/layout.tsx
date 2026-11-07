import type { Metadata } from 'next';
import { connection } from 'next/server';
import type { ReactNode } from 'react';
import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import './globals.css';

const sans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '600'],
  variable: '--font-sans',
});
const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'Soundcheck',
  description:
    'Free security scanner and learning site for apps built with AI tools.',
};

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  // Every page renders per visit, so each one gets its own script nonce. See src/proxy.ts.
  await connection();
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
