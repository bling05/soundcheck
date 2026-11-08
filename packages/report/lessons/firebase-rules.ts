import type { Lesson, RealCase } from '../types';

const OWASP = ['A01:2021 Broken Access Control'];
const CWE = ['CWE-284', 'CWE-862'];

const FIREBASE_LEAKS: RealCase = {
  summary:
    'In 2024, researchers checked over 5 million websites and found about 900 whose Firebase security rules were missing or wrong. Together they exposed about 125 million records, including names, emails, phone numbers, and 20 million passwords.',
  source: 'The Register',
  url: 'https://www.theregister.com/2024/03/18/google_firebase_cloud_security/',
};

const WHY_TEST_MODE =
  'When you create a Firebase database, Firebase offers "test mode", which lets anyone read and change everything so you can build without errors. AI tools and tutorials often pick it, and when a rule blocks something later, a common AI fix is to loosen the rules until the error goes away.';

export const FIREBASE_RULES_LESSONS = {
  'firebase-rules:firestore-open': {
    whatItIs:
      "Firebase apps let the browser talk straight to the database, using public settings in your site's code. What keeps the data safe is your security rules, which say who can read and change what. Yours let anyone read every collection.",
    whyAiToolsProduceIt: WHY_TEST_MODE,
    howItIsExploited:
      'Anyone can copy the project settings from your site and download every collection with a few lines of code. Rules this open usually let them change or delete everything too. Test mode rules also stop working after 30 days, which can break your app without warning.',
    realCase: FIREBASE_LEAKS,
    owasp: OWASP,
    cwe: CWE,
  },
  'firebase-rules:readable-collection': {
    whatItIs:
      "Firebase apps let the browser talk straight to the database, using public settings in your site's code. What keeps the data safe is your security rules. The rule for this collection lets anyone read it, without signing in.",
    whyAiToolsProduceIt: WHY_TEST_MODE,
    howItIsExploited:
      'Anyone can copy the project settings from your site and download this whole collection. If the rule also allows writing, they can change or delete it.',
    realCase: FIREBASE_LEAKS,
    owasp: OWASP,
    cwe: CWE,
  },
  'firebase-rules:realtime-open': {
    whatItIs:
      "The Realtime Database is Firebase's older database, stored as one big tree of data. Its rules say who can read and change each part. These rules let anyone read it, without signing in.",
    whyAiToolsProduceIt: WHY_TEST_MODE,
    howItIsExploited:
      'Anyone can download it by adding .json to your database address. No code is needed, just a browser. Rules this open usually let them change or delete it too.',
    realCase: FIREBASE_LEAKS,
    owasp: OWASP,
    cwe: CWE,
  },
} satisfies Record<`firebase-rules:${string}`, Lesson>;
