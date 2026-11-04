import type { AiTool } from '@soundcheck/shared';

const TOOL_NAMES: Record<AiTool, string> = {
  lovable: 'Lovable',
  cursor: 'Cursor',
  bolt: 'Bolt',
  claude: 'Claude',
};

/** Builds a ready-to-paste prompt from fixed text. No AI writes or judges any part of this. */
export function buildFixPrompt(
  tool: AiTool | undefined,
  problem: string,
  request: string,
): string {
  const intro = tool
    ? `You're helping me fix a security issue in this ${TOOL_NAMES[tool]} project.`
    : "You're helping me fix a security issue in this project.";

  return [
    intro,
    `A scan found this: ${problem}.`,
    request,
    "Don't change anything else. If something stops you from doing this, like my hosting not allowing it, tell me instead of working around it.",
  ].join('\n\n');
}
