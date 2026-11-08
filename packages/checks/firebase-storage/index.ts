import {
  findingId,
  sortBySeverity,
  type Finding,
  type ManualFix,
  type Severity,
} from '@soundcheck/report';
import { stringAssignedBefore, VARIABLE } from '../code-names';
import { findFirebaseProject } from '../firebase-rules/rules';
import type { GuardedFetch } from '../request-guard';
import { readSite, type SiteFile } from '../site-files';
import { bucketKind, type BucketKind } from '../supabase-storage/rules';
import type { Check, CheckContext, CheckResult } from '../types';

const CHECK_ID = 'firebase-storage';
/** How many names one list request asks for. Enough to prove the point, no more. */
export const LIST_LIMIT = 100;
/** Each folder is one request, so a scan stays short. */
export const MAX_FOLDERS = 10;
const MAX_RESPONSE_BYTES = 512 * 1024;

// The first folder of a path the code stores files under, like `avatars` in
// `ref(storage, "avatars/" + uid)` or `storageRef.child("uploads/a.png")`.
const SEGMENT = '[A-Za-z0-9_-]{1,100}';
/** A whole storage path held in a variable, like `docs/x.pdf`. */
const STORAGE_PATH = '[A-Za-z0-9_./-]{1,300}';
const LITERAL_PATH = new RegExp(
  `\\bref\\)?\\(\\s*${VARIABLE}\\s*,\\s*["'\`](${SEGMENT})\\/`,
  'g',
);
const CHILD_PATH = new RegExp(
  `\\.child\\(\\s*["'\`](${SEGMENT})(?:\\/|["'\`])`,
  'g',
);
const VARIABLE_PATH = new RegExp(
  `\\bref\\)?\\(\\s*${VARIABLE}\\s*,\\s*(${VARIABLE})\\s*\\)`,
  'g',
);

/** The top folders the site's code stores files in, in the order first seen. */
export function findFolders(files: readonly SiteFile[]): string[] {
  const folders = new Set<string>();
  for (const { text } of files) {
    const calls = [
      ...[...text.matchAll(LITERAL_PATH), ...text.matchAll(CHILD_PATH)].map(
        (m) => ({ index: m.index, name: m[1] }),
      ),
      ...[...text.matchAll(VARIABLE_PATH)].map((m) => ({
        index: m.index,
        name:
          m[1] &&
          stringAssignedBefore(text, m[1], m.index, STORAGE_PATH)?.split(
            '/',
          )[0],
      })),
    ].sort((a, b) => a.index - b.index);
    for (const { name } of calls) if (name) folders.add(name);
  }
  return [...folders].slice(0, MAX_FOLDERS);
}

type Answer =
  | { state: 'listable'; entries: number; more: boolean }
  | { state: 'protected' }
  | { state: 'missing' }
  | { state: 'unknown' };

/**
 * Asks for one page of names in a folder, the way Firebase's own list() does. Only the
 * number of names is kept: they can be personal, so they're dropped here. No file is
 * ever downloaded.
 */
