import type { Finding } from '@soundcheck/report';
import { buildFixPrompt } from '../fix-prompt';
import { withoutQuery } from '../site-files';
import type { Check, CheckContext, CheckResult } from '../types';
import { RULE_CONTENT } from './content';
import { findProblems } from './rules';

const CHECK_ID = 'security-headers';

async function run(context: CheckContext): Promise<CheckResult> {
  if (!context.url) {
    return {
      status: 'skipped',
      reason: 'This check needs a link to your site.',
    };
  }

  const response = await context.fetch(context.url);
  if (!response.ok) return { status: 'skipped', reason: response.message };

  // An error page, like a block from a security service, isn't the page visitors get.
  // Its headers say nothing about the real site, so this can't count as a result.
  if (response.status >= 400) {
    return {
      status: 'skipped',
      reason: `Your site answered with error ${response.status}, so we couldn't see its normal headers.`,
    };
  }

  const url = withoutQuery(response.url);
  const findings = findProblems(response.headers, response.body.toString()).map(
    ({ rule, header, detail }): Finding => {
      const { title, severity, lesson, manualFix, fixRequest } =
        RULE_CONTENT[rule];
      return {
        checkId: CHECK_ID,
        title,
        severity,
        source: 'live',
        evidence: [{ kind: 'header', url, header, detail }],
        lesson,
        manualFix,
        aiFixPrompt: buildFixPrompt(context.tool, title, fixRequest),
      };
    },
  );

  return { status: 'ran', findings };
}

export const securityHeaders: Check = {
  id: CHECK_ID,
  title: 'Security headers',
  mode: 'url-passive',
  platforms: 'all',
  run,
};
