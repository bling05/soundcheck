import type { Lesson } from '../types';

export const SUPABASE_STORAGE_LESSONS = {
  'supabase-storage:listable-bucket': {
    whatItIs:
      "Supabase keeps uploaded files, like profile photos and documents, in storage buckets. Rules on each bucket say who can see which files. This bucket let us list the names of the files in it with nothing but the public key in your site's code.",
    whyAiToolsProduceIt:
      'When an upload or image fails because of a storage rule, a common AI fix is to add a rule that lets everyone read the whole bucket. That makes the error go away, and also lets anyone list every file. Making a bucket "Public" so images load is often fine on its own; the problem is the extra rule that lets anyone list it.',
    howItIsExploited:
      "Anyone can copy the public key from your site and ask for the full list of files, then download each one. They don't need to guess any file names. If people upload IDs, documents, or private photos, those are all exposed at once.",
    realCase: {
      summary:
        'In July 2025, the Tea dating safety app left a storage bucket open. About 72,000 images leaked, including around 13,000 selfies and photo IDs that users had uploaded to verify their accounts.',
      source: 'The Record',
      url: 'https://therecord.media/tea-app-data-breach-stolen-ids-leaked',
    },
    owasp: ['A01:2021 Broken Access Control'],
    cwe: ['CWE-284', 'CWE-552'],
  },
} satisfies Record<`supabase-storage:${string}`, Lesson>;
