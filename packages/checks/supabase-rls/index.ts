import { findingId, sortBySeverity, type Finding } from '@soundcheck/report';
import type { GuardedFetch } from '../request-guard';
import { readSite } from '../site-files';
import type { Check, CheckContext, CheckResult } from '../types';
import {
  detailFor,
  fixRequestFor,
  manualFixFor,
  SEVERITY,
  titleFor,
} from './content';
import {
  findSupabaseProject,
  findTableNames,
  rowCount,
  tableKind,
  type SupabaseProject,
} from './rules';

const CHECK_ID = 'supabase-rls';

type TableResult =
  | { table: string; state: 'readable'; rows: number }
  /** Answered, but no rows were visible: empty, or protected. We can't tell which. */
  | { table: string; state: 'no-rows' }
  | { table: string; state: 'protected' }
  | { table: string; state: 'not-a-table' }
  | { table: string; state: 'unknown' };

/**
 * Asks how many rows of a table the public key can see, and nothing else. A HEAD request
 * with `count=exact` returns only the total in a header, never any row data.
 */
async function countRows(
  project: SupabaseProject,
  table: string,
  fetch: GuardedFetch,
): Promise<TableResult> {
  const response = await fetch(
    `${project.url}/rest/v1/${encodeURIComponent(table)}?select=*`,
    {
      method: 'HEAD',
      headers: {
        apikey: project.key,
        ...(project.isToken && { authorization: `Bearer ${project.key}` }),
        prefer: 'count=exact',
      },
    },
  );
  if (!response.ok) return { table, state: 'unknown' };
  const { status } = response;
  if (status === 401 || status === 403) return { table, state: 'protected' };
  if (status === 404) return { table, state: 'not-a-table' };
  if (status !== 200 && status !== 206) return { table, state: 'unknown' };

  const header = response.headers['content-range'];
  const rows = rowCount(Array.isArray(header) ? header[0] : header);
  if (rows === undefined) return { table, state: 'unknown' };
  return rows > 0
    ? { table, state: 'readable', rows }
    : { table, state: 'no-rows' };
}

function findingFor(project: SupabaseProject, table: string, rows: number) {
  const kind = tableKind(table);
  const title = titleFor(table, kind);
  return {
    id: findingId(CHECK_ID, 'readable-table', table),
    checkId: CHECK_ID,
    title,
    severity: SEVERITY[kind],
    source: 'live',
    evidence: [
      {
        kind: 'url',
        url: `${project.url}/rest/v1/${table}`,
        detail: detailFor(rows),
      },
    ],
    lessonId: `${CHECK_ID}:readable-table`,
    manualFix: manualFixFor(table, kind),
    aiFix: { problem: title, request: fixRequestFor(table, kind) },
  } satisfies Finding;
}

function noteFor(results: readonly TableResult[]): string | undefined {
  const unclear = results.filter(
    ({ state }) => state === 'no-rows' || state === 'unknown',
  );
  if (unclear.length === 0) return undefined;
  const names = unclear.map(({ table }) => table).join(', ');
  const one = unclear.length === 1;
  return `We couldn't tell whether ${one ? 'this table is' : 'these tables are'} protected: ${names}. Either we couldn't see any rows, which can mean ${one ? "it's" : "they're"} empty rather than protected, or the database didn't answer.`;
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

  const project = findSupabaseProject(site.files);
  if (!project) {
    return {
      status: 'skipped',
      reason:
        "We couldn't find your Supabase project's address and public key in your site's code.",
    };
  }
  const tables = findTableNames(site.files);
  if (tables.length === 0) {
    return {
      status: 'skipped',
      reason: "We couldn't find which Supabase tables your site's code uses.",
    };
  }

  const results: TableResult[] = [];
  for (const table of tables) {
    results.push(await countRows(project, table, context.fetch));
  }

  const findings = sortBySeverity(
    results.flatMap((result) =>
      result.state === 'readable'
        ? [findingFor(project, result.table, result.rows)]
        : [],
    ),
  );
  const note = noteFor(results);

  // Nothing found while some tables were unclear must never look like a pass.
  if (findings.length === 0 && note) return { status: 'skipped', reason: note };
  return note ? { status: 'ran', findings, note } : { status: 'ran', findings };
}

export const supabaseRls: Check = {
  id: CHECK_ID,
  title: 'Supabase tables anyone can read',
  // Sends requests to the site's database, so it only runs for verified owners.
  mode: 'url-active',
  platforms: ['supabase'],
  run,
};
