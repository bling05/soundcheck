import type { Finding } from '@soundcheck/report';
import type { RuleId } from './rules';

type RuleContent = Pick<
  Finding,
  'title' | 'severity' | 'lesson' | 'manualFix'
> & {
  /** What to ask an AI tool to change. */
  fixRequest: string;
};

const OWASP = ['A05:2021 Security Misconfiguration'];

const WHY_AI_TOOLS_MISS_IT =
  'AI tools build what you ask for, and nobody asks for this. The app works fine without it, so nothing prompts the tool to add it.';

// Severity reflects that each of these makes an attack easier but isn't an attack on its
// own. Scripts and HTTPS protect more than the other two, so they rank higher.
export const RULE_CONTENT: Record<RuleId, RuleContent> = {
  'content-security-policy': {
    title: "Your site doesn't limit which scripts can run",
    severity: 'medium',
    lesson: {
      whatItIs:
        'Content-Security-Policy is a list you give the browser of where scripts are allowed to come from. Anything not on the list gets blocked.',
      whyAiToolsProduceIt: WHY_AI_TOOLS_MISS_IT,
      howItIsExploited:
        'If an attacker slips a script into your page, for example through a comment box, it runs as if it were yours and can act as whoever is logged in. This list is your backup: it can stop that script even when the original bug gets through.',
      owasp: OWASP,
      cwe: ['CWE-693'],
    },
    manualFix: {
      description:
        'Add this header in your hosting or framework settings. Start in report-only mode, because a strict list can break your site if it leaves out a service you use, like your database or analytics. Add those services to the list, and once the browser console shows no warnings, rename the header to Content-Security-Policy.',
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
    lesson: {
      whatItIs:
        'Strict-Transport-Security tells a browser to only ever use the encrypted version of your site, even if someone types or clicks a plain http:// link.',
      whyAiToolsProduceIt: WHY_AI_TOOLS_MISS_IT,
      howItIsExploited:
        'On shared Wi-Fi, someone can intercept the first unencrypted request before your site redirects it to HTTPS, then read or change what the visitor sees. This header means that first unencrypted request never happens on later visits.',
      owasp: OWASP,
      cwe: ['CWE-319'],
    },
    manualFix: {
      description:
        'Add this header in your hosting or framework settings. Only do this once your whole site works over HTTPS, because browsers will refuse the plain version for as long as the header says, here one year.',
      language: 'http',
      snippet: 'Strict-Transport-Security: max-age=31536000',
    },
    fixRequest:
      'Add the header Strict-Transport-Security: max-age=31536000 to every response. First confirm the whole site works over HTTPS, and tell me if it does not.',
  },
  'frame-protection': {
    title: 'Other websites can embed your site inside theirs',
    severity: 'low',
    lesson: {
      whatItIs:
        'X-Frame-Options tells browsers whether other websites can show your site inside a frame on their own page.',
      whyAiToolsProduceIt: WHY_AI_TOOLS_MISS_IT,
      howItIsExploited:
        'An attacker puts your site in an invisible frame on top of their own page. A visitor thinks they are clicking a harmless button, but they are really clicking something on your site while logged in, like "delete account." This is called clickjacking.',
      owasp: OWASP,
      cwe: ['CWE-1021'],
    },
    manualFix: {
      description:
        'Add this header in your hosting or framework settings. If your own site needs to embed its pages, use SAMEORIGIN instead of DENY.',
      language: 'http',
      snippet: 'X-Frame-Options: DENY',
    },
    fixRequest:
      'Add the header X-Frame-Options: DENY to every response. If this app embeds its own pages in frames, use SAMEORIGIN instead and tell me which one you chose.',
  },
  'content-type-options': {
    title: "Browsers may guess what your site's files are",
    severity: 'low',
    lesson: {
      whatItIs:
        'X-Content-Type-Options: nosniff tells browsers to trust the file type your site declares instead of guessing from its contents.',
      whyAiToolsProduceIt: WHY_AI_TOOLS_MISS_IT,
      howItIsExploited:
        'If your app lets people upload files, an attacker could upload one that looks harmless but contains a script. A browser that guesses might run it as code on your site.',
      owasp: OWASP,
      cwe: ['CWE-693'],
    },
    manualFix: {
      description:
        'Add this header in your hosting or framework settings. It is safe for almost every site.',
      language: 'http',
      snippet: 'X-Content-Type-Options: nosniff',
    },
    fixRequest:
      'Add the header X-Content-Type-Options: nosniff to every response.',
  },
};
