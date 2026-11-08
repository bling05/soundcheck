import { findingId, sortBySeverity, type Finding } from '@soundcheck/report';
import type { GuardedFetch } from '../request-guard';
import { readSite } from '../site-files';
import { tableKind } from '../supabase-rls/rules';
import type { Check, CheckContext, CheckResult } from '../types';
import {
  collectionDetail,
  collectionFix,
  collectionFixRequest,
  collectionTitle,
  FIRESTORE_FIX,
  FIRESTORE_FIX_REQUEST,
  OPEN_RULES_DETAIL,
  REALTIME_FIX,
  REALTIME_FIX_REQUEST,
  realtimeDetail,
  SEVERITY,
} from './content';
import {
  findCollectionNames,
  findFirebaseProject,
  findRealtimePaths,
  PAGE_SIZE,
  PROBE_COLLECTION,
  type FirebaseProject,
} from './rules';

const CHECK_ID = 'firebase-rules';
const MAX_RESPONSE_BYTES = 512 * 1024;

type Answer =
  /** The rules let a stranger read it. `count` is undefined if the answer had no count. */
  | { state: 'readable'; count: number; more: boolean }
  | { state: 'protected' }
  /** Firestore isn't set up for this project, or the path doesn't exist. */
  | { state: 'missing' }
  | { state: 'unknown' };

function parseJson(body: Buffer): unknown {
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    return undefined;
  }
}

/**
 * Lists the first page of a collection, asking for no fields, so only document names come
 * back. Only the count is kept: names can be personal, so they're dropped here.
 */
async function listCollection(
  firestore: string,
  project: FirebaseProject,
  collection: string,
  fetch: GuardedFetch,
): Promise<Answer> {
  const query = new URLSearchParams({
    pageSize: String(PAGE_SIZE),
    'mask.fieldPaths': '__name__',
  });
  if (project.apiKey) query.set('key', project.apiKey);
  const response = await fetch(
    `${firestore}/v1/projects/${encodeURIComponent(project.projectId)}/databases/(default)/documents/${encodeURIComponent(collection)}?${query}`,
    { maxBytes: MAX_RESPONSE_BYTES },
  );
  if (!response.ok) return { state: 'unknown' };
  // A project that never turned Firestore on answers 403 too, but says why. It has no
  // Firestore to protect, so it must not read as "locked".
  if (
    response.status === 403 &&
    response.body.toString('utf8').includes('SERVICE_DISABLED')
  ) {
    return { state: 'missing' };
  }
  if (response.status === 401 || response.status === 403) {
    return { state: 'protected' };
  }
  if (response.status === 404) return { state: 'missing' };
  if (response.status !== 200 || response.truncated) {
    return { state: 'unknown' };
  }
  const body = parseJson(response.body);
  if (typeof body !== 'object' || body === null) return { state: 'unknown' };
  const docs = 'documents' in body ? body.documents : [];
  if (!Array.isArray(docs)) return { state: 'unknown' };
  return {
    state: 'readable',
    count: docs.length,
    more: 'nextPageToken' in body,
  };
}

/**
 * Reads only the names at one level of the Realtime Database (`shallow=true`), never
 * what's inside them. Only the count is kept.
 */
async function readRealtime(
  databaseUrl: string,
  path: string,
  fetch: GuardedFetch,
): Promise<Answer> {
  const response = await fetch(
    `${databaseUrl}/${path ? `${encodeURIComponent(path)}/` : ''}.json?shallow=true`,
    { maxBytes: MAX_RESPONSE_BYTES },
  );
  if (!response.ok) return { state: 'unknown' };
  if (response.status === 401 || response.status === 403) {
    return { state: 'protected' };
  }
  if (response.status === 404) return { state: 'missing' };
  if (response.status !== 200 || response.truncated) {
    return { state: 'unknown' };
  }
  const body = parseJson(response.body);
  if (body === undefined) return { state: 'unknown' };
  const count =
    body === null ? 0 : typeof body === 'object' ? Object.keys(body).length : 1;
  return { state: 'readable', count, more: false };
}

function firestoreFinding(
  id: string,
  title: string,
  kind: Parameters<typeof collectionTitle>[1],
  url: string,
  detail: string,
  manualFix: Finding['manualFix'],
  request: string,
  lesson: 'firestore-open' | 'readable-collection',
): Finding {
  return {
    id,
    checkId: CHECK_ID,
    title,
    severity: SEVERITY[kind],
    source: 'live',
    evidence: [{ kind: 'url', url, detail }],
    lessonId: `${CHECK_ID}:${lesson}`,
    manualFix,
    aiFix: { problem: title, request },
  };
}

