import { findingId, type Evidence, type Finding } from '@soundcheck/report';
import type { GuardedFetch, GuardedFetchResult } from '../request-guard';
import { readSite, type SiteFile } from '../site-files';
import type { Check, CheckContext, CheckResult } from '../types';
import { RULE_CONTENT } from './content';
import {
  countEnvSettings,
  findDebugOutput,
  readApiDocs,
  type DebugKind,
  findSourceMap,
  matchesProbe,
  PROBES,
  readSourceMap,
  type LeftoverRuleId,
  type SourceMapContents,
} from './rules';

const CHECK_ID = 'leftover-files';
const MAX_EVIDENCE = 5;
// Enough to recognize any of these files. A leftover database copy can be huge, and we
// never need the rest of it.
const PROBE_MAX_BYTES = 64 * 1024;
// Code files without a source map comment can still have a map next to them. Guessing
// for a few is enough to tell whether the build makes them.
const MAX_GUESSED_MAPS = 5;
const MAX_MAP_REQUESTS = 10;

const PARTIAL =
  "Some of the files we look for didn't load, so there could be leftover files we didn't see.";

type Answer = Extract<GuardedFetchResult, { ok: true }>;

/**
 * Whether we got a real answer. Too many requests and server errors say nothing about the
 * file, so those count as unchecked rather than missing.
 */
function answered(response: GuardedFetchResult): response is Answer {
  return response.ok && response.status !== 429 && response.status < 500;
}

/** A redirect to another site isn't this site's file. */
function isOnSite(response: Answer, hostname: string): boolean {
  return response.status < 300 && new URL(response.url).hostname === hostname;
}

interface Found {
  rule: LeftoverRuleId;
  evidence: Evidence;
}

function probeDetail(
  rule: Exclude<LeftoverRuleId, 'source-map'>,
  body: Buffer,
): string {
  switch (rule) {
    case 'env-file': {
      const settings = countEnvSettings(body.toString());
      return `This file is public and holds ${settings} ${settings === 1 ? 'setting' : 'settings'}.`;
    }
    case 'git-folder':
      return 'This file is public, so the rest of the .git folder probably is too.';
    case 'database-dump':
      return 'This file is public and looks like a copy of a database.';
    case 'site-archive':
      return 'This file is public and is a zip archive.';
    case 'debug-page': {
      const kind = findDebugOutput(body.toString());
      return kind ? DEBUG_DETAIL[kind] : 'This page shows debug information.';
    }
    case 'api-docs': {
      const docs = readApiDocs(body.toString());
      if (docs?.kind === 'spec' && docs.addresses !== undefined) {
        return `This file is public and lists ${docs.addresses} of your API's addresses.`;
      }
      return docs?.kind === 'spec'
        ? "This file is public and lists your API's addresses."
        : 'This page shows your API documentation to anyone.';
    }
  }
}

const DEBUG_DETAIL: Record<DebugKind, string> = {
  phpinfo:
    "This page shows PHP's full settings, which can include passwords and keys.",
  django:
    "Your site's error page is in Django's debug mode, which shows settings and code to anyone.",
  laravel:
    "Your site's error page is Laravel's debug page, which shows code and settings to anyone.",
  rails:
    "Your site's error page is Rails' development page, which shows code and settings to anyone.",
  'spring-env':
    "This page lists your app's settings, which can include passwords and keys.",
  'vite-dev':
    "Your live site is running Vite's development server, which isn't built to be public.",
  'next-dev':
    "Your live site is running Next.js in development mode, which isn't built to be public.",
};

function mapDetail(contents: SourceMapContents): string {
  return contents === 'code'
    ? 'Anyone can read your original code from this file.'
    : 'This file lists your original file names, though not their code.';
}

async function probeFiles(
  origin: string,
  hostname: string,
  visit: GuardedFetch,
): Promise<{ found: Found[]; unchecked: number }> {
  const found: Found[] = [];
  let unchecked = 0;
  for (const { rule, path } of PROBES) {
    const url = `${origin}${path}`;
    const response = await visit(url, { maxBytes: PROBE_MAX_BYTES });
    if (!answered(response)) {
      unchecked++;
      continue;
    }
    // Debug pages usually show up as error pages, so for those an error answer counts.
    const onSite =
      rule === 'debug-page'
        ? new URL(response.url).hostname === hostname
        : isOnSite(response, hostname);
    if (onSite && matchesProbe(rule, response.body)) {
      found.push({
        rule,
        evidence: {
          kind: 'url',
          url,
          detail: probeDetail(rule, response.body),
        },
      });
    }
  }
  return { found, unchecked };
}

