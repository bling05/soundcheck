import type { Finding, ManualFix } from '@soundcheck/report';
import type { Technology } from '@soundcheck/shared';
import type { LeftoverRuleId } from './rules';

type RuleContent = Pick<Finding, 'title' | 'severity' | 'safetyStep'> & {
  manualFix: (technologies: readonly Technology[]) => ManualFix;
  /** What to ask an AI tool to change. */
  fixRequest: string;
};

const REDEPLOY_AND_CHECK =
  'Redeploy, then open the link again. It should show a not-found page.';

const fixed = (manualFix: ManualFix) => () => manualFix;

function sourceMapFix(technologies: readonly Technology[]): ManualFix {
  const description =
    'Turn off source maps for your live site, then redeploy. If you use them for error tracking, upload them to that service privately instead.';
  if (technologies.includes('nextjs')) {
    return {
      description: `${description} In Next.js this is a setting in next.config.`,
      language: 'ts',
      snippet: '// next.config\nproductionBrowserSourceMaps: false,',
    };
  }
  return {
    description: `${description} In Vite this is a setting in vite.config. Other build tools have a similar one.`,
    language: 'ts',
    snippet: '// vite.config\nbuild: { sourcemap: false },',
  };
}

// Severity reflects what someone gets by downloading the file. The first three can hand over
// keys or user data directly. A zip usually holds code, and a source map only makes public
// code easier to read.
export const RULE_CONTENT: Record<LeftoverRuleId, RuleContent> = {
  'env-file': {
    title: 'Your secret settings file (.env) is public',
    severity: 'critical',
    safetyStep:
      "Replace every key and password in this file, then delete the old ones. Hiding the file isn't enough, because anyone may already have downloaded it.",
    manualFix: fixed({
      description: `Delete the file from the folder your site is published from, often public or dist, and list it in .gitignore so it doesn't come back. ${REDEPLOY_AND_CHECK}`,
      language: 'gitignore',
      snippet: '.env\n.env.*\n!.env.example',
    }),
    fixRequest:
      "Find out why this app's .env file is being published with the site, for example because it's in the public folder or the build copies it, and stop that. Keep .env files out of every folder that gets deployed, and add .env and .env.* to .gitignore. Don't print or repeat anything inside the file. Then remind me that I still need to replace every key and password in it myself, because it was public.",
  },
  'git-folder': {
    title: "Your project's Git history is public",
    severity: 'critical',
    safetyStep:
      'Replace every key or password that has ever been in your code, even ones you deleted later, because old versions can be downloaded too.',
    manualFix: fixed({
      description: `Your host is publishing your whole project folder instead of just the built site. Set its publish folder to your build output, such as dist or build. If you upload files yourself, leave out the .git folder. ${REDEPLOY_AND_CHECK}`,
      language: 'text',
      snippet: 'Publish directory: dist',
    }),
    fixRequest:
      'This site is publishing its .git folder, so anyone can download its full code history. Change the deploy settings so only the build output, such as dist or build, gets published, and tell me exactly which setting you changed. Then remind me that I still need to replace every key that has ever been in this project, because the history was public.',
  },
  'database-dump': {
    title: 'A copy of your database is public',
    severity: 'critical',
    safetyStep:
      'Delete the file right away, and replace any passwords or keys it contains. Assume the data in it has been seen, and consider whether your users need to know.',
    manualFix: fixed({
      description: `Delete the file from your site's files, then redeploy. Keep backups in private storage, such as your database host's own backup feature, never in your site's folder. This finds any others in your project:`,
      language: 'bash',
      snippet: 'find . -name "*.sql" -not -path "./node_modules/*"',
    }),
    fixRequest:
      "A database backup file is being published with this site. Find every .sql file in the project outside node_modules, remove any that are backups or data exports from the published folders, and make sure the build can't copy them there again. Don't open, print, or repeat what's inside them. Then remind me to check whether my users' data was exposed.",
  },
  'site-archive': {
    title: 'A zip of your project is public',
    severity: 'high',
    manualFix: fixed({
      description: `Delete the zip from your site's files, then redeploy. This finds any others in your project:`,
      language: 'bash',
      snippet: 'find . -name "*.zip" -not -path "./node_modules/*"',
    }),
    fixRequest:
      "A zip file is being published with this site. Find every .zip file in the project outside node_modules, remove any that are backups or copies of the project from the published folders, and make sure the build can't copy them there again. If any of them could contain a .env file, remind me to replace the keys in it.",
  },
  // High: debug output often includes settings, keys, and code, but not always all of them.
  'debug-page': {
    title: 'Your site is showing developer debug information',
    severity: 'high',
    safetyStep:
      'If the page showed any passwords or keys, replace them, because anyone could have seen them.',
    manualFix: fixed({
      description: `Turn debug mode off for your live site, and delete any debug pages like phpinfo.php. If your live site is running a development server, such as vite dev or next dev, build the site and run the production version instead. ${REDEPLOY_AND_CHECK}`,
      language: 'text',
      snippet:
        'Django: DEBUG = False\nLaravel: APP_DEBUG=false\nVite: vite build, then serve the dist folder\nNext.js: next build, then next start',
    }),
    fixRequest:
      "This live site is showing developer debug information to anyone, such as a framework's debug error page, a phpinfo page, a settings page, or a development server. Turn debug mode off for production, delete any debug pages, and make sure production runs the built version of the app, not a development server. Keep debug mode for local development if it's useful. Tell me what you changed, and remind me to replace any keys the debug output showed.",
  },
  // Low: some APIs are meant to be public, so this asks the owner to check.
  'api-docs': {
    title: "Your API documentation is public. Check that's on purpose",
    severity: 'low',
    manualFix: fixed({
      description:
        "If your API isn't meant for other people to use, turn its documentation pages off on the live site, or put them behind a login. Either way, make sure every address it lists checks who is asking, since anyone can see the list.",
      language: 'text',
      snippet:
        'FastAPI: FastAPI(docs_url=None, redoc_url=None, openapi_url=None)\nExpress: only add swagger-ui-express when NODE_ENV is not "production"',
    }),
    fixRequest:
      "This site's API documentation, such as a Swagger, OpenAPI, or ReDoc page, is public. If this API isn't meant for outside developers, turn the documentation off in production or put it behind a login. Then go through every address it lists and make sure each one checks that the caller is signed in and allowed to do what they ask. Tell me which addresses didn't check, and what you changed.",
  },
  'source-map': {
    title: "Your site's source maps are public",
    severity: 'low',
    manualFix: sourceMapFix,
    fixRequest:
      "Turn off source maps for this app's production build, in whatever build tool it uses, so the live site no longer serves .map files. Keep them on for local development if they're useful. Tell me which setting you changed.",
  },
};
