import { createHmac } from 'node:crypto';

/**
 * Anyone can type any link, so these stop Soundcheck being used to flood a site with
 * requests, which the site would see coming from us.
 */

/** Scans one visitor can start in an hour. */
export const SCANS_PER_VISITOR_PER_HOUR = 5;
/** A link scanned this recently reuses that scan instead of visiting the site again. */
export const RECENT_SCAN_MINUTES = 5;
/** Past this many unfinished scans, new ones are refused, so Soundcheck can't be used to
 * send a flood of requests all at once. */
export const MAX_ACTIVE_SCANS = 20;

/** Returns the message to show if a new scan isn't allowed, or undefined if it is. */
export function scanRefusal(counts: {
  byVisitorLastHour: number;
  active: number;
}): string | undefined {
  if (counts.byVisitorLastHour >= SCANS_PER_VISITOR_PER_HOUR) {
    return `You've started ${SCANS_PER_VISITOR_PER_HOUR} scans in the last hour, which is the limit for now. Try again a bit later.`;
  }
  if (counts.active >= MAX_ACTIVE_SCANS) {
    return 'Soundcheck is busy right now. Try again in a few minutes.';
  }
  return undefined;
}

/** The visitor's IP. Vercel sets these headers itself, so a visitor can't fake them there. */
export function visitorIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || headers.get('x-real-ip')?.trim() || 'unknown';
}

const DEVELOPMENT_SECRET = 'soundcheck-local-development-only';

/**
 * A code that stands for the visitor without storing their IP. It's keyed with a secret,
 * so even someone with the database can't work out the IP by trying every address.
 */
export function visitorKey(ip: string): string {
  const secret = process.env.SCAN_LIMIT_SECRET;
  if (!secret && process.env.NODE_ENV === 'production') {
    const error = new Error('SCAN_LIMIT_SECRET is not set.');
    error.name = 'MissingScanLimitSecret';
    throw error;
  }
  return createHmac('sha256', secret ?? DEVELOPMENT_SECRET)
    .update(ip)
    .digest('base64url');
}
