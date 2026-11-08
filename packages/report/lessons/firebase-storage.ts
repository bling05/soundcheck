import type { Lesson } from '../types';

export const FIREBASE_STORAGE_LESSONS = {
  'firebase-storage:listable': {
    whatItIs:
      "Firebase Storage keeps uploaded files, like profile photos and documents. Its security rules say who can open, upload, and list which files. Yours let anyone list the files here, using only the public settings in your site's code.",
    whyAiToolsProduceIt:
      'When an upload or image fails because of a storage rule, a common AI fix is a rule that lets anyone read everything. That makes the error go away and lets anyone list every file too. Public images only need "get", which opens one file by its link, not "list".',
    howItIsExploited:
      "Anyone can ask for the full list of files and then download each one, without guessing a single name. If people upload IDs, documents, or private photos, they're all exposed at once.",
    realCase: {
      summary:
        "In July 2025, the Tea dating safety app's Firebase storage was left open. About 72,000 images leaked, including around 13,000 selfies and photo IDs that users had uploaded to verify their accounts.",
      source: 'The Record',
      url: 'https://therecord.media/tea-app-data-breach-stolen-ids-leaked',
    },
    owasp: ['A01:2021 Broken Access Control'],
    cwe: ['CWE-284', 'CWE-552'],
  },
} satisfies Record<`firebase-storage:${string}`, Lesson>;
