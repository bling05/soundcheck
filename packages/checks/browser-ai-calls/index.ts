import { findingId, type Finding } from '@soundcheck/report';
import { readSite, type SiteFile } from '../site-files';
import type { Check, CheckContext, CheckResult } from '../types';

const CHECK_ID = 'browser-ai-calls';
const MAX_EVIDENCE_FILES = 5;

export type Provider = 'openai' | 'anthropic' | 'gemini';

interface ProviderRule {
  name: string;
  /** The service's own address, which only appears in code that calls it. */
  address: RegExp;
  /** The server-only setting for the key. */
  variable: string;
}

// The API addresses, not the companies' websites, so a link to openai.com doesn't count.
// Firebase AI Logic is built for browsers and protected by App Check, so it isn't listed.
export const PROVIDERS: Record<Provider, ProviderRule> = {
  openai: {
    name: 'OpenAI',
    address: /https:\/\/api\.openai\.com\/v1\b/,
    variable: 'OPENAI_API_KEY',
  },
  anthropic: {
    name: 'Anthropic',
    address: /https:\/\/api\.anthropic\.com\b/,
    variable: 'ANTHROPIC_API_KEY',
  },
  gemini: {
    name: 'Gemini',
    address: /https:\/\/generativelanguage\.googleapis\.com\b/,
    variable: 'GEMINI_API_KEY',
  },
};

// The OpenAI and Anthropic libraries refuse to run in a browser unless told to with this.
const ALLOW_BROWSER = /\bdangerouslyAllowBrowser\s*:\s*(?:!0|true)\b/;

export interface BrowserCall {
  provider: Provider;
  locations: string[];
  /** True when the code also turned off the library's own browser warning. */
  allowedBrowser: boolean;
}

/** Finds AI services the site's browser code talks to directly. */
export function findBrowserCalls(files: readonly SiteFile[]): BrowserCall[] {
  const allowedBrowser = files.some(({ text }) => ALLOW_BROWSER.test(text));
  return (Object.keys(PROVIDERS) as Provider[]).flatMap((provider) => {
    const locations = files
      .filter(({ text }) => PROVIDERS[provider].address.test(text))
      .map(({ location }) => location);
    return locations.length > 0
      ? [{ provider, locations, allowedBrowser }]
      : [];
  });
}

function findingFor({ provider, locations, allowedBrowser }: BrowserCall) {
  const { name, variable } = PROVIDERS[provider];
  const title = `Your site calls ${name} straight from the browser`;
  return {
    id: findingId(CHECK_ID, provider),
    checkId: CHECK_ID,
    title,
    severity: 'high',
    source: 'live',
    evidence: locations.slice(0, MAX_EVIDENCE_FILES).map((url) => ({
      kind: 'url',
      url,
      detail: allowedBrowser
        ? `This file contacts ${name} directly, and the code turns off the library's warning against running it in a browser.`
        : `This file contacts ${name} directly from your visitors' browsers.`,
    })),
    lessonId: `${CHECK_ID}:direct-call`,
    manualFix: {
      description: `Move every ${name} call into code that only runs on your server, like an API route, and have the browser call that instead. Give the server the key through a private environment variable. Then create a new ${name} key and delete the old one, since the old one has been visible to visitors. If each visitor types in their own key, this is fine and you can ignore it.`,
      language: 'ts',
      snippet: `// app/api/chat/route.ts runs on your server only.\nexport async function POST(request: Request) {\n  const key = process.env.${variable}; // never NEXT_PUBLIC_ or VITE_\n  // Check who's asking and limit how often, then call ${name} here.\n}`,
    },
    aiFix: {
      problem: title,
      request: `Move every ${name} call out of browser code into a server-only API route, reading the key from a private environment variable named ${variable}. The name must not start with NEXT_PUBLIC_ or VITE_. Only let signed-in users call the route, and add a limit on how often each user can call it. Remove any dangerouslyAllowBrowser setting. Then remind me to create a new ${name} key and delete the old one myself. If visitors enter their own keys instead of using mine, tell me and change nothing.`,
    },
  } satisfies Finding;
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
      reason: `Your site answered with error ${site.status}, so we couldn't read its code.`,
    };
  }

  const findings = findBrowserCalls(site.files).map(findingFor);
  const partial =
    "We couldn't read all of your site's code, so there could be more we didn't see.";
  // Finding nothing after reading only part of a site must never look like a pass.
  if (!site.complete && findings.length === 0) {
    return { status: 'skipped', reason: partial };
  }
  return site.complete
    ? { status: 'ran', findings }
    : { status: 'ran', findings, note: partial };
}

export const browserAiCalls: Check = {
  id: CHECK_ID,
  title: 'AI services called straight from the browser',
  mode: 'url-passive',
  platforms: 'all',
  run,
};
