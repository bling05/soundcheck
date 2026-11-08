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
  // High: with logins allowed, any website a visitor opens can read their data here.
  'cors-any-site': {
    title: 'Any website can read your site as a logged-in visitor',
    severity: 'high',
    manualFix: {
      description:
        "Only allow the websites that really need to read your site, listed by name, and don't copy back whatever website asks. If no other website needs to read it, remove these headers.",
      language: 'http',
      snippet:
        'Access-Control-Allow-Origin: https://your-other-site.example\nAccess-Control-Allow-Credentials: true\nVary: Origin',
    },
    fixRequest:
      "This site's CORS settings copy back any website that asks and also allow logged-in requests, so any website can read a visitor's data from it. Change them to allow only a fixed list of the websites this app really needs, by exact address, or remove CORS if nothing else needs it. Don't use a pattern that matches any website. Tell me which websites you allowed.",
  },
  'cookie-not-secure': {
    title: 'Your login cookies can be sent without encryption',
    severity: 'medium',
    manualFix: {
      description:
        'Add the Secure flag where your app sets these cookies, so browsers only send them over HTTPS. Most frameworks have a setting for it.',
      language: 'http',
      snippet:
        'Set-Cookie: session=...; Secure; HttpOnly; SameSite=Lax; Path=/',
    },
    fixRequest:
      "Add the Secure flag to every cookie this app uses for logins or sessions, so they're only sent over HTTPS. Keep local development working, for example by only adding it in production. Tell me where you changed it.",
  },
  'cookie-not-httponly': {
    title: 'Scripts on your page can read your login cookies',
    severity: 'medium',
    manualFix: {
      description:
        'Add the HttpOnly flag where your app sets these cookies, so page scripts can never read them. If your own browser code reads one of them, move that work to the server first.',
      language: 'http',
      snippet:
        'Set-Cookie: session=...; Secure; HttpOnly; SameSite=Lax; Path=/',
    },
    fixRequest:
      "Add the HttpOnly flag to every cookie this app uses for logins or sessions, so page scripts can't read them. If browser code currently reads one of them, move that to the server instead. Tell me which cookies you changed.",
  },
};
