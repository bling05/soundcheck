import type { FixtureSite } from './server';

const HTML = { 'content-type': 'text/html' };
const page = (head: string) => `<!doctype html><head>${head}</head><h1>Hi</h1>`;

// Fake values only. This address has the shape of a Supabase project but doesn't exist.
const FAKE_SUPABASE = 'https://fixturefixturefixtur.supabase.co';

/** The Supabase address is only in a code file, which is where real apps keep it. */
export const supabaseSite: FixtureSite = {
  '/': {
    headers: HTML,
    body: page('<script type="module" src="/assets/app.js"></script>'),
  },
  '/assets/app.js': { body: `createClient("${FAKE_SUPABASE}", "fake-key");` },
};

export const firebaseSite: FixtureSite = {
  '/': { headers: HTML, body: page('<script src="/app.js"></script>') },
  '/app.js': { body: 'init({ authDomain: "fixture-app.firebaseapp.com" });' },
};

export const nextjsOnVercelSite: FixtureSite = {
  '/': {
    headers: { ...HTML, 'x-powered-by': 'Next.js', 'x-vercel-id': 'fake' },
    body: page('<link rel="stylesheet" href="/_next/static/css/app.css">'),
  },
};

export const viteSite: FixtureSite = {
  '/': {
    headers: HTML,
    body: page(
      '<script type="module" crossorigin src="/assets/index-Ab12Cd34.js"></script>',
    ),
  },
  '/assets/index-Ab12Cd34.js': { body: 'console.log("hi");' },
};

export const lovableTemplateSite: FixtureSite = {
  '/': {
    headers: HTML,
    body: page(
      '<meta property="og:image" content="https://lovable.dev/opengraph-image-fake.png">',
    ),
  },
};

/** Talks about every technology, but is built with none of them. Must detect nothing. */
export const blogAboutToolsSite: FixtureSite = {
  '/': {
    headers: HTML,
    body: page('<title>Tools I like</title>').concat(
      '<p>I compared Supabase, Firebase, Next.js, Vite, Vercel, Lovable, Bolt, and Base44.</p>',
      '<a href="https://supabase.com/docs">Supabase docs</a>',
      '<a href="https://firebase.google.com">Firebase</a>',
      '<a href="https://lovable.dev">Lovable</a>',
    ),
  },
};