async function listFolder(
  storage: string,
  bucket: string,
  folder: string,
  fetch: GuardedFetch,
): Promise<Answer> {
  const query = new URLSearchParams({
    maxResults: String(LIST_LIMIT),
    delimiter: '/',
    ...(folder && { prefix: `${folder}/` }),
  });
  const response = await fetch(
    `${storage}/v0/b/${encodeURIComponent(bucket)}/o?${query}`,
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
  let body: unknown;
  try {
    body = JSON.parse(response.body.toString('utf8'));
  } catch {
    return { state: 'unknown' };
  }
  if (typeof body !== 'object' || body === null) return { state: 'unknown' };
  const items = 'items' in body && Array.isArray(body.items) ? body.items : [];
  const prefixes =
    'prefixes' in body && Array.isArray(body.prefixes) ? body.prefixes : [];
  return {
    state: 'listable',
    entries: items.length + prefixes.length,
    more: 'nextPageToken' in body,
  };
}

const SEVERITY: Record<BucketKind, Severity> = {
  personal: 'critical',
  unknown: 'high',
  'probably-public': 'medium',
};

export function detailFor(entries: number, more: boolean): string {
  if (entries === 0) {
    return "Your rules let anyone list the files here. It's empty right now, but anything uploaded later will be listed too.";
  }
  const count = more
    ? `at least ${entries} files and folders`
    : `${entries} ${entries === 1 ? 'file or folder' : 'files and folders'}`;
  return `We could see the names of ${count} using only the public settings in your site's code. We didn't open or save any of them.`;
}

const RULES_TAB = 'Open the Firebase console, then Storage, then Rules.';

export const WHOLE_BUCKET_FIX: ManualFix = {
  description: `${RULES_TAB} Replace the rules there. This locks everything, then lets each signed-in user reach only their own folder under users. Images that should be public can still be shown by link: "get" allows opening one file by its address, while "list" would let anyone see them all.`,
  language: 'firebase-storage-rules',
  snippet: `rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    // Each signed-in user can reach only the files in their own folder.
    match /users/{userId}/{allPaths=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    // Public images: anyone can open one by its link, nobody can list them all.
    match /public/{allPaths=**} {
      allow get: if true;
      allow list: if false;
    }
  }
}`,
};

function folderFix(folder: string, kind: BucketKind): ManualFix {
  return kind === 'probably-public'
    ? {
        description: `${RULES_TAB} If these files are meant to be public, let anyone open one by its link but not list them all.`,
        language: 'firebase-storage-rules',
        snippet: `match /${folder}/{allPaths=**} {\n  allow get: if true;\n  allow list: if false;\n  allow write: if request.auth != null;\n}`,
      }
    : {
        description: `${RULES_TAB} Change the rule for this folder so each signed-in user can only reach their own files. This example assumes each user's files are in a folder named after their user id.`,
        language: 'firebase-storage-rules',
        snippet: `match /${folder}/{userId}/{allPaths=**} {\n  allow read, write: if request.auth != null && request.auth.uid == userId;\n}`,
      };
}

const OWNER_RULES =
  "Each signed-in user should only be able to see and change their own files. Files that must be public, like product photos, can allow opening one by its link (get) but not listing them all (list). Don't use a rule that lets everyone read everything. Check that uploads and downloads still work, and tell me which rules you wrote.";

function findingFor(
  bucket: string,
  storage: string,
  folder: string,
  answer: Extract<Answer, { state: 'listable' }>,
): Finding {
  const kind: BucketKind = folder ? bucketKind(folder) : 'personal';
  const title = !folder
    ? 'Anyone can list every file in your Firebase storage'
    : kind === 'probably-public'
      ? `Anyone can list the files in your ${folder} folder. Check that's on purpose`
      : `Anyone can list the files in your ${folder} folder`;
  return {
    id: findingId(CHECK_ID, 'listable', folder || 'root'),
    checkId: CHECK_ID,
    title,
    severity: SEVERITY[kind],
    source: 'live',
    evidence: [
      {
        kind: 'url',
        url: `${storage}/v0/b/${bucket}/o${folder ? `?prefix=${folder}/` : ''}`,
        detail: detailFor(answer.entries, answer.more),
      },
    ],
    lessonId: `${CHECK_ID}:listable`,
    manualFix: folder ? folderFix(folder, kind) : WHOLE_BUCKET_FIX,
    aiFix: {
      problem: title,
      request: folder
        ? `Anyone can list the files in the ${folder} folder of my Firebase Storage. Change its storage rules. ${OWNER_RULES}`
        : `My Firebase Storage rules let anyone list every file. Replace them with rules for each folder this app uses. ${OWNER_RULES}`,
    },
  };
}

/** Builds the check. Tests point `storage` at a fake server; scans use Google's. */
export function createFirebaseStorage(
  storage = 'https://firebasestorage.googleapis.com',
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

    const bucket = findFirebaseProject(site.files)?.storageBucket;
    if (!bucket) {
      return {
        status: 'skipped',
        reason:
          "We couldn't find your Firebase storage bucket in your site's code.",
      };
    }

    // The whole bucket first. If anyone can list it, that covers every folder in it.
    const root = await listFolder(storage, bucket, '', context.fetch);
    if (root.state === 'missing') {
      return {
        status: 'skipped',
        reason:
          "Your Firebase project doesn't seem to have file storage we could reach.",
      };
    }
    if (root.state === 'listable') {
      return {
        status: 'ran',
        findings: [findingFor(bucket, storage, '', root)],
      };
    }

    const findings: Finding[] = [];
    const unclear: string[] = [];
    if (root.state === 'unknown') unclear.push('your whole storage bucket');
    const folders = findFolders(site.files);
    for (const folder of folders) {
      const answer = await listFolder(storage, bucket, folder, context.fetch);
      if (answer.state === 'listable') {
        findings.push(findingFor(bucket, storage, folder, answer));
      } else if (answer.state === 'unknown') {
        unclear.push(`the ${folder} folder`);
      }
    }

    const parts = [
      ...(unclear.length > 0
        ? [`Firebase didn't give a clear answer about ${unclear.join(', ')}`]
        : []),
      ...(folders.length === 0
        ? [
            "we couldn't find which storage folders your code uses, so we only checked whether the whole bucket can be listed",
          ]
        : []),
    ];
    const note =
      parts.length > 0
        ? `We couldn't check everything: ${parts.join('; ')}.`
        : undefined;
    const sorted = sortBySeverity(findings);
    // Nothing found while something was unclear must never look like a pass.
    if (sorted.length === 0 && note) return { status: 'skipped', reason: note };
    return note
      ? { status: 'ran', findings: sorted, note }
      : { status: 'ran', findings: sorted };
  }

  return {
    id: CHECK_ID,
    title: 'Firebase file storage anyone can list',
    // Sends requests to the site's storage, so it only runs for verified owners.
    mode: 'url-active',
    platforms: ['firebase'],
    run,
  };
}

export const firebaseStorage = createFirebaseStorage();
