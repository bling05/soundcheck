import type { Lesson, ScanReport } from '@soundcheck/report';

const URL_SCANNED = 'https://example-app.test/';
const OWASP = ['A05:2021 Security Misconfiguration'];
const WHY_HEADERS =
  'AI tools build what you ask for, and nobody asks for this. The app works fine without it, so nothing prompts the tool to add it.';

const prompt = (problem: string, request: string) =>
  [
    "You're helping me fix a security issue in this Lovable project.",
    `A scan found this: ${problem}.`,
    request,
    "Don't change anything else. If something stops you from doing this, like my hosting not allowing it, tell me instead of working around it.",
  ].join('\n\n');

const supabaseLesson: Lesson = {
  whatItIs:
    'Supabase has two kinds of key. The anon key is meant to be public, and your security rules limit what it can do. The secret key, also called service role, skips those rules completely.',
  whyAiToolsProduceIt:
    "AI tools often connect a service the quickest way, by calling it straight from the browser. That works right away, but anything browser code uses gets sent to every visitor. Names starting with NEXT_PUBLIC_ or VITE_ do this too: they're copied into your public code.",
  howItIsExploited:
    'Anyone can open your site, read its code, and copy this key. With it they can read, change, or delete everything in your database, including all your users’ data.',
  owasp: ['A02:2021 Cryptographic Failures', ...OWASP],
  cwe: ['CWE-200', 'CWE-798'],
};

/** Made-up results, so the report can be reviewed before the scan flow exists. */
export const SAMPLE_REPORT: ScanReport = {
  url: URL_SCANNED,
  scannedAt: '2026-11-04T12:00:00.000Z',
  outcomes: [
    {
      checkId: 'security-headers',
      title: 'Security headers',
      status: 'ran',
      findings: [
        {
          checkId: 'security-headers',
          title: 'Other websites can embed your site inside theirs',
          severity: 'low',
          source: 'live',
          evidence: [
            {
              kind: 'header',
              url: URL_SCANNED,
              header: 'x-frame-options',
              detail:
                'Neither this header nor a frame-ancestors rule was in the response.',
            },
          ],
          lesson: {
            whatItIs:
              'X-Frame-Options tells browsers whether other websites can show your site inside a frame on their own page.',
            whyAiToolsProduceIt: WHY_HEADERS,
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
          aiFixPrompt: prompt(
            'Other websites can embed your site inside theirs',
            'Add the header X-Frame-Options: DENY to every response. If this app embeds its own pages in frames, use SAMEORIGIN instead and tell me which one you chose.',
          ),
        },
        {
          checkId: 'security-headers',
          title: "Your site doesn't limit which scripts can run",
          severity: 'medium',
          source: 'live',
          evidence: [
            {
              kind: 'header',
              url: URL_SCANNED,
              header: 'content-security-policy',
              detail: 'This header was not in the response.',
            },
          ],
          lesson: {
            whatItIs:
              'Content-Security-Policy is a list you give the browser of where scripts are allowed to come from. Anything not on the list gets blocked.',
            whyAiToolsProduceIt: WHY_HEADERS,
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
          aiFixPrompt: prompt(
            "Your site doesn't limit which scripts can run",
            'Add a Content-Security-Policy header. Start with Content-Security-Policy-Report-Only so nothing breaks, and list every outside service this app really uses, such as its database, auth, and analytics. Then tell me how to check for warnings and when to switch it to enforcing.',
          ),
        },
      ],
    },
    {
      checkId: 'bundle-secrets',
      title: 'Secret keys in public code',
      status: 'ran',
      findings: [
        {
          checkId: 'bundle-secrets',
          title: "Your Supabase secret key is in your site's public code",
          severity: 'critical',
          source: 'live',
          safetyStep:
            "Create a new key and delete this one. Removing it from your code isn't enough, because anyone who already copied it can keep using it until it's deleted.",
          evidence: [
            {
              kind: 'url',
              url: `${URL_SCANNED}assets/index-Ab12Cd34.js`,
              detail: 'Found a key ending in ****9f3a in this file.',
            },
          ],
          lesson: supabaseLesson,
          manualFix: {
            description:
              "Do these in order. 1. Search your code and hosting settings for everywhere this key is used, so you know what will need the new one. 2. Create a new key in your Supabase project settings. 3. Move all Supabase secret key calls to code that only runs on your server, and give it the new key through a private environment variable. 4. Delete the old key. Removing it from your code isn't enough, because anyone who already copied it can still use it until it's deleted.",
            language: 'ts',
            snippet:
              '// Runs on your server only. Never start this name with NEXT_PUBLIC_ or VITE_.\nconst key = process.env.SUPABASE_SECRET_KEY;',
          },
          aiFixPrompt: prompt(
            "Your Supabase secret key is in your site's public code. The key ends in ****9f3a",
            "Move every Supabase secret key call out of browser code and into code that only runs on the server, reading the key from a private environment variable named SUPABASE_SECRET_KEY. The name must not start with NEXT_PUBLIC_ or VITE_. Remove the key from the code entirely, and don't print it or repeat it. Then remind me that I still need to create a new key and delete the old one myself, because the old one is already public.",
          ),
        },
      ],
    },
  ],
  notAttempted: [
    {
      title: 'Database and storage rules',
      reason:
        'Testing these goes further than reading public files, so we only do it once you verify that you own this domain.',
    },
    {
      title: 'Your code',
      reason:
        'Problems like missing ownership checks only show up in your code. Connect your GitHub repo to check them.',
    },
    {
      title: 'Pages behind a login',
      reason: 'We only read what a logged-out visitor can see.',
    },
  ],
};
