import { stringAssignedBefore, VARIABLE } from '../code-names';
import type { SiteFile } from '../site-files';

export interface FirebaseProject {
  projectId: string;
  /** The public web key. Meant to be in the site's code; it only names the project. */
  apiKey?: string;
  /** Only set if the site uses the Realtime Database. No trailing slash. */
  databaseUrl?: string;
}

// Matches both `projectId:"x"` and `"projectId": "x"`, as config objects and JSON.
const setting = (name: string, value: string) =>
  new RegExp(`["']?${name}["']?\\s*:\\s*["'\`](${value})["'\`]`);
const PROJECT_ID = setting('projectId', '[a-z0-9][a-z0-9-]{4,38}[a-z0-9]');
const API_KEY = setting('apiKey', 'AIza[0-9A-Za-z_-]{35}');
const DATABASE_URL = setting('databaseURL', 'https?://[^"\'`\\s]+');

/** Finds the Firebase project in the site's code, from its `firebaseConfig`. */
export function findFirebaseProject(
  files: readonly SiteFile[],
): FirebaseProject | undefined {
  for (const { text } of files) {
    const projectId = PROJECT_ID.exec(text)?.[1];
    if (!projectId) continue;
    return {
      projectId,
      apiKey: API_KEY.exec(text)?.[1],
      databaseUrl: DATABASE_URL.exec(text)?.[1]?.replace(/\/+$/, ''),
    };
  }
  return undefined;
}

const NAME = '[A-Za-z0-9_-]{1,100}';
// `collection(db, "users")`, `doc(db, "users", id)`, and the older `db.collection("users")`.
// Bundlers write imported calls as `(0,r.collection)(db,"users")`, hence the optional `)`.
const COLLECTION_CALLS = [
  new RegExp(
    `\\b(?:collection|doc)\\)?\\(\\s*${VARIABLE}\\s*,\\s*["'\`](${NAME})["'\`]`,
    'g',
  ),
  new RegExp(`\\.collection\\(\\s*["'\`](${NAME})["'\`]`, 'g'),
];
const COLLECTION_VARIABLE = new RegExp(
  `\\b(?:collection|doc)\\)?\\(\\s*${VARIABLE}\\s*,\\s*(${VARIABLE})\\s*[,)]`,
  'g',
);
// `ref(db, "notes")` and the older `db.ref("notes")`, for the Realtime Database.
const REF_CALLS = [
  new RegExp(`\\bref\\)?\\(\\s*${VARIABLE}\\s*,\\s*["'\`](${NAME})["'\`]`, 'g'),
  new RegExp(`\\.ref\\(\\s*["'\`](${NAME})["'\`]`, 'g'),
];
/** Each name is one request, so a scan stays short. */
export const MAX_NAMES = 15;

function namesFrom(
  files: readonly SiteFile[],
  patterns: readonly RegExp[],
  variablePattern?: RegExp,
): string[] {
  const names = new Set<string>();
  for (const { text } of files) {
    const calls = patterns.flatMap((pattern) =>
      [...text.matchAll(pattern)].map((match) => ({
        index: match.index,
        name: match[1],
      })),
    );
    if (variablePattern) {
      for (const match of text.matchAll(variablePattern)) {
        calls.push({
          index: match.index,
          name: match[1] && stringAssignedBefore(text, match[1], match.index),
        });
      }
    }
    calls.sort((a, b) => a.index - b.index);
    for (const { name } of calls) {
      // Names starting and ending with __ are Firestore's own.
      if (name && !/^__.*__$/.test(name)) names.add(name);
    }
  }
  return [...names].slice(0, MAX_NAMES);
}

/** The Firestore collections the site's code reads, in the order first seen. */
export function findCollectionNames(files: readonly SiteFile[]): string[] {
  return namesFrom(files, COLLECTION_CALLS, COLLECTION_VARIABLE);
}

/** The top-level Realtime Database paths the site's code reads, like `notes`. */
export function findRealtimePaths(files: readonly SiteFile[]): string[] {
  return namesFrom(files, REF_CALLS);
}

/**
 * Asked for to test the rules themselves. It doesn't exist, so nothing is read; if the
 * rules still let us ask, they let anyone read any collection, the way test mode does.
 */
export const PROBE_COLLECTION = 'soundcheck-rules-check';
/** Enough to show the point, no more. */
export const PAGE_SIZE = 100;
