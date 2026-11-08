/**
 * Critical Next.js security holes, copied from the official advisories at
 * https://github.com/vercel/next.js/security/advisories (checked Nov 8 2026). Only
 * critical ones are listed. Add new ones here when Next.js publishes them; the tests check
 * that every recommended version is clear of every hole.
 */
export interface Advisory {
  /** The GitHub advisory id, which is also its link. */
  ghsa: string;
  cve?: string;
  /** When it was published, like `October 2026`. */
  published: string;
  /** What an attacker can do, and when it applies, in plain words. */
  summary: string;
  /**
   * True when a default site is affected, with no special setup. Those make the finding
   * critical. `app-router` means only sites using the App Router, which is the default
   * for new Next.js sites.
   */
  affectsDefault: boolean | 'app-router';
  /** Each affected range: from `from` (included) up to `fixed` (not included). */
  ranges: readonly { from: string; fixed: string }[];
}

export const ADVISORIES: readonly Advisory[] = [
  {
    ghsa: 'GHSA-2464-fhr4-w9xw',
    cve: 'CVE-2026-96889',
    published: 'October 2026',
    summary:
      'Attackers can run their own code on your server through image optimization, if your site uses SVG images and runs on Linux.',
    affectsDefault: false,
    ranges: [
      { from: '10.0.0', fixed: '15.5.28' },
      { from: '16.0.0', fixed: '16.4.1' },
    ],
  },
  {
    ghsa: 'GHSA-673q-mjm6-r5xr',
    published: 'October 2026',
    summary:
      'Attackers can run their own code on your server, if your code uses "use cache" functions that return typed arrays.',
    affectsDefault: false,
    ranges: [{ from: '16.0.0', fixed: '16.4.1' }],
  },
  {
    ghsa: 'GHSA-vcvr-r3jv-pc5j',
    cve: 'CVE-2026-94545',
    published: 'September 2026',
    summary:
      'Attackers can run their own code on your server, if your site makes images with next/og from text that visitors can choose.',
    affectsDefault: false,
    ranges: [{ from: '16.2.0', fixed: '16.3.6' }],
  },
  {
    ghsa: 'GHSA-2xp9-vwfh-vxw4',
    published: 'August 2026',
    summary:
      'Attackers can run their own code on your server through image optimization, if your site uses AVIF images.',
    affectsDefault: false,
    ranges: [
      { from: '10.0.0', fixed: '15.5.24' },
      { from: '16.0.0', fixed: '16.3.3' },
    ],
  },
  {
    ghsa: 'GHSA-p293-qw3h-jr36',
    cve: 'CVE-2026-75604',
    published: 'August 2026',
    summary:
      'Attackers can run their own code on your server, if your site runs on a Windows server.',
    affectsDefault: false,
    ranges: [
      { from: '13.4.0', fixed: '15.5.24' },
      { from: '16.0.0', fixed: '16.3.3' },
    ],
  },
  {
    ghsa: 'GHSA-9qr9-h5gf-34mp',
    cve: 'CVE-2025-55182',
    published: 'December 2025',
    summary:
      'Attackers can run their own code on your server, on any site using the App Router. This is the hole known as React2Shell.',
    affectsDefault: 'app-router',
    ranges: [
      { from: '15.0.0', fixed: '15.0.5' },
      { from: '15.1.0', fixed: '15.1.9' },
      { from: '15.2.0', fixed: '15.2.6' },
      { from: '15.3.0', fixed: '15.3.6' },
      { from: '15.4.0', fixed: '15.4.8' },
      { from: '15.5.0', fixed: '15.5.7' },
      { from: '16.0.0', fixed: '16.0.7' },
    ],
  },
  {
    ghsa: 'GHSA-f82v-jwr5-mffw',
    cve: 'CVE-2025-29927',
    published: 'March 2025',
    summary:
      'Attackers can skip login checks that your site does in middleware, unless it is hosted on Vercel.',
    affectsDefault: false,
    ranges: [
      { from: '11.1.4', fixed: '12.3.5' },
      { from: '13.0.0', fixed: '13.5.9' },
      { from: '14.0.0', fixed: '14.2.25' },
      { from: '15.0.0', fixed: '15.2.3' },
    ],
  },
];
