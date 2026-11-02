import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Barlow_Condensed, Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const heading = Barlow_Condensed({
  subsets: ['latin'],
  weight: ['500', '600'],
  variable: '--font-heading',
});
const body = Inter({ subsets: ['latin'], variable: '--font-body' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' });

export const metadata: Metadata = {
  title: 'Soundcheck',
  description:
    'Free, open-source security scanner and learning site for apps built with AI tools.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${heading.variable} ${body.variable} ${mono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
