import type { Lesson } from '../types';

export const BROWSER_AI_CALLS_LESSONS = {
  'browser-ai-calls:direct-call': {
    whatItIs:
      "Your site's browser code talks to an AI service directly. To do that, the browser needs your API key, so the key travels with every visitor's requests, where anyone can see it in their browser's developer tools. That's true even if the key isn't written in your code, for example if it's loaded from a setting.",
    whyAiToolsProduceIt:
      'Calling the AI service straight from the page is the quickest way to make an AI feature work, so AI tools often build it that way. The OpenAI and Anthropic libraries block this on purpose, and a common AI fix is to turn that protection off with a setting called dangerouslyAllowBrowser.',
    howItIsExploited:
      "Anyone can open your site, copy the key from a request, and use it for their own AI requests, billed to you. Even without copying the key, they can send your site's AI feature as many requests as they like, because nothing on a server checks who they are or how often they ask.",
    owasp: ['A04:2021 Insecure Design', 'A05:2021 Security Misconfiguration'],
    cwe: ['CWE-522', 'CWE-770'],
  },
} satisfies Record<`browser-ai-calls:${string}`, Lesson>;
