import { buildFixPrompt } from '../fix-prompt';
import { readSite } from '../site-files';
import type { Check, CheckContext, CheckResult } from '../types';
import { RULE_CONTENT } from './content';
import { findLeaks } from './rules';

const CHECK_ID = 'bundle-secrets';
const MAX_EVIDENCE_FILES = 5;

const REPLACE_KEY_FIRST =
  "Create a new key and delete this one. Removing it from your code isn't enough, because anyone who already copied it can keep using it until it's deleted.";

const PARTIAL_READ =
  "We couldn't read all of your site's code, so there could be more keys we didn't see.";

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
      reason: `Your site answered with error ${site.status}, so we couldn't read its code.`,
    };
  }

  const leaks = findLeaks(site.files);

  // Finding nothing after reading only part of a site must never look like a pass.
  if (!site.complete && leaks.length === 0) {
    return { status: 'skipped', reason: PARTIAL_READ };
  }

  const findings = leaks.map(({ rule, redacted, locations }) => {
    const { title, severity, lesson, manualFix, fixRequest } =
      RULE_CONTENT[rule];
    return {
      checkId: CHECK_ID,
      title,
      severity,
      source: 'live' as const,
      safetyStep: REPLACE_KEY_FIRST,
      evidence: locations.slice(0, MAX_EVIDENCE_FILES).map((url) => ({
        kind: 'url' as const,
        url,
        detail: `Found a key ending in ${redacted} in this file.`,
      })),
      lesson,
      manualFix,
      aiFixPrompt: buildFixPrompt(
        context.tool,
        `${title}. The key ends in ${redacted}`,
        fixRequest,
      ),
    };
  });

  return site.complete
    ? { status: 'ran', findings }
    : { status: 'ran', findings, note: PARTIAL_READ };
}

export const bundleSecrets: Check = {
  id: CHECK_ID,
  title: 'Secret keys in public code',
  mode: 'url-passive',
  platforms: 'all',
  run,
};
