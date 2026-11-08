import { findingId, type Finding } from '@soundcheck/report';
import type { SiteFile } from '../site-files';
import type { SecretRuleId } from './rules';

const CHECK_ID = 'bundle-secrets';
const MAX_EVIDENCE_FILES = 5;

export type Provider = 'openai' | 'anthropic' | 'gemini';

interface ProviderRule {
  name: string;
  /** The service's own address, which only appears in code that calls it. */
  address: RegExp;
  /** The server-only setting for the key. */
  variable: string;
  /**
   * The leaked-key rule for the same service. When that key is in the code, its finding
   * already says to move the calls to the server, so this one would only repeat it.
   */
  keyRule?: SecretRuleId;
}

// The API addresses, not the companies' websites, so a link to openai.com doesn't count.
// Firebase AI Logic is built for browsers and protected by App Check, so it isn't listed.
export const PROVIDERS: Record<Provider, ProviderRule> = {
  openai: {
    name: 'OpenAI',
    address: /https:\/\/api\.openai\.com\/v1\b/,
    variable: 'OPENAI_API_KEY',
    keyRule: 'openai-key',
  },
  anthropic: {
    name: 'Anthropic',
    address: /https:\/\/api\.anthropic\.com\b/,
    variable: 'ANTHROPIC_API_KEY',
    keyRule: 'anthropic-key',
  },
  // A Google key's own finding is about restricting it, not about Gemini calls, so a
  // Gemini call is always reported too.
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

/** True when a leaked key for the same service is already reported. */
export function coveredByKey(
  call: BrowserCall,
  leakedRules: ReadonlySet<SecretRuleId>,
): boolean {
  const { keyRule } = PROVIDERS[call.provider];
  return keyRule !== undefined && leakedRules.has(keyRule);
}

export function browserCallFinding({
  provider,
  locations,
  allowedBrowser,
}: BrowserCall): Finding {
  const { name, variable } = PROVIDERS[provider];
  const title = `Your site calls ${name} straight from the browser`;
  return {
    id: findingId(CHECK_ID, 'browser-ai-call', provider),
    checkId: CHECK_ID,
    title,
    severity: 'high',
    source: 'live',
    safetyStep: `Once ${name} is only called from your server, create a new ${name} key and delete the old one, since visitors' browsers have been sending it with every request.`,
    evidence: locations.slice(0, MAX_EVIDENCE_FILES).map((url) => ({
      kind: 'url',
      url,
      detail: allowedBrowser
        ? `This file contacts ${name} directly, and the code turns off the library's warning against running it in a browser.`
        : `This file contacts ${name} directly from your visitors' browsers.`,
    })),
    lessonId: `${CHECK_ID}:browser-ai-call`,
    manualFix: {
      description: `Move every ${name} call into code that only runs on your server, like an API route, and have the browser call that instead. Give the server the key through a private environment variable. Then create a new ${name} key and delete the old one, since the old one has been visible to visitors. If each visitor types in their own key, this is fine and you can ignore it.`,
      language: 'ts',
      snippet: `// app/api/chat/route.ts runs on your server only.\nexport async function POST(request: Request) {\n  const key = process.env.${variable}; // never NEXT_PUBLIC_ or VITE_\n  // Check who's asking and limit how often, then call ${name} here.\n}`,
    },
    aiFix: {
      problem: title,
      request: `Move every ${name} call out of browser code into a server-only API route, reading the key from a private environment variable named ${variable}. The name must not start with NEXT_PUBLIC_ or VITE_. Only let signed-in users call the route, and add a limit on how often each user can call it. Remove any dangerouslyAllowBrowser setting. Then remind me to create a new ${name} key and delete the old one myself. If visitors enter their own keys instead of using mine, tell me and change nothing.`,
    },
  };
}
