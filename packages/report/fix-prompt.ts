import type { AiTool, Technology } from '@soundcheck/shared';
import { describeStack } from './stack';
import type { Finding } from './types';

const TOOL_NAMES: Record<AiTool, string> = {
  lovable: 'Lovable',
  cursor: 'Cursor',
  bolt: 'Bolt',
  claude: 'Claude',
};

/**
 * Builds one ready-to-paste prompt covering every finding, in the order given.
 * Built from fixed text. No AI writes or judges any part of this.
 */
export function buildFixPrompt(
  findings: readonly Finding[],
  tool?: AiTool,
  stack: readonly Technology[] = [],
): string {
  const project = tool ? `this ${TOOL_NAMES[tool]} project` : 'this project';
  const intro =
    findings.length === 1
      ? `You're helping me fix a security issue in ${project}. A scan found it.`
      : `You're helping me fix ${findings.length} security issues in ${project}. A scan found them. Fix them in this order.`;

  const fixes = findings.map(
    ({ aiFix }, index) => `${index + 1}. ${aiFix.problem}.\n${aiFix.request}`,
  );

  return [
    intro,
    ...(stack.length > 0
      ? [
          `The scan detected ${describeStack(stack)}. Check this against the project, and tell me if it's wrong.`,
        ]
      : []),
    ...fixes,
    "Don't change anything else. If something stops you from doing one of these, like my hosting not allowing it, tell me which one instead of working around it, then carry on with the rest.",
  ].join('\n\n');
}
