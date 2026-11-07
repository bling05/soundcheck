import type { FixtureSite } from './server';

// Every value here is made up and obviously fake, so secret scanners don't flag this file.
export const FAKE_ENV = [
  '# Settings for the fixture app',
  'DATABASE_URL=postgres://fixture:not-a-password@db.fixture.test/app',
  'SUPABASE_SECRET_KEY=fixture-not-a-real-key',
  'export STRIPE_SECRET_KEY="fixture-not-a-real-key"',
  '',
].join('\n');

const FAKE_SOURCE_MAP = JSON.stringify({
  version: 3,
  file: 'app.js',
  sources: ['../src/main.ts', '../src/admin.ts'],
  sourcesContent: ['console.log("hi");', '// TODO: hide this page'],
  mappings: 'AAAA',
});

const page = (head: string) => `<!doctype html><head>${head}</head><h1>Hi</h1>`;

const HOME = page('<script type="module" src="/assets/app.js"></script>');

/** Leaves a .env file, its Git history, a database copy, a zip, and a source map public. */
export const leftoverFilesSite: FixtureSite = {
  '/': { body: HOME },
  '/assets/app.js': {
    body: 'console.log("hi");\n//# sourceMappingURL=app.js.map\n',
  },
  '/assets/app.js.map': {
    headers: { 'content-type': 'application/json' },
    body: FAKE_SOURCE_MAP,
  },
  '/.env': { headers: { 'content-type': 'text/plain' }, body: FAKE_ENV },
  '/.git/HEAD': { body: 'ref: refs/heads/main\n' },
  '/backup.sql': {
    body: '-- PostgreSQL database dump\nCREATE TABLE public.users (id uuid);\n',
  },
  '/site.zip': { body: 'PK\u0003\u0004fixture-zip-contents' },
};

/**
 * Has none of them, and answers every address with its home page, like many single-page
 * apps do. A check that only looks at whether an address loads would flag every file here.
 */
export const cleanLeftoverFilesSite: FixtureSite = {
  '/': { body: HOME },
  '/assets/app.js': { body: 'console.log("hi");\n' },
  '*': { body: HOME },
};
