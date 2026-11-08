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
    realCase: {
      summary:
        "In 2024, attackers checked about 110,000 websites for public .env files, used the cloud keys inside to copy companies' data, and then demanded money not to leak it.",
      source: 'Unit 42, Palo Alto Networks',
      url: 'https://unit42.paloaltonetworks.com/large-scale-cloud-extortion-operation/',
    },
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
    realCase: {
      summary:
        "Researchers at Truffle Security found that 4,500 of the 1 million most visited websites had a public .git folder, and these often held the password to the project's code.",
      source: 'Truffle Security',
      url: 'https://trufflesecurity.com/blog/4500-of-the-top-1-million-websites-leaked-source-code-secrets',
    },
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
    realCase: {
      summary:
        "In 2016, a database file with the details of about 550,000 people who had signed up to give blood was left on the public web server of the Australian Red Cross Blood Service's website, where a stranger found it.",
      source: 'Office of the Australian Information Commissioner',
      url: 'https://www.oaic.gov.au/privacy/privacy-assessments-and-decisions/privacy-decisions/Investigation-inquiry-reports/donateblood.com.au-data-breach-australian-red-cross-blood-service',
    },
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
    realCase: {
      summary:
        'Security firm Sansec checked 2,037 online stores and found that 250 of them had left zip or other backup files in public folders, often holding database passwords and customer details.',
      source: 'TechRadar',
      url: 'https://www.techradar.com/news/many-online-stores-are-exposing-private-customer-data',
    },
    owasp: OWASP,
    cwe: ['CWE-530'],
  },
  'leftover-files:debug-page': {
    whatItIs:
      'Frameworks have a debug mode for building your site, which shows detailed errors, settings, and code when something goes wrong. Development servers, like vite dev or next dev, are for your own computer. One of these is on your live site.',
    whyAiToolsProduceIt:
      'Debug mode and development servers are what an AI tool sets up first, so you can see errors while building. Switching to the production setup is a separate step that is easy to skip, because the site seems to work either way.',
    howItIsExploited:
      'Attackers visit pages that cause an error, or the debug pages themselves, and read what comes back: settings, file paths, code, and sometimes passwords and keys. A development server can also hand out files it was never meant to share.',
    owasp: OWASP,
    cwe: ['CWE-489', 'CWE-215'],
  },
  'leftover-files:api-docs': {
    whatItIs:
      "API documentation pages, often made with Swagger, OpenAPI, or ReDoc, list every address your app's server answers, what each one expects, and often have buttons to try them out.",
    whyAiToolsProduceIt:
      'Many frameworks turn these pages on by default, and AI tools add them because they make testing easy. They rarely turn them off for the live site.',
    howItIsExploited:
      "It's a ready-made map for an attacker: every address, including ones your site never links to, and exactly how to call them. Any address that forgets to check who is asking is easy to find and try.",
    owasp: OWASP,
    cwe: ['CWE-200'],
  },
  'leftover-files:source-map': {
    whatItIs:
      'Before your site goes live, build tools squash your code into a form that is hard to read. A source map is a file that turns it back into your original code, and it is meant for debugging.',
    whyAiToolsProduceIt:
      'Many build setups make source maps by default, and AI tools rarely turn them off for the live site, because the site works the same either way.',
    howItIsExploited:
      "Your site's code is public anyway, but squashed. With the source map, someone can read it the way it was written, with comments and file names, which makes it much easier to find weak spots, hidden pages, or keys left in comments.",
    realCase: {
      summary:
        "In March 2026, Anthropic accidentally published a source map with its Claude Code tool, and anyone could use it to rebuild the tool's original source code, including features that hadn't been announced.",
      source: 'InfoQ',
      url: 'https://infoq.com/news/2026/04/claude-code-source-leak',
    },
    owasp: OWASP,
    cwe: ['CWE-540'],
  },
} satisfies Record<`leftover-files:${string}`, Lesson>;
