import { describe, expect, it } from 'vitest';
import { buildFixPrompt } from './fix-prompt';
import type { Finding } from './types';

function finding(problem: string, request: string): Finding {
  return {
    id: `test:${problem}`,
    checkId: 'test',
    title: problem,
    severity: 'low',
    source: 'live',
    evidence: [],
    lesson: {
      whatItIs: '',
      whyAiToolsProduceIt: '',
      howItIsExploited: '',
      owasp: [],
      cwe: [],
    },
    manualFix: { description: '', language: 'text', snippet: '' },
    aiFix: { problem, request },
  };
}

const first = finding('First problem', 'Do the first thing.');
const second = finding('Second problem', 'Do the second thing.');

describe('buildFixPrompt', () => {
  it('covers every finding, numbered in the order given', () => {
    const prompt = buildFixPrompt([first, second]);

    expect(prompt).toContain('1. First problem.\nDo the first thing.');
    expect(prompt).toContain('2. Second problem.\nDo the second thing.');
    expect(prompt).toContain('2 security issues');
  });

  it('only tells the tool once not to change anything else, after every fix', () => {
    const prompt = buildFixPrompt([first, second]);

    expect(prompt.match(/Don't change anything else/g)).toHaveLength(1);
    expect(prompt.indexOf("Don't change")).toBeGreaterThan(
      prompt.indexOf('Do the second thing.'),
    );
  });

  it('uses the singular for one finding', () => {
    const prompt = buildFixPrompt([first]);

    expect(prompt).toContain('a security issue');
    expect(prompt).not.toContain('in this order');
  });

  it('names the detected tool', () => {
    expect(buildFixPrompt([first], 'bolt')).toContain('this Bolt project');
  });

  it('names the detected stack and asks the tool to check it', () => {
    const prompt = buildFixPrompt([first], undefined, ['nextjs', 'vercel']);

    expect(prompt).toContain('The scan detected Next.js and Vercel.');
    expect(prompt).toContain("tell me if it's wrong");
  });

  it('claims no stack when none was detected', () => {
    expect(buildFixPrompt([first])).not.toContain('The scan detected');
  });

  it('stays general when no tool was detected', () => {
    expect(buildFixPrompt([first])).toContain('in this project');
  });
});
