import { Patrick_Hand } from 'next/font/google';
import type { ReactNode } from 'react';
import './learn.css';

// For the handwritten "Check 2:" labels. Only the Learn section loads it.
const hand = Patrick_Hand({
  subsets: ['latin'],
  weight: ['400'],
  variable: '--font-hand',
});

export default function LearnLayout({ children }: { children: ReactNode }) {
  return <div className={`learn ${hand.variable}`}>{children}</div>;
}
