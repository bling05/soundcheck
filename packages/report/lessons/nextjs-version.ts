import type { Lesson } from '../types';

export const NEXTJS_VERSION_LESSONS = {
  'nextjs-version:outdated': {
    whatItIs:
      'Next.js is the framework your site is built on. When a security hole is found in it, the Next.js team fixes it in a new version and publishes what the hole was. Your site only gets the fix once someone updates it.',
    whyAiToolsProduceIt:
      "AI tools set up a project with whatever version was current at the time, and they don't come back to update it. The site keeps working the same, so nothing tells you it's behind.",
    howItIsExploited:
      "Once a hole is published, attackers scan the internet for sites still running the old version. They can tell the version from the site's public code, the same way we did, so an outdated site is easy to find.",
    realCase: {
      summary:
        'In December 2025, a hole in React and Next.js called React2Shell let attackers run their own code on servers. Amazon saw groups trying to exploit it within hours of it being made public.',
      source: 'AWS Security Blog',
      url: 'https://aws.amazon.com/blogs/security/china-nexus-cyber-threat-groups-rapidly-exploit-react2shell-vulnerability-cve-2025-55182/',
    },
    owasp: ['A06:2021 Vulnerable and Outdated Components'],
    cwe: ['CWE-1104'],
  },
} satisfies Record<`nextjs-version:${string}`, Lesson>;