/** Builds the check. Tests point `firestore` at a fake server; scans use Google's. */
export function createFirebaseRules(
  firestore = 'https://firestore.googleapis.com',
): Check {
  async function run(context: CheckContext): Promise<CheckResult> {
    if (!context.url) {
      return {
        status: 'skipped',
        reason: 'This check needs a link to your site.',
      };
    }
    const site = await readSite(context.url, context.fetch);
    if (!site.ok) return { status: 'skipped', reason: site.message };

    const project = findFirebaseProject(site.files);
    if (!project) {
      return {
        status: 'skipped',
        reason:
          "We couldn't find your Firebase project's settings in your site's code.",
      };
    }

    const findings: Finding[] = [];
    const unclear: string[] = [];
    const listUrl = (name: string) =>
      `${firestore}/v1/projects/${project.projectId}/databases/(default)/documents/${name}`;

    // Firestore: first, do the rules let anyone read anything at all?
    const probe = await listCollection(
      firestore,
      project,
      PROBE_COLLECTION,
      context.fetch,
    );
    const usesFirestore = probe.state !== 'missing';
    if (probe.state === 'readable') {
      findings.push(
        firestoreFinding(
          findingId(CHECK_ID, 'firestore-open'),
          'Your Firestore rules let anyone read every collection',
          'personal',
          listUrl(PROBE_COLLECTION),
          OPEN_RULES_DETAIL,
          FIRESTORE_FIX,
          FIRESTORE_FIX_REQUEST,
          'firestore-open',
        ),
      );
    } else if (probe.state === 'unknown') {
      unclear.push(
        "Firebase didn't give a clear answer about your Firestore rules",
      );
    }

    // Then each collection the code uses, when the rules aren't simply open to all.
    if (usesFirestore && probe.state !== 'readable') {
      const names = findCollectionNames(site.files);
      if (names.length === 0) {
        unclear.push(
          "we couldn't find your Firestore collection names in your code, so we only checked whether your rules are open to everyone",
        );
      }
      for (const name of names) {
        const answer = await listCollection(
          firestore,
          project,
          name,
          context.fetch,
        );
        if (answer.state === 'readable') {
          const kind = tableKind(name);
          findings.push(
            firestoreFinding(
              findingId(CHECK_ID, 'readable-collection', name),
              collectionTitle(name, kind),
              kind,
              listUrl(name),
              collectionDetail(answer.count, answer.more),
              collectionFix(name, kind),
              collectionFixRequest(name, kind),
              'readable-collection',
            ),
          );
        } else if (answer.state === 'unknown') {
          unclear.push(
            `Firebase didn't give a clear answer about the ${name} collection`,
          );
        }
      }
    }

    // The Realtime Database, if the site uses one: its root, then each path the code reads.
    if (project.databaseUrl) {
      for (const path of ['', ...findRealtimePaths(site.files)]) {
        const answer = await readRealtime(
          project.databaseUrl,
          path,
          context.fetch,
        );
        if (answer.state === 'readable') {
          const title = path
            ? `Anyone can read ${path} in your Realtime Database`
            : 'Anyone can read your whole Realtime Database';
          findings.push({
            id: findingId(CHECK_ID, 'realtime-open', path || 'root'),
            checkId: CHECK_ID,
            title,
            severity: 'critical',
            source: 'live',
            evidence: [
              {
                kind: 'url',
                url: `${project.databaseUrl}/${path}`,
                detail: realtimeDetail(answer.count),
              },
            ],
            lessonId: `${CHECK_ID}:realtime-open`,
            manualFix: REALTIME_FIX,
            aiFix: { problem: title, request: REALTIME_FIX_REQUEST },
          });
          // An open root already covers everything under it.
          if (!path) break;
        } else if (answer.state === 'unknown') {
          unclear.push(
            `Firebase didn't give a clear answer about ${path ? `${path} in your Realtime Database` : 'your Realtime Database'}`,
          );
        }
      }
    }

    if (!usesFirestore && !project.databaseUrl) {
      return {
        status: 'skipped',
        reason:
          "Your Firebase project doesn't seem to have a Firestore or Realtime Database we could reach.",
      };
    }

    const sorted = sortBySeverity(findings);
    const note =
      unclear.length > 0
        ? `We couldn't check everything: ${unclear.join('; ')}.`
        : undefined;
    // Nothing found while something was unclear must never look like a pass.
    if (sorted.length === 0 && note) return { status: 'skipped', reason: note };
    return note
      ? { status: 'ran', findings: sorted, note }
      : { status: 'ran', findings: sorted };
  }

  return {
    id: CHECK_ID,
    title: 'Firebase databases anyone can read',
    // Sends requests to the site's database, so it only runs for verified owners.
    mode: 'url-active',
    platforms: ['firebase'],
    run,
  };
}

export const firebaseRules = createFirebaseRules();
