import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import tseslint from 'typescript-eslint';

const USE_GUARD =
  'Checks must make requests with guardedFetch from request-guard.';

const NETWORK_GLOBALS = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'];
const NETWORK_MODULES = [
  ...[
    'dgram',
    'dns',
    'dns/promises',
    'http',
    'http2',
    'https',
    'net',
    'tls',
  ].flatMap((name) => [name, `node:${name}`]),
  'axios',
  'got',
  'ky',
  'node-fetch',
  'superagent',
  'undici',
];

export default [
  { ignores: ['**/node_modules/**', '**/.next/**', '**/next-env.d.ts'] },
  ...tseslint.configs.recommended,
  ...[...nextVitals, ...nextTypescript].map((config) => ({
    ...config,
    files: ['apps/web/**/*.{ts,tsx}'],
    settings: { ...config.settings, next: { rootDir: 'apps/web/' } },
  })),
  {
    // Checks visit user-supplied links, so none of them may go around the request guard.
    files: ['packages/checks/**/*.ts'],
    ignores: ['packages/checks/request-guard/**'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...NETWORK_GLOBALS.map((name) => ({ name, message: USE_GUARD })),
      ],
      'no-restricted-properties': [
        'error',
        ...NETWORK_GLOBALS.map((property) => ({
          object: 'globalThis',
          property,
          message: USE_GUARD,
        })),
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: NETWORK_MODULES.map((name) => ({ name, message: USE_GUARD })),
        },
      ],
    },
  },
];
