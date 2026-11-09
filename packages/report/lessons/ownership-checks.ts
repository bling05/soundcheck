import type { Lesson } from '../types';

export const OWNERSHIP_CHECKS_LESSONS = {
  'ownership-checks:missing-owner-check': {
    whatItIs:
      "When your app shows or changes one record, like /api/orders/123, the id comes from the request, and anyone can change it. Checking that someone is signed in isn't enough: the code also has to check that order 123 belongs to them. This route doesn't seem to. It's called an IDOR, short for insecure direct object reference. We found it by reading your code, so it's a strong sign, not proof: your app may check ownership somewhere we couldn't see.",
    whyAiToolsProduceIt:
      'AI tools build the route that loads a record by id first, because that makes the feature work, and adding a login check feels like the security step. The ownership check is easy to leave out, because everything still works when you test with your own account.',
    howItIsExploited:
      "Someone signs up, opens one of their own records, and changes the number in the request to 124, 125, and so on. Each one shows, changes, or deletes another person's data. It takes no special tools, just the browser.",
    realCase: {
      summary:
        "In 2019, First American Financial's website let anyone see about 885 million mortgage and title documents, including bank account and Social Security numbers, by changing a digit in a document link. No login was needed.",
      source: 'KrebsOnSecurity',
      url: 'https://krebsonsecurity.com/2019/05/first-american-financial-corp-leaked-hundreds-of-millions-of-title-insurance-records/',
    },
    owasp: ['A01:2021 Broken Access Control'],
    cwe: ['CWE-639', 'CWE-862'],
  },
} satisfies Record<`ownership-checks:${string}`, Lesson>;
