import type { Finding } from '@soundcheck/report';
import type { Technology } from '@soundcheck/shared';
import { withoutQuery } from '../site-files';
import type { Check, CheckContext, CheckResult } from '../types';
import { RULE_CONTENT } from './content';
import { findProblems } from './rules';

const CHECK_ID = 'security-headers';

/** Names the file only when the stack makes it clear. Next.js settings work on any host, so they win. */
function whereToAddHeader(technologies: readonly Technology[] = []): string {
  if (technologies.includes('nextjs')) {
    return 'Add this header in the headers() section of your next.config file.';
  }
  if (technologies.includes('vercel')) {
    return 'Add this header in the "headers" section of your vercel.json file.';
  }
  return 'Add this header in your hosting or framework settings.';
}

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
        manualFix: {
          ...manualFix,
          description: `${whereToAddHeader(context.technologies)} ${manualFix.description}`,
        },
        aiFix: { problem: title, request: fixRequest },
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
