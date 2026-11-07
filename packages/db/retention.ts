import { pool } from './pool';

/** Scans are deleted this long after they're requested, along with their reports. */
export const SCAN_RETENTION_DAYS = 14;
/** Visitor codes only matter for the hourly scan limit, so they're cleared much sooner. */
export const REQUESTER_RETENTION_HOURS = 24;

const DAY_MS = 24 * 60 * 60 * 1000;

/** When a scan and its report will be deleted. */
export function deletionDate(requestedAt: Date): Date {
  return new Date(requestedAt.getTime() + SCAN_RETENTION_DAYS * DAY_MS);
}

/**
 * Deletes expired scans and clears old visitor codes. Safe to run as often as you like.
 * Returns how many of each it removed.
 */
export async function deleteExpiredData(): Promise<{
  scans: number;
  requesters: number;
}> {
  const scans = await pool().query(
    'delete from scans where requested_at < now() - make_interval(days => $1)',
    [SCAN_RETENTION_DAYS],
  );
  const requesters = await pool().query(
    `update scans set requester = null
     where requester is not null and requested_at < now() - make_interval(hours => $1)`,
    [REQUESTER_RETENTION_HOURS],
  );
  return { scans: scans.rowCount ?? 0, requesters: requesters.rowCount ?? 0 };
}
