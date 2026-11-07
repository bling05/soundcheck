export type ScanUrlResult =
  { ok: true; url: string } | { ok: false; message: string };

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * Turns what someone typed into the link we scan, or says what's wrong with it in words
 * they can act on. People often leave off `https://`, so it's added for them.
 *
 * The query string and #fragment are dropped: they can hold tokens, and scan links can be
 * shared. This is only a first pass for helpful messages. The request guard still checks
 * every address before anything is visited.
 */
export function parseScanUrl(input: string): ScanUrlResult {
  const text = input.trim();
  if (text === '') return { ok: false, message: "Enter your app's link." };

  let url: URL;
  try {
    url = new URL(HAS_SCHEME.test(text) ? text : `https://${text}`);
  } catch {
    return { ok: false, message: "That doesn't look like a link." };
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, message: 'Only http and https links can be scanned.' };
  }
  if (url.username || url.password) {
    return {
      ok: false,
      message: 'Links with a username or password in them cannot be scanned.',
    };
  }
  if (url.port !== '') {
    return { ok: false, message: 'Only ports 80 and 443 can be scanned.' };
  }
  if (!url.hostname.includes('.') || url.hostname.endsWith('.')) {
    return {
      ok: false,
      message: "Enter your app's full address, like your-app.com.",
    };
  }

  url.search = '';
  url.hash = '';
  return { ok: true, url: url.href };
}
