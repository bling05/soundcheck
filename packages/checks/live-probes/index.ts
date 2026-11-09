import {
  findingId,
  sortBySeverity,
  withUniqueIds,
  type Finding,
  type ManualFix,
} from '@soundcheck/report';
import { readSite } from '../site-files';
import { findSupabaseProject } from '../supabase-rls/rules';
import type { Check, CheckContext, CheckResult } from '../types';
import { inBatches } from '../in-batches';
import {
  API_PATHS,
  isFileParam,
  probeApi,
  probeSignup,
  probeSqlError,
  probeTraversal,
  probeXss,
  xssMarker,
  type ProbeFinding,
  type ProbeKind,
} from './probes';
import { findTargets } from './targets';

const CHECK_ID = 'live-probes';
// A few requests at a time, so the site never sees a burst.
const AT_ONCE = 3;

const CONTENT: Record<
  ProbeKind,
  {
    title: string;
    severity: Finding['severity'];
    fix: ManualFix;
    request: string;
  }
> = {
  'reflected-xss': {
    title: 'Your site puts text from the address back into the page as HTML',
    severity: 'high',
    fix: {
      description:
        "Never put text from the address, a form, or anyone else into a page as HTML. Let your framework escape it (React, Vue, and Svelte do by default), and don't use dangerouslySetInnerHTML, v-html, innerHTML, or a template's raw output on it.",
      language: 'tsx',
      snippet: `// Escaped by React: shows <b> as text, never runs it.\n<p>Results for {query}</p>\n\n// Not escaped. Don't do this with anything a visitor sent.\n<p dangerouslySetInnerHTML={{ __html: query }} />`,
    },
    request:
      "puts text from the address back into the page as raw HTML. Find every place that shows a URL parameter or form value on the page, and make sure it's escaped, using the framework's normal text output instead of dangerouslySetInnerHTML, v-html, innerHTML, or unescaped template output.",
  },
  'sql-error': {
    title: 'Your site shows database errors when sent a quote mark',
    severity: 'high',
    fix: {
      description:
        'Never build a database query by pasting in text from a request. Use parameters (placeholders), which your database library fills in safely, or a query builder or ORM. Also stop showing raw errors to visitors: log them and show a plain message.',
      language: 'ts',
      snippet: `// Unsafe: the visitor's text becomes part of the SQL.\ndb.query(\`SELECT * FROM products WHERE name = '\${search}'\`);\n\n// Safe: the text is sent separately and can't change the query.\ndb.query('SELECT * FROM products WHERE name = $1', [search]);`,
    },
    request:
      "shows a database error when a quote mark is added to a parameter, which suggests SQL built from request text. Find the query that uses this parameter and every other query built by joining strings, and switch them to parameterized queries or the ORM. Also make errors show a generic message instead of the database's error text.",
  },
  'path-traversal': {
    title: 'Anyone can read files from your server',
    severity: 'critical',
    fix: {
      description:
        "Don't use a request parameter as a file path. Map it to a fixed list of allowed files instead, or, if you must use it, resolve the full path and refuse anything outside the folder it belongs in.",
      language: 'ts',
      snippet: `import path from 'node:path';\n\nconst base = path.resolve('public/docs');\nconst file = path.resolve(base, requested);\nif (!file.startsWith(base + path.sep)) {\n  return new Response('Not found', { status: 404 });\n}`,
    },
    request:
      'returned a server system file when a file parameter was given "../" paths. Find the code that reads files using this parameter, and change it to only serve files from an allowed list or from inside one folder, refusing anything that resolves outside it. Then remind me to replace any passwords or keys stored in files on that server, since they may have been read.',
  },
  'open-api': {
    title: "Your API lists people's details to anyone",
    severity: 'critical',
    fix: {
      description:
        'Require a signed-in user on this route, and only return what that user is allowed to see: usually their own record, or nothing unless they are an admin. Never return passwords or password hashes at all.',
      language: 'ts',
      snippet: `export async function GET() {\n  const session = await auth();\n  if (!session?.user) return new Response('Unauthorized', { status: 401 });\n  if (session.user.role !== 'admin') return new Response('Forbidden', { status: 403 });\n  const users = await db.user.findMany({ select: { id: true, name: true } });\n  return Response.json(users);\n}`,
    },
    request:
      "returns a list of people's details to anyone, without signing in. Make this route require a signed-in user, return only what that user may see (their own record, or the list only for admins), and never return passwords or password hashes. Check every other API route that returns records for the same problem.",
  },
  'open-signup': {
    title: 'Anyone can create an account without confirming their email',
    severity: 'medium',
    fix: {
      description:
        'In Supabase, open Authentication, then Sign In / Providers, and turn on Confirm email. If the app is invite-only, turn off Allow new users to sign up. Then check your security rules: any rule that allows every signed-in user is open to anyone who signs up.',
      language: 'text',
      snippet:
        'Supabase dashboard > Authentication > Sign In / Providers\n  Confirm email: on\n  Allow new users to sign up: off, if only invited people should use the app',
    },
    request:
      'lets anyone create a working account instantly, with no email confirmation. Find every database rule (RLS policy) and route that allows any signed-in user, and tell me which data they expose, since anyone can sign up. Then remind me to turn on email confirmation in the Supabase dashboard, or turn off sign-ups if the app is invite-only.',
  },
};

function findingFor(found: ProbeFinding): Finding {
  const { title, severity, fix, request } = CONTENT[found.kind];
  const where = found.param ? `${found.url}?${found.param}=` : found.url;
  return {
    id: findingId(CHECK_ID, found.kind, where),
    checkId: CHECK_ID,
    title,
    severity,
    source: 'live',
    ...(found.kind === 'path-traversal' && {
      safetyStep:
        'Assume any password or key stored in a file on that server has been read, and replace them.',
    }),
    evidence: [{ kind: 'url', url: where, detail: found.detail }],
    lessonId: `${CHECK_ID}:${found.kind}`,
    manualFix: fix,
    aiFix: { problem: title, request: `${where} ${request}` },
  };
}

async function run(context: CheckContext): Promise<CheckResult> {
  if (!context.url) {
    return {
      status: 'skipped',
      reason: 'This check needs a link to your site.',
    };
  }
  const site = await readSite(context.url, context.fetch);
  if (!site.ok) return { status: 'skipped', reason: site.message };
  const home = site.files[0];
  const targets = findTargets(home?.text ?? '', site.url);
  const marker = xssMarker();

  const tasks: (() => Promise<ProbeFinding | undefined>)[] = [];
  for (const target of targets) {
    for (const param of target.params) {
      tasks.push(() => probeXss(target, param, context.fetch, marker));
      tasks.push(() => probeSqlError(target, param, context.fetch));
      if (isFileParam(param))
        tasks.push(() => probeTraversal(target, param, context.fetch));
    }
  }
  const origin = new URL(site.url).origin;
  for (const path of API_PATHS)
    tasks.push(() => probeApi(origin, path, context.fetch));
  const project = findSupabaseProject(site.files);
  if (project) tasks.push(() => probeSignup(project, context.fetch));

  const found = await inBatches(tasks, AT_ONCE, (task) => task());
  const findings = withUniqueIds(
    found
      .filter((item): item is ProbeFinding => item !== undefined)
      .map(findingFor),
  );
  return { status: 'ran', findings: sortBySeverity(findings) };
}

export const liveProbes: Check = {
  id: CHECK_ID,
  title: 'Common attacks, tried safely',
  mode: 'url-active',
  platforms: 'all',
  run,
};
