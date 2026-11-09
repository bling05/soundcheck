import type { RepoFile } from '../repo';
import type { RouteProblem } from './types';

/**
 * Any sign the code knows who is asking: a session, an auth helper, or a user id. Supabase
 * clients made from the visitor's cookies count too, because RLS then checks the owner.
 */
const KNOWS_THE_USER =
  /\b(?:getServerSession|getSession|auth\(\)|currentUser|getUser|getAuth|getToken|verifyToken|jwt\.verify|requireAuth|requireUser|withAuth|isAuthenticated|session|userId|user_id|ownerId|owner_id|authorId|author_id|req\.user|request\.user|ctx\.user|locals\.user|createServerClient|createRouteHandlerClient|createServerComponentClient)\b/;
// Reading or changing one record: Prisma, Drizzle, Mongoose, Sequelize, Supabase, or SQL.
const DATABASE_CALL =
  /\.(?:findUnique|findUniqueOrThrow|findFirst|findOne|findById|findByPk|findByIdAndUpdate|findByIdAndDelete|update|updateOne|upsert|delete|deleteOne|destroy|eq|match)\s*\(|\bwhere\s*[:(]|\b(?:select|update|delete)\b[^;\n]*\bwhere\b/i;
const WRITES =
  /\.(?:update|updateOne|upsert|delete|deleteOne|destroy|findByIdAndUpdate|findByIdAndDelete)\s*\(|\b(?:update|delete)\b[^;\n]*\bwhere\b|export\s+(?:async\s+)?function\s+(?:PUT|PATCH|DELETE)\b/i;

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

/** The first line that reads or changes a record using one of the address's ids. */
function lookupWith(text: string, ids: readonly string[]): number | undefined {
  const lines = text.split('\n');
  for (const [index, line] of lines.entries()) {
    if (!DATABASE_CALL.test(line)) continue;
    if (ids.some((id) => new RegExp(`\\b${id}\\b`).test(line)))
      return index + 1;
  }
  return undefined;
}

function knowsTheUser(code: string): boolean {
  return KNOWS_THE_USER.test(code);
}

/** The folder name before the id, like `orders` in `app/api/orders/[id]/route.ts`. */
function thingFrom(segments: readonly string[], idIndex: number): string {
  for (let index = idIndex - 1; index >= 0; index--) {
    const segment = segments[index] ?? '';
    if (
      segment &&
      !segment.startsWith('[') &&
      !segment.startsWith('(') &&
      segment !== 'api'
    ) {
      return segment;
    }
  }
  return 'record';
}

function nextRoute(path: string, text: string): RouteProblem | undefined {
  const appRoute = /(?:^|\/)app\/(.+)\/route\.(?:t|j)sx?$/.exec(path);
  const pagesRoute = /(?:^|\/)pages\/(api\/.+)\.(?:t|j)sx?$/.exec(path);
  const route = appRoute?.[1] ?? pagesRoute?.[1];
  if (!route) return undefined;
  const segments = route.split('/');
  const idIndex = segments.findIndex((segment) => /^\[\w+\]$/.test(segment));
  if (idIndex === -1) return undefined;
  const ids = segments
    .filter((segment) => /^\[\w+\]$/.test(segment))
    .map((segment) => segment.slice(1, -1));
  if (knowsTheUser(text)) return undefined;
  const line = lookupWith(text, ids);
  if (line === undefined) return undefined;
  return {
    framework: 'nextjs',
    route: `/${route}`,
    thing: thingFrom(segments, idIndex),
    write: WRITES.test(text),
    place: { path, line },
  };
}

// `router.get('/orders/:id', ...)` and `app.delete("/api/notes/:noteId", ...)`.
const EXPRESS_ROUTE =
  /\b(?:app|router|api|routes)\.(get|put|patch|delete|post)\(\s*['"`]([^'"`]*:\w+[^'"`]*)['"`]/g;

function expressRoutes(path: string, text: string): RouteProblem[] {
  const problems: RouteProblem[] = [];
  const routes = [...text.matchAll(EXPRESS_ROUTE)];
  for (const [index, match] of routes.entries()) {
    const verb = match[1] ?? 'get';
    const address = match[2] ?? '';
    const handler = text.slice(
      match.index,
      routes[index + 1]?.index ?? text.length,
    );
    if (knowsTheUser(handler)) continue;
    const ids = [...address.matchAll(/:(\w+)/g)].map((id) => id[1] ?? '');
    const line = lookupWith(
      handler,
      ids.flatMap((id) => [id, `params\\.${id}`]),
    );
    if (line === undefined) continue;
    const segments = address.split('/').filter(Boolean);
    const idIndex = segments.findIndex((segment) => segment.startsWith(':'));
    problems.push({
      framework: 'express',
      route: `${verb.toUpperCase()} ${address}`,
      thing: thingFrom(segments, idIndex),
      write: verb !== 'get',
      place: { path, line: lineOf(text, match.index) + line - 1 },
    });
  }
  return problems;
}

/** Next.js and Express routes that load a record by id without knowing who is asking. */
export function findJavaScriptProblems(
  files: readonly RepoFile[],
): RouteProblem[] {
  const problems: RouteProblem[] = [];
  for (const { path, text } of files) {
    if (!/\.(?:t|j)sx?$|\.m[jt]s$/.test(path) || /\.(?:test|spec)\./.test(path))
      continue;
    const next = nextRoute(path, text);
    if (next) problems.push(next);
    else if (/\bexpress\b/.test(text))
      problems.push(...expressRoutes(path, text));
  }
  return problems;
}
