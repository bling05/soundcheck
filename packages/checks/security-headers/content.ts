import type { Finding } from '@soundcheck/report';
import type { RuleId } from './rules';

type RuleContent = Pick<Finding, 'title' | 'severity' | 'manualFix'> & {
  /** What to ask an AI tool to change. */
  fixRequest: string;
};

// Severity reflects that each of these makes an attack easier but isn't an attack on its
// own. Scripts and HTTPS protect more than the other two, so they rank higher.
export const RULE_CONTENT: Record<RuleId, RuleContent> = {
  'content-security-policy': {
    title: "Your site doesn't limit which scripts can run",
    severity: 'medium',
    manualFix: {
      description:
        'Start in report-only mode, because a strict list can break your site if it leaves out a service you use, like your database or analytics. Add those services to the list, and once the browser console shows no warnings, rename the header to Content-Security-Policy.',
      language: 'http',
      snippet:
        "Content-Security-Policy-Report-Only: default-src 'self'; connect-src 'self' https://your-database.example.com",
    },
    fixRequest:
      'Add a Content-Security-Policy header. Start with Content-Security-Policy-Report-Only so nothing breaks, and list every outside service this app really uses, such as its database, auth, and analytics. Then tell me how to check for warnings and when to switch it to enforcing.',
  },
  'strict-transport-security': {
    title: "Your site doesn't force browsers to use HTTPS",
    severity: 'medium',
    manualFix: {
      description:
        'Only do this once your whole site works over HTTPS, because browsers will refuse the plain version for as long as the header says, here one year.',
      language: 'http',
      snippet: 'Strict-Transport-Security: max-age=31536000',
    },
    fixRequest:
      'Add the header Strict-Transport-Security: max-age=31536000 to every response. First confirm the whole site works over HTTPS, and tell me if it does not.',
  },
  'frame-protection': {
    title: 'Other websites can embed your site inside theirs',
    severity: 'low',
    manualFix: {
      description:
        'If your own site needs to embed its pages, use SAMEORIGIN instead of DENY.',
      language: 'http',
      snippet: 'X-Frame-Options: DENY',
    },
    fixRequest:
      'Add the header X-Frame-Options: DENY to every response. If this app embeds its own pages in frames, use SAMEORIGIN instead and tell me which one you chose.',
  },
  'content-type-options': {
    title: "Browsers may guess what your site's files are",
    severity: 'low',
    manualFix: {
      description: 'It is safe for almost every site.',
      language: 'http',
      snippet: 'X-Content-Type-Options: nosniff',
    },
    fixRequest:
      'Add the header X-Content-Type-Options: nosniff to every response.',
  },
};
