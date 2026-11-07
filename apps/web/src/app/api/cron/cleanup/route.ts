import { timingSafeEqual } from 'node:crypto';
import { deleteExpiredData, failStuckScans } from '@soundcheck/db';
import { describeError } from '../../../../server/run-scan';

/** Scans unfinished this long were cut off, so they're marked failed. */
const STUCK_AFTER_MINUTES = 10;

/**
 * True only for Vercel's scheduler, which sends `Authorization: Bearer <CRON_SECRET>`.
 * Without the secret set, nothing is allowed, so a missing setting can't open this up.
 */
function isScheduler(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Runs once a day (see vercel.json): deletes expired scans and old visitor codes. */
export async function GET(request: Request): Promise<Response> {
  if (!isScheduler(request)) {
    return new Response('Not allowed.', { status: 401 });
  }
  try {
    const stuck = await failStuckScans(STUCK_AFTER_MINUTES);
    const removed = await deleteExpiredData();
    return Response.json({ stuck, ...removed });
  } catch (error) {
    console.error('Cleanup failed:', describeError(error));
    return new Response('Cleanup failed.', { status: 500 });
  }
}
