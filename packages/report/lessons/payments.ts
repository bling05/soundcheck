import type { Lesson } from '../types';

export const PAYMENTS_LESSONS = {
  'payments:price-from-request': {
    whatItIs:
      "When someone checks out, your server tells Stripe how much to charge. If that amount comes from the visitor's browser, the visitor can change it before it's sent, and Stripe will happily charge whatever it's told. The price has to come from your server.",
    whyAiToolsProduceIt:
      'The quickest way to build checkout is to send the cart, prices included, from the page to the server and pass it straight to Stripe. It works perfectly in testing, because nobody testing their own app edits the request.',
    howItIsExploited:
      "Someone opens your checkout, changes the price in their browser's developer tools or in the request itself, and pays a cent for something that costs hundreds. The order looks paid, so your app delivers it.",
    realCase: {
      summary:
        "In 2026, a WordPress booking plugin was found passing the amount from the visitor's request straight to Stripe. Anyone could book services for $0.01 instead of $500.",
      source: 'NVD (CVE-2026-4911)',
      url: 'https://nvd.nist.gov/vuln/detail/CVE-2026-4911',
    },
    owasp: ['A04:2021 Insecure Design'],
    cwe: ['CWE-602', 'CWE-472'],
  },
  'payments:success-page-unlocks': {
    whatItIs:
      'After paying, Stripe sends the customer to your success page. If that page is what marks the order paid or unlocks the paid plan, then visiting the page is all it takes. Anyone can type its address without paying.',
    whyAiToolsProduceIt:
      "Unlocking features on the success page is the simplest flow to build and the easiest to test: pay with a test card, land on the page, and everything works. Setting up a webhook is an extra step that's easy to skip.",
    howItIsExploited:
      'Someone finds your success page address, from the page itself or by guessing a common one like /success, opens it while signed in, and gets the paid plan or the order for free.',
    owasp: ['A04:2021 Insecure Design', 'A01:2021 Broken Access Control'],
    cwe: ['CWE-602', 'CWE-840'],
  },
  'payments:unverified-webhook': {
    whatItIs:
      "A webhook is the address Stripe calls to tell your server a payment happened. Anyone on the internet can call that address too, so Stripe signs every message, and your code has to check the signature before believing it. This webhook doesn't.",
    whyAiToolsProduceIt:
      'Checking the signature needs the raw request body and a secret from the Stripe dashboard, and frameworks often parse the body first, which makes the check fail. A common AI fix is to drop the check so the webhook starts working.',
    howItIsExploited:
      'Someone sends your webhook a made-up "checkout completed" message with their own account in it. Your app believes it and unlocks the paid plan, adds credits, or marks an order paid, without any money changing hands.',
    realCase: {
      summary:
        "In 2026, New API, open-source software for selling access to AI models, was found to accept fake Stripe payment messages by default, because its webhook secret was empty. Anyone could give themselves unlimited AI usage without paying, at the operator's expense.",
      source: 'GitHub Advisory Database (CVE-2026-41432)',
      url: 'https://github.com/advisories/GHSA-xff3-5c9p-2mr4',
    },
    owasp: ['A08:2021 Software and Data Integrity Failures'],
    cwe: ['CWE-345', 'CWE-347'],
  },
} satisfies Record<`payments:${string}`, Lesson>;
