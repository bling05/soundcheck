import type { FixtureSite } from './server';

// Every key here is made up. They're assembled from pieces so secret scanners, including
// GitHub's, don't mistake this file for a real leak and block a push.
const token = (claims: object) =>
  [
    Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'),
    Buffer.from(JSON.stringify(claims)).toString('base64url'),
    'c2lnbmF0dXJlLWZvci10ZXN0cw',
  ].join('.');

const SUPABASE = { iss: 'supabase', ref: 'fixturefixturefixtur' };

export const FAKE_KEYS = {
  supabaseServiceRole: token({ ...SUPABASE, role: 'service_role' }),
  supabaseSecret: 'sb_' + 'secret_' + 'a1B2c3D4'.repeat(4),
  stripeSecret: 'sk_' + 'live_' + '0123456789abcdefABCDEF01',
  stripeRestricted: 'rk_' + 'live_' + '1023456789abcdefABCDEF02',
  privateKey:
    '-----BEGIN ' +
    'PRIVATE KEY-----\\n' +
    'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC'.repeat(5) +
    '\\n-----END ' +
    'PRIVATE KEY-----',
  openaiProject: 'sk-' + 'proj-' + 'a1B2c3D4'.repeat(6),
  openaiLegacy: 'sk-' + 'b2C3d4E5'.repeat(6),
  anthropic: 'sk-' + 'ant-' + 'api03-' + 'c3D4e5F6'.repeat(10),
  aws: 'AKIA' + '0123456789ABCDEF',
};

export const PUBLIC_VALUES = {
  supabaseAnon: token({ ...SUPABASE, role: 'anon' }),
  supabaseUser: token({ ...SUPABASE, role: 'authenticated' }),
  supabaseLocalDefault: token({ iss: 'supabase-demo', role: 'service_role' }),
  supabasePublishable: 'sb_' + 'publishable_' + 'a1B2c3D4'.repeat(4),
  stripePublishable: 'pk_' + 'live_' + '0123456789abcdefABCDEF01',
  stripeTest: 'sk_' + 'test_' + '0123456789abcdefABCDEF01',
  googleBrowserKey: 'AIza' + 'a1B2c3D4'.repeat(4) + 'abc',
};

const page = (head: string) => `<!doctype html><head>${head}</head><h1>Hi</h1>`;

/** A secret key sits in a code file, which is where real apps usually leak them. */
export const leakySite: FixtureSite = {
  '/': { body: page('<script src="/assets/app.js"></script>') },
  '/assets/app.js': {
    body: `const stripe = new Stripe("${FAKE_KEYS.stripeSecret}");`,
  },
};

/** Has only values that are meant to be public, or that merely look like keys. */
export const publicKeysSite: FixtureSite = {
  '/': { body: page('<script src="/assets/app.js"></script>') },
  '/assets/app.js': {
    body: [
      `createClient("https://fixturefixturefixtur.supabase.co", "${PUBLIC_VALUES.supabaseAnon}");`,
      `loadStripe("${PUBLIC_VALUES.stripePublishable}");`,
      `init({ apiKey: "${PUBLIC_VALUES.googleBrowserKey}" });`,
      `const css = "sk-circle-fade-dot-animation-with-a-long-name";`,
      'const PEM_START = "-----BEGIN PRIVATE KEY-----";',
    ].join('\n'),
  },
};
