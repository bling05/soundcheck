import { findingId, type Evidence, type Finding } from '@soundcheck/report';
import { readSite } from '../site-files';
import type { Check, CheckContext, CheckResult } from '../types';
import { findNextVersion, holesIn, upgradeTarget, type Hit } from './version';

const CHECK_ID = 'nextjs-version';

function affectsThisSite(hit: Hit, appRouter: boolean): boolean {
  const { affectsDefault } = hit.advisory;
  return affectsDefault === 'app-router' ? appRouter : affectsDefault;
}

function holesText(count: number): string {
  return count === 1
    ? 'a known critical security hole'
    : `${count} known critical security holes`;
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

  const found = findNextVersion(site.files);
  if (!found) {
    return {
      status: 'skipped',
      reason:
        "We couldn't tell which version of Next.js your site uses from its code.",
    };
  }

  const hits = holesIn(found.version);
  const target = upgradeTarget(hits);
  if (!target) return { status: 'ran', findings: [] };

  const title = `Your site runs Next.js ${found.version}, which has ${holesText(hits.length)}`;
  const evidence: Evidence[] = [
    {
      kind: 'url',
      url: found.location,
      detail: `This file says your site runs Next.js ${found.version}.`,
    },
    ...hits.map(({ advisory, fixed }): Evidence => ({
      kind: 'url',
      url: `https://github.com/vercel/next.js/security/advisories/${advisory.ghsa}`,
      detail: `${advisory.summary} Published ${advisory.published}, fixed in ${fixed}.`,
    })),
  ];
  const finding: Finding = {
    // The same problem on every rescan, even after a partial update to another weak version.
    id: findingId(CHECK_ID, 'outdated'),
    checkId: CHECK_ID,
    title,
    severity: hits.some((hit) => affectsThisSite(hit, found.appRouter))
      ? 'critical'
      : 'high',
    source: 'live',
    evidence,
    lessonId: `${CHECK_ID}:outdated`,
    manualFix: {
      description: `Update Next.js to ${target} or newer, then build your site and check that it still works before publishing. Some of these holes only matter with certain setups, listed above, but updating fixes all of them.`,
      language: 'bash',
      snippet: `npm install next@${target}`,
    },
    aiFix: {
      problem: title,
      request: `Update Next.js to version ${target} or newer. If the app uses React Server Components, keep React on a version that matches what this Next.js release expects. Then run the build and fix anything the update breaks, without changing how the app behaves. Tell me which version you installed and anything you had to change.`,
    },
  };
  return { status: 'ran', findings: [finding] };
}

export const nextjsVersion: Check = {
  id: CHECK_ID,
  title: 'Outdated Next.js with known security holes',
  mode: 'url-passive',
  platforms: ['nextjs'],
  run,
};
