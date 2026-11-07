import type { ScanReport } from '@soundcheck/report';
import { pool } from './pool';

export type ScanStatus = 'queued' | 'running' | 'done' | 'failed';

/** A check the worker plans to run, so the scan page can list it before it finishes. */
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
 * `requester` is a keyed hash of the visitor's IP, never the IP itself.
 */
export async function createScan(
  url: string,
  requester?: string,
): Promise<string> {
  const { rows } = await pool().query<{ id: string }>(
    'insert into scans (url, requester) values ($1, $2) returning id',
    [url, requester ?? null],
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

/** How many scans are waiting in line before this one. */
export async function scansAhead(scan: Scan): Promise<number> {
  const { rows } = await pool().query<{ count: string }>(
    "select count(*) from scans where status = 'queued' and requested_at < $1",
    [scan.requestedAt],
  );
  return Number(rows[0]?.count ?? 0);
}

// ---- Limits, used by the website before queueing a scan ----

/** A scan of this exact link from the last few minutes that didn't fail, newest first. */
export async function findRecentScan(
  url: string,
  withinMinutes: number,
): Promise<string | undefined> {
  const { rows } = await pool().query<{ id: string }>(
    `select id from scans
     where url = $1 and status <> 'failed'
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

export async function countQueuedScans(): Promise<number> {
  const { rows } = await pool().query<{ count: string }>(
    "select count(*) from scans where status = 'queued'",
  );
  return Number(rows[0]?.count ?? 0);
}

// ---- The worker's side of the queue ----

/**
 * Takes the oldest queued scan and marks it running, or returns undefined if none are
 * waiting. `skip locked` means two workers asking at once never get the same scan.
 */
export async function claimNextScan(): Promise<Scan | undefined> {
  const { rows } = await pool().query<ScanRow>(
    `update scans set status = 'running', started_at = now()
     where id = (
       select id from scans where status = 'queued'
       order by requested_at for update skip locked limit 1
     )
     returning ${COLUMNS}`,
  );
  return rows[0] && fromRow(rows[0]);
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

/** Puts a scan back in line, for when the worker stops partway through. */
export async function requeueScan(id: string): Promise<void> {
  await pool().query(
    `update scans set status = 'queued', started_at = null, checks = '[]', report = null
     where id = $1 and status = 'running'`,
    [id],
  );
}

/** Fails scans left running by a worker that crashed. Returns how many it found. */
export async function failStuckScans(
  olderThanMinutes: number,
): Promise<number> {
  const { rowCount } = await pool().query(
    `update scans set status = 'failed', finished_at = now(),
       failure = 'This scan stopped before it finished. Try scanning again.'
     where status = 'running' and started_at < now() - make_interval(mins => $1)`,
    [olderThanMinutes],
  );
  return rowCount ?? 0;
}

/** Closes the connection pool, so a script or worker can exit cleanly. */
export async function closeDatabase(): Promise<void> {
  await pool().end();
}
