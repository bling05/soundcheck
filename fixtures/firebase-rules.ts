import type { FixtureResponse, FixtureSite } from './server';

/** Meant to be public: Firebase web keys only name the project. Made up, in pieces. */
export const FIREBASE_KEY = 'AIza' + 'Fx1Bz2Cy3Dx4Ew5Fv6Gu7Ht8Is9Jr0Kq1Lp';
export const PROJECT_ID = 'soundcheck-fixture';

/**
 * A page with a Firebase app. Firestore and the Realtime Database both run on the fixture
 * server, so call this after it starts. `firestore` is passed to the check, and the
 * Realtime Database address goes in the config, the way real apps have it.
 */
export function firebasePage(
  databaseUrl: string | undefined,
  code: string,
): string {
  const config = [
    `apiKey: "${FIREBASE_KEY}"`,
    `authDomain: "${PROJECT_ID}.firebaseapp.com"`,
    `projectId: "${PROJECT_ID}"`,
    ...(databaseUrl ? [`databaseURL: "${databaseUrl}"`] : []),
  ].join(', ');
  return `<!doctype html><script type="module">const firebaseConfig = { ${config} };\n${code}</script>`;
}

const documentsPath = (collection: string) =>
  `/v1/projects/${PROJECT_ID}/databases/(default)/documents/${collection}`;

/** A page of document names, with personal-looking ids to prove none are kept. */
const documents = (count: number, more = false): FixtureResponse => ({
  body: JSON.stringify({
    documents: Array.from({ length: count }, (_, index) => ({
      name: `projects/${PROJECT_ID}/databases/(default)/documents/x/jane.doe${index}@example.com`,
    })),
    ...(more && { nextPageToken: 'next' }),
  }),
});
const denied: FixtureResponse = {
  status: 403,
  body: '{"error":{"code":403,"status":"PERMISSION_DENIED"}}',
};

export const APP_CODE = [
  'getDocs(collection(db, "users"));',
  '(0,r.collection)(db,"products");',
  'getDocs(collection(db, "messages"));',
  'get(ref(rtdb, "notes"));',
].join('\n');

/** Test mode: every collection, real or not, answers. */
export const testModeFirestore: FixtureSite = {
  [documentsPath('soundcheck-rules-check')]: { body: '{}' },
  [documentsPath('users')]: documents(4),
};

/** Proper rules, except users is open and products is open on purpose. */
export const mixedFirestore: FixtureSite = {
  [documentsPath('soundcheck-rules-check')]: denied,
  [documentsPath('users')]: documents(100, true),
  [documentsPath('products')]: documents(12),
  [documentsPath('messages')]: denied,
};

/** Everything locked. */
export const lockedFirestore: FixtureSite = {
  [documentsPath('soundcheck-rules-check')]: denied,
  [documentsPath('users')]: denied,
  [documentsPath('products')]: denied,
  [documentsPath('messages')]: denied,
};

/** A Realtime Database whose root anyone can read. */
export const openRealtime: FixtureSite = {
  '/rtdb/.json': { body: '{"notes":true,"users":true}' },
};

/** A Realtime Database locked at the root but open at one path. */
export const pathOpenRealtime: FixtureSite = {
  '/rtdb/.json': { status: 401, body: '{"error":"Permission denied"}' },
  '/rtdb/notes/.json': { body: 'null' },
};
