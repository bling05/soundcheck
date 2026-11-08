import { LESSONS } from '@soundcheck/report';
import { afterEach, describe, expect, it } from 'vitest';
import { startFixture, type RunningFixture } from '../../../fixtures/server';
import { testFetchFor } from '../request-guard/test-fetch';
import { browserAiCalls, findBrowserCalls } from './index';

let site: RunningFixture;
afterEach(() => site?.stop());

async function scanCode(code: string) {
  site = await startFixture({
    '/': { body: '<script src="/assets/app.js"></script><h1>Hi</h1>' },
    '/assets/app.js': { body: code },
  });
  return browserAiCalls.run({
    url: site.url,
    fetch: testFetchFor(site),
    platforms: [],
  });
}

const callsIn = (text: string) =>
  findBrowserCalls([{ location: 'a.js', text }]).map(
    ({ provider, allowedBrowser }) => [provider, allowedBrowser],
  );

describe('browser AI calls check against a fake site', () => {
  it('reports a site that calls OpenAI from the browser', async () => {
    const result = await scanCode(
      'new OpenAI({apiKey:k,dangerouslyAllowBrowser:!0,baseURL:"https://api.openai.com/v1"})',
    );

    expect(result).toMatchObject({
      status: 'ran',
      findings: [
        {
          id: 'browser-ai-calls:openai',
          severity: 'high',
          title: 'Your site calls OpenAI straight from the browser',
        },
      ],
    });
    if (result.status !== 'ran') return;
    expect(result.findings[0]?.evidence[0]?.detail).toContain(
      "turns off the library's warning",
    );
  });

  it('passes a site that only links to the AI companies', async () => {
    expect(
      await scanCode(
        'const links = ["https://openai.com", "https://www.anthropic.com/claude", "https://gemini.google.com"];',
      ),
    ).toEqual({ status: 'ran', findings: [] });
  });

  it('has everything a finding needs', async () => {
    const result = await scanCode(
      'fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini:generateContent?key="+k)',
    );

    if (result.status !== 'ran') throw new Error('did not run');
    expect(result.findings).toHaveLength(1);
    for (const finding of result.findings) {
      expect(LESSONS[finding.lessonId]).toBeDefined();
      expect(finding.aiFix.request).toContain('GEMINI_API_KEY');
    }
  });

  it('runs for anyone, on any site', () => {
    expect(browserAiCalls.mode).toBe('url-passive');
    expect(browserAiCalls.platforms).toBe('all');
  });
});

describe('findBrowserCalls', () => {
  it.each([
    [
      'fetch("https://api.openai.com/v1/chat/completions")',
      [['openai', false]],
    ],
    [
      'new Anthropic({dangerouslyAllowBrowser:true,baseURL:"https://api.anthropic.com"})',
      [['anthropic', true]],
    ],
    [
      'fetch(`https://generativelanguage.googleapis.com/v1beta/models`)',
      [['gemini', false]],
    ],
    // Firebase AI Logic is meant for browsers and protected by App Check.
    ['fetch("https://firebasevertexai.googleapis.com/v1beta/x")', []],
    ['"Read the docs at https://platform.openai.com/docs"', []],
  ])('%s', (text, expected) => {
    expect(callsIn(text)).toEqual(expected);
  });
});
