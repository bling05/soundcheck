/** What a scan is called on its page: the site's address, or the repo for a repo-only scan. */
export function scanTitle(scan: {
  url: string | null;
  repo: string | null;
}): string {
  if (scan.url) return new URL(scan.url).hostname;
  return scan.repo ?? 'Scan';
}