async function findSourceMaps(
  codeFiles: readonly SiteFile[],
  hostname: string,
  visit: GuardedFetch,
): Promise<{ found: Found[]; unchecked: number }> {
  const found: Found[] = [];
  let unchecked = 0;
  let requests = 0;
  let guesses = 0;
  const seen = new Set<string>();

  for (const file of codeFiles) {
    const reference = findSourceMap(file.text, file.location);
    if (reference?.kind === 'inline') {
      if (reference.contents) {
        found.push({
          rule: 'source-map',
          evidence: {
            kind: 'url',
            url: file.location,
            detail: `This file has its source map built in. ${mapDetail(reference.contents)}`,
          },
        });
      }
      continue;
    }

    let mapUrl = reference?.url;
    if (!mapUrl) {
      if (guesses >= MAX_GUESSED_MAPS) continue;
      guesses++;
      mapUrl = `${file.location}.map`;
    }
    if (seen.has(mapUrl) || new URL(mapUrl).hostname !== hostname) continue;
    seen.add(mapUrl);
    if (requests >= MAX_MAP_REQUESTS) {
      unchecked++;
      continue;
    }
    requests++;

    const response = await visit(mapUrl);
    if (!answered(response)) {
      unchecked++;
      continue;
    }
    const contents = isOnSite(response, hostname)
      ? readSourceMap(response.body.toString())
      : undefined;
    if (contents) {
      found.push({
        rule: 'source-map',
        evidence: { kind: 'url', url: mapUrl, detail: mapDetail(contents) },
      });
    }
  }
  return { found, unchecked };
}

/** One finding per kind of file, listing every place it was found. */
function toFindings(found: readonly Found[], context: CheckContext): Finding[] {
  const rules = [...new Set(found.map(({ rule }) => rule))];
  return rules.map((rule) => {
    const { title, severity, safetyStep, manualFix, fixRequest } =
      RULE_CONTENT[rule];
    const evidence = found
      .filter((item) => item.rule === rule)
      .map(({ evidence }) => evidence);
    const places = evidence
      .slice(0, MAX_EVIDENCE)
      .map((item) => (item.kind === 'url' ? new URL(item.url).pathname : ''))
      .join(', ');
    return {
      id: findingId(CHECK_ID, rule),
      checkId: CHECK_ID,
      title,
      severity,
      source: 'live',
      evidence: evidence.slice(0, MAX_EVIDENCE),
      lessonId: `${CHECK_ID}:${rule}`,
      manualFix: manualFix(context.technologies ?? []),
      ...(safetyStep && { safetyStep }),
      aiFix: { problem: `${title}. Found at ${places}`, request: fixRequest },
    };
  });
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
  if (site.status >= 400) {
    return {
      status: 'skipped',
      reason: `Your site answered with error ${site.status}, so we couldn't look for leftover files.`,
    };
  }

  const { origin, hostname } = new URL(site.url);
  const probes = await probeFiles(origin, hostname, context.fetch);
  const maps = await findSourceMaps(
    site.files.slice(1),
    hostname,
    context.fetch,
  );

  // The home page itself shows when a development server is live.
  const home = site.files[0];
  const devServer = home && findDebugOutput(home.text);
  const homeFound: Found[] =
    home && devServer && !probes.found.some(({ rule }) => rule === 'debug-page')
      ? [
          {
            rule: 'debug-page',
            evidence: {
              kind: 'url',
              url: home.location,
              detail: DEBUG_DETAIL[devServer],
            },
          },
        ]
      : [];

  const findings = toFindings(
    [...homeFound, ...probes.found, ...maps.found],
    context,
  );
  const partial =
    probes.unchecked + maps.unchecked > 0 || site.filesNotRead > 0;

  // Finding nothing after some files didn't load must never look like a pass.
  if (partial && findings.length === 0) {
    return { status: 'skipped', reason: PARTIAL };
  }
  return partial
    ? { status: 'ran', findings, note: PARTIAL }
    : { status: 'ran', findings };
}

export const leftoverFiles: Check = {
  id: CHECK_ID,
  title: 'Leftover files',
  mode: 'url-passive',
  platforms: 'all',
  run,
};
