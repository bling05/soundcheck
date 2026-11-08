import { LESSONS } from '@soundcheck/report';
import { afterEach, describe, expect, it } from 'vitest';
import { FAKE_KEYS } from '../../../fixtures/bundle-secrets';
import { startFixture, type RunningFixture } from '../../../fixtures/server';
import { testFetchFor } from '../request-guard/test-fetch';
import { findBrowserCalls } from './browser-ai';
import { bundleSecrets } from './index';

let site: RunningFixture;
afterEach(() => site?.stop());

async function scanCode(code: string) {
  site = await startFixture({
    '/': { body: '<script src="/assets/app.js"></script><h1>Hi</h1>' },
    '/assets/app.js': { body: code },
  });
  const result = await bundleSecrets.run({
    url: site.url,
    fetch: testFetchFor(site),
    platforms: [],
  });
  if (result.status !== 'ran') throw new Error('did not run');
  return result.findings;
}

const callsIn = (text: string) =>
  findBrowserCalls([{ location: 'a.js', text }]).map(
    ({ provider, allowedBrowser }) => [provider, allowedBrowser],
  );

describe('AI services called from the browser, in Check #2', () => {
  it('reports a site that calls OpenAI from the browser without the key in its code', async () => {
    const findings = await scanCode(
      'new OpenAI({apiKey:settings.key,dangerouslyAllowBrowser:!0,baseURL:"https://api.openai.com/v1"})',
    );

    expect(findings).toMatchObject([
      {
        id: 'bundle-secrets:browser-ai-call:openai',
        severity: 'high',
        title: 'Your site calls OpenAI straight from the browser',
      },
    ]);
    expect(findings[0]?.evidence[0]?.detail).toContain(
      "turns off the library's warning",
    );
  });

  it('reports only the key when the key is in the code too', async () => {
    const findings = await scanCode(
      `new OpenAI({apiKey:"${FAKE_KEYS.openaiProject}",baseURL:"https://api.openai.com/v1"})`,
    );

    expect(findings.map(({ id }) => id)).toEqual([
      expect.stringMatching(/^bundle-secrets:openai-key:/),
    ]);
  });

  it('passes a site that only links to the AI companies', async () => {
    expect(
      await scanCode(
        'const links = ["https://openai.com", "https://www.anthropic.com/claude", "https://gemini.google.com"];',
      ),
    ).toEqual([]);
  });

  it('has everything a finding needs', async () => {
    const findings = await scanCode(
      'fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini:generateContent?key="+k)',
    );

    expect(findings).toHaveLength(1);
    for (const finding of findings) {
      expect(LESSONS[finding.lessonId]).toBeDefined();
      expect(finding.aiFix.request).toContain('GEMINI_API_KEY');
      expect(finding.safetyStep).toContain('create a new Gemini key');
    }
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
