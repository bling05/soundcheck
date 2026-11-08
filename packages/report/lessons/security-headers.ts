import type { Lesson } from '../types';

const OWASP = ['A05:2021 Security Misconfiguration'];

const WHY_AI_TOOLS_MISS_IT =
  'AI tools build what you ask for, and nobody asks for this. The app works fine without it, so nothing prompts the tool to add it.';

export const SECURITY_HEADERS_LESSONS = {
  'security-headers:content-security-policy': {
    whatItIs:
      'Content-Security-Policy is a list you give the browser of where scripts are allowed to come from. Anything not on the list gets blocked.',
    whyAiToolsProduceIt: WHY_AI_TOOLS_MISS_IT,
    howItIsExploited:
      'If an attacker slips a script into your page, for example through a comment box, it runs as if it were yours and can act as whoever is logged in. This list is your backup: it can stop that script even when the original bug gets through.',
    realCase: {
      summary:
        "In 2018, attackers changed a script on British Airways' website so it quietly sent the card details people typed in to a site the attackers controlled. About 429,000 customers and staff were affected, and British Airways was fined £20 million.",
      source: 'Wikipedia',
      url: 'https://en.wikipedia.org/wiki/British_Airways_data_breach',
    },
    owasp: OWASP,
    cwe: ['CWE-693'],
  },
  'security-headers:strict-transport-security': {
    whatItIs:
      'Strict-Transport-Security tells a browser to only ever use the encrypted version of your site, even if someone types or clicks a plain http:// link.',
    whyAiToolsProduceIt: WHY_AI_TOOLS_MISS_IT,
    howItIsExploited:
      'On shared Wi-Fi, someone can intercept the first unencrypted request before your site redirects it to HTTPS, then read or change what the visitor sees. This header means that first unencrypted request never happens on later visits.',
    owasp: OWASP,
    cwe: ['CWE-319'],
  },
  'security-headers:frame-protection': {
    whatItIs:
      'X-Frame-Options tells browsers whether other websites can show your site inside a frame on their own page.',
    whyAiToolsProduceIt: WHY_AI_TOOLS_MISS_IT,
    howItIsExploited:
      'An attacker puts your site in an invisible frame on top of their own page. A visitor thinks they are clicking a harmless button, but they are really clicking something on your site while logged in, like "delete account." This is called clickjacking.',
    realCase: {
      summary:
        'In 2009, a clickjacking trick spread across Twitter. A page showed a button saying "Don\'t Click" with Twitter hidden in an invisible frame on top, so clicking it posted the same link from the visitor\'s own account.',
      source: 'The Register',
      url: 'https://www.theregister.com/2009/02/13/twitter_clickjack_attack/',
    },
    owasp: OWASP,
    cwe: ['CWE-1021'],
  },
  'security-headers:content-type-options': {
    whatItIs:
      'X-Content-Type-Options: nosniff tells browsers to trust the file type your site declares instead of guessing from its contents.',
    whyAiToolsProduceIt: WHY_AI_TOOLS_MISS_IT,
    howItIsExploited:
      'If your app lets people upload files, an attacker could upload one that looks harmless but contains a script. A browser that guesses might run it as code on your site.',
    owasp: OWASP,
    cwe: ['CWE-693'],
  },
} satisfies Record<`security-headers:${string}`, Lesson>;
