import type { Lesson } from '../types';

const OWASP = ['A05:2021 Security Misconfiguration'];

export const LEFTOVER_FILES_LESSONS = {
  'leftover-files:env-file': {
    whatItIs:
      'A .env file holds the settings your app keeps private, such as database passwords and API keys. It should only exist on your computer and your server, never at a public link.',
    whyAiToolsProduceIt:
      "AI tools put keys in a .env file, which is the right place, but they don't always make sure the file stays out of what gets published. Moving files around or deploying a folder by hand can carry it onto the live site.",
    howItIsExploited:
      'Attackers run tools that ask huge numbers of sites for /.env, so a public one is usually found fast. It hands them every key and password your app uses, often including full access to your database.',
    owasp: OWASP,
    cwe: ['CWE-538'],
  },
  'leftover-files:git-folder': {
    whatItIs:
      "The .git folder is where Git keeps your project's full history. It belongs on your computer and on GitHub, not on your live site.",
    whyAiToolsProduceIt:
      'This usually happens when a whole project folder gets uploaded as it is, or the host publishes the project folder instead of the build folder. AI tools often suggest the quickest way to deploy without checking what ends up public.',
    howItIsExploited:
      'Free tools can download the folder and rebuild your project from it: every file, every past version, and every key that was ever saved in it, even ones you deleted later.',
    owasp: OWASP,
    cwe: ['CWE-527'],
  },
  'leftover-files:database-dump': {
    whatItIs:
      'A database dump is a file holding a full copy of a database, made for backups or for moving data. One was found at a public link on your site.',
    whyAiToolsProduceIt:
      "When you ask an AI tool to back up or move your data, it may save the copy in the project folder it's working in. If that folder gets published, the copy goes live too.",
    howItIsExploited:
      "Anyone who downloads it gets a copy of your data, such as your users' emails, without ever having to break into your database.",
    owasp: OWASP,
    cwe: ['CWE-530'],
  },
  'leftover-files:site-archive': {
    whatItIs:
      'This is a zip file of a project or backup, found at a public link on your site.',
    whyAiToolsProduceIt:
      'Zipping a project to download, share, or back it up can leave the zip inside the folder that gets published.',
    howItIsExploited:
      'Anyone who downloads it can unzip your source code, and often the .env file and other private settings that were in the folder when it was zipped.',
    owasp: OWASP,
    cwe: ['CWE-530'],
  },
  'leftover-files:source-map': {
    whatItIs:
      'Before your site goes live, build tools squash your code into a form that is hard to read. A source map is a file that turns it back into your original code, and it is meant for debugging.',
    whyAiToolsProduceIt:
      'Many build setups make source maps by default, and AI tools rarely turn them off for the live site, because the site works the same either way.',
    howItIsExploited:
      "Your site's code is public anyway, but squashed. With the source map, someone can read it the way it was written, with comments and file names, which makes it much easier to find weak spots, hidden pages, or keys left in comments.",
    owasp: OWASP,
    cwe: ['CWE-540'],
  },
} satisfies Record<`leftover-files:${string}`, Lesson>;
