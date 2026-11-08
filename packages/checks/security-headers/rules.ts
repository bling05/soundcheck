import type { CookieCorsRuleId } from './cookies-cors';

export type HeaderRuleId =
  | 'content-security-policy'
  | 'strict-transport-security'
  | 'frame-protection'
  | 'content-type-options';

export type RuleId = HeaderRuleId | CookieCorsRuleId;

export interface Problem {
  rule: HeaderRuleId;
  /** The response header a report should point at. */
  header: string;
  /** Fixed wording, never the site's own header text. */
  detail: string;
}

type Headers = Record<string, string | string[] | undefined>;

// 180 days. Shorter than this and a returning visitor is often no longer protected.
const MIN_HSTS_SECONDS = 15_552_000;

const META_POLICY =
  /<meta\b[^>]*\bhttp-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/i;
const CONTENT_ATTRIBUTE = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

function headerText(headers: Headers, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value.join(', ') : value;
}

/** Reads a policy into directive name and sources, like `script-src` and `['self']`. */
function parsePolicy(policy: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const part of policy.split(/[;,]/)) {
    const [name, ...sources] = part.trim().toLowerCase().split(/\s+/);
    if (name && !directives.has(name)) directives.set(name, sources);
  }
  return directives;
}

/** A policy written into the page itself. It limits scripts, but browsers ignore frame rules there. */
function policyInPage(body: string): string | undefined {
  const tag = body.match(META_POLICY)?.[0];
  if (!tag) return undefined;
  const content = tag.match(CONTENT_ATTRIBUTE);
  return content?.[1] ?? content?.[2];
}

const ALLOWS_ANYTHING = new Set(['*', 'http:', 'https:']);

function allowsAnything(sources: readonly string[]): boolean {
  return sources.some((source) => ALLOWS_ANYTHING.has(source));
}

function checkScriptPolicy(headers: Headers, body: string): Problem | null {
  const header = 'content-security-policy';
  const policy = [headerText(headers, header), policyInPage(body)]
    .filter(Boolean)
    .join(',');

  if (!policy) {
    const detail = headerText(headers, `${header}-report-only`)
      ? 'This header is only in report-only mode, so it warns but blocks nothing.'
      : 'This header was not in the response.';
    return { rule: header, header, detail };
  }

  const directives = parsePolicy(policy);
  const scriptSources =
    directives.get('script-src') ?? directives.get('default-src');
  if (!scriptSources) {
    return {
      rule: header,
      header,
      detail:
        'This header is set, but it has no rule for which scripts can run.',
    };
  }
  if (allowsAnything(scriptSources)) {
    return {
      rule: header,
      header,
      detail: 'This header is set, but it lets scripts load from anywhere.',
    };
  }
  return null;
}

function checkTransportSecurity(headers: Headers): Problem | null {
  const rule = 'strict-transport-security';
  const value = headerText(headers, rule);
  if (!value) {
    return {
      rule,
      header: rule,
      detail: 'This header was not in the response.',
    };
  }

  const maxAge = value.match(/max-age\s*=\s*"?(\d+)/i)?.[1];
  if (maxAge === undefined || Number(maxAge) < MIN_HSTS_SECONDS) {
    return {
      rule,
      header: rule,
      detail: 'This header is set, but for less than 180 days.',
    };
  }
  return null;
}

/** The newer `frame-ancestors` rule wins over X-Frame-Options, so either can protect a site. */
function checkFrameProtection(headers: Headers): Problem | null {
  const rule = 'frame-protection';
  // Only the header counts here. Browsers ignore this rule in a policy inside the page.
  const policy = headerText(headers, 'content-security-policy') ?? '';
  const ancestors = parsePolicy(policy).get('frame-ancestors');
  if (ancestors) {
    if (!allowsAnything(ancestors)) return null;
    return {
      rule,
      header: 'content-security-policy',
      detail: 'The frame-ancestors rule lets any website embed this page.',
    };
  }

  const header = 'x-frame-options';
  const value = headerText(headers, header);
  if (!value) {
    return {
      rule,
      header,
      detail:
        'Neither this header nor a frame-ancestors rule was in the response.',
    };
  }
  const isValid = value
    .split(',')
    .every((part) =>
      ['deny', 'sameorigin'].includes(part.trim().toLowerCase()),
    );
  return isValid
    ? null
    : {
        rule,
        header,
        detail: 'This header is set to a value browsers do not enforce.',
      };
}

function checkContentTypeOptions(headers: Headers): Problem | null {
  const rule = 'content-type-options';
  const header = 'x-content-type-options';
  const value = headerText(headers, header);
  if (!value) {
    return { rule, header, detail: 'This header was not in the response.' };
  }
  return value.split(',')[0]?.trim().toLowerCase() === 'nosniff'
    ? null
    : {
        rule,
        header,
        detail: 'This header is set to something other than nosniff.',
      };
}

/** Same input, same answer. Returns problems in a fixed order. */
export function findProblems(headers: Headers, body: string): Problem[] {
  return [
    checkScriptPolicy(headers, body),
    checkTransportSecurity(headers),
    checkFrameProtection(headers),
    checkContentTypeOptions(headers),
  ].filter((problem) => problem !== null);
}
