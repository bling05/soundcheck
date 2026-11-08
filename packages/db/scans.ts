import type { ScanReport } from '@soundcheck/report';
import { pool } from './pool';

export type ScanStatus = 'queued' | 'running' | 'done' | 'failed';

/** A check the scan plans to run, so the scan page can list it before it finishes. */
export interface PlannedCheck {
  id: string;
  title: string;
}

export interface Scan {
  id: string;
  url: string;
  status: ScanStatus;
  checks: PlannedCheck[];
  /** Built up as each check finishes, and complete once the scan is done. */
  report: ScanReport | null;
  failure: string | null;
  requestedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

interface ScanRow {
  id: string;
  url: string;
  status: ScanStatus;
  checks: PlannedCheck[];
  report: ScanReport | null;
  failure: string | null;
  requested_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
}

const fromRow = (row: ScanRow): Scan => ({
  id: row.id,
  url: row.url,
  status: row.status,
  checks: row.checks,
  report: row.report,
  failure: row.failure,
  requestedAt: row.requested_at,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
});

// Never `select *`: the requester hash stays inside the database.
const COLUMNS =
  'id, url, status, checks, report, failure, requested_at, started_at, finished_at';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True if this could be a scan id. Anything else can't match a row, so skip the query. */
export function isScanId(id: string): boolean {
  return UUID.test(id);
}

/**
 * Queues a scan and returns its id. The url must already be cleaned with `parseScanUrl`.
 * `requester` is a keyed hash of the visitor's IP, never the IP itself. A `private` scan
 * is never shown to anyone who didn't start it, except through its own link.
 */
export async function createScan(
  url: string,
  requester?: string,
  options: { private?: boolean } = {},
): Promise<string> {
  const { rows } = await pool().query<{ id: string }>(
    'insert into scans (url, requester, private) values ($1, $2, $3) returning id',
    [url, requester ?? null, options.private ?? false],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('The database did not return a scan id.');
  return id;
}

export async function getScan(id: string): Promise<Scan | undefined> {
  if (!isScanId(id)) return undefined;
  const { rows } = await pool().query<ScanRow>(
    `select ${COLUMNS} from scans where id = $1`,
    [id],
  );
  return rows[0] && fromRow(rows[0]);
}

// ---- Limits, used by the website before queueing a scan ----

/**
 * A scan of this exact link from the last few minutes that didn't fail, newest first.
 * Private scans are never reused: they can hold an owner's database results.
 */
export async function findRecentScan(
  url: string,
  withinMinutes: number,
): Promise<string | undefined> {
  const { rows } = await pool().query<{ id: string }>(
    `select id from scans
     where url = $1 and status <> 'failed' and not private
       and requested_at > now() - make_interval(mins => $2)
     order by requested_at desc limit 1`,
    [url, withinMinutes],
  );
  return rows[0]?.id;
}

export async function countRecentScansBy(
  requester: string,
  withinMinutes: number,
): Promise<number> {
  const { rows } = await pool().query<{ count: string }>(
    `select count(*) from scans
     where requester = $1 and requested_at > now() - make_interval(mins => $2)`,
    [requester, withinMinutes],
  );
  return Number(rows[0]?.count ?? 0);
}

/** Scans that haven't finished yet, to cap how many run at once. */
export async function countActiveScans(): Promise<number> {
  const { rows } = await pool().query<{ count: string }>(
    "select count(*) from scans where status in ('queued', 'running')",
  );
  return Number(rows[0]?.count ?? 0);
}

// ---- Running a scan ----

/**
 * Marks a queued scan as running. Returns false if it had already started, so a scan can
 * never be run twice.
 */
export async function markRunning(id: string): Promise<boolean> {
  const { rowCount } = await pool().query(
    "update scans set status = 'running', started_at = now() where id = $1 and status = 'queued'",
    [id],
  );
  return rowCount === 1;
}

export async function setPlannedChecks(
  id: string,
  checks: PlannedCheck[],
): Promise<void> {
  await pool().query('update scans set checks = $2 where id = $1', [
    id,
    JSON.stringify(checks),
  ]);
}

/** Saves the report so far, so the scan page can show each check as it finishes. */
export async function saveProgress(
  id: string,
  report: ScanReport,
): Promise<void> {
  await pool().query(
    "update scans set report = $2 where id = $1 and status = 'running'",
    [id, JSON.stringify(report)],
  );
}

export async function finishScan(
  id: string,
  report: ScanReport,
): Promise<void> {
  await pool().query(
    "update scans set status = 'done', report = $2, finished_at = now() where id = $1",
    [id, JSON.stringify(report)],
  );
}

/** `failure` is shown to the user, so it must be plain words and never raw error text. */
export async function failScan(id: string, failure: string): Promise<void> {
  await pool().query(
    "update scans set status = 'failed', failure = $2, finished_at = now() where id = $1",
    [id, failure],
  );
}

/**
 * Fails scans that never finished, for example because the host cut the scan off at its
 * time limit. Without this their page would say "running" forever. Returns how many it found.
 */
export async function failStuckScans(
  olderThanMinutes: number,
): Promise<number> {
  const { rowCount } = await pool().query(
    `update scans set status = 'failed', finished_at = now(),
       failure = 'This scan stopped before it finished. Try scanning again.'
     where status in ('queued', 'running')
       and requested_at < now() - make_interval(mins => $1)`,
    [olderThanMinutes],
  );
  return rowCount ?? 0;
}

/**
 * Fails this one scan if it has gone unfinished for too long. Returns true if it did. The
 * time check happens in the database, so the scan page never has to read the clock.
 */
export async function failIfStuck(
  id: string,
  olderThanMinutes: number,
): Promise<boolean> {
  const { rowCount } = await pool().query(
    `update scans set status = 'failed', finished_at = now(),
       failure = 'This scan stopped before it finished. Try scanning again.'
     where id = $1 and status in ('queued', 'running')
       and requested_at < now() - make_interval(mins => $2)`,
    [id, olderThanMinutes],
  );
  return rowCount === 1;
}

/** Closes the connection pool, so a script can exit cleanly. */
export async function closeDatabase(): Promise<void> {
  await pool().end();
}
