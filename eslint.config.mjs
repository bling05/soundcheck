import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['**/node_modules/**', '**/.next/**', '**/next-env.d.ts'] },
  ...tseslint.configs.recommended,
  ...[...nextVitals, ...nextTypescript].map((config) => ({
    ...config,
    files: ['apps/web/**/*.{ts,tsx}'],
    settings: { ...config.settings, next: { rootDir: 'apps/web/' } },
  })),
];
