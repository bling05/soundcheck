import type { ManualFix, Severity } from '@soundcheck/report';
import type { TableKind } from '../supabase-rls/rules';
import { PAGE_SIZE } from './rules';

export const SEVERITY: Record<TableKind, Severity> = {
  personal: 'critical',
  unknown: 'high',
  'probably-public': 'medium',
};

function documents(count: number, more: boolean): string {
  if (more) return `at least ${PAGE_SIZE} documents`;
  return `${count} ${count === 1 ? 'document' : 'documents'}`;
}

export function collectionDetail(count: number, more: boolean): string {
  return count === 0
    ? "Your rules let anyone read this collection. It's empty right now, but anything saved there later will be readable too."
    : `We could see ${documents(count, more)} using only the public settings in your site's code. We didn't read what's in ${count === 1 && !more ? 'it' : 'them'}.`;
}

export const OPEN_RULES_DETAIL =
  "We asked for a collection that doesn't exist, and your rules allowed it. That only happens when the rules let anyone read everything, the way test mode does.";

export function realtimeDetail(entries: number | undefined): string {
  return entries === undefined || entries === 0
    ? "Your rules let anyone read this. It's empty right now, but anything saved there later will be readable too."
    : `We could see ${entries} ${entries === 1 ? 'entry' : 'entries'} at the top level using only the public settings in your site's code. We didn't read what's inside them.`;
}

export function collectionTitle(name: string, kind: TableKind): string {
  return kind === 'probably-public'
    ? `Anyone can read your ${name} collection. Check that's on purpose`
    : `Anyone can read your ${name} collection`;
}

const FIRESTORE_RULES_STEPS =
  'Open the Firebase console, then Firestore Database, then Rules, and replace the rules there. Rules lock everything they don\'t mention, so add a rule for each collection your app uses, then test the app. Change "users" to your own collection names.';

export const FIRESTORE_FIX: ManualFix = {
  description: FIRESTORE_RULES_STEPS,
  language: 'firestore-rules',
  snippet: `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Each signed-in user can read and change only their own document.
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    // A list anyone may read, but nobody can change from the browser.
    match /products/{productId} {
      allow read: if true;
      allow write: if false;
    }
  }
}`,
};

export function collectionFix(name: string, kind: TableKind): ManualFix {
  if (kind === 'probably-public') {
    return {
      description:
        'If this collection is meant to be public, keep it readable but make sure nobody can change it from the browser. Open the Firebase console, then Firestore Database, then Rules.',
      language: 'firestore-rules',
      snippet: `match /${name}/{id} {\n  allow read: if true;\n  allow write: if false;\n}`,
    };
  }
  return {
    description:
      'Open the Firebase console, then Firestore Database, then Rules, and change the rule for this collection so each signed-in user can only reach their own documents. This example assumes each document saves its owner in a field called ownerId.',
    language: 'firestore-rules',
    snippet: `match /${name}/{id} {\n  allow read, update, delete: if request.auth != null\n    && request.auth.uid == resource.data.ownerId;\n  allow create: if request.auth != null\n    && request.auth.uid == request.resource.data.ownerId;\n}`,
  };
}

export const REALTIME_FIX: ManualFix = {
  description:
    'Open the Firebase console, then Realtime Database, then Rules, and replace the rules there. This locks everything, then lets each signed-in user reach only their own data under users. Add a rule for each part of the database your app uses, then test the app.',
  language: 'json',
  snippet: `{
  "rules": {
    ".read": false,
    ".write": false,
    "users": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": "auth != null && auth.uid === $uid"
      }
    }
  }
}`,
};

const OWNER_RULES =
  "Each signed-in user should only be able to read and change their own data. Don't use a rule that lets everyone read everything, and don't move database access to a server key in the browser. Check that every part of the app still works, and tell me which rules you wrote.";

export const FIRESTORE_FIX_REQUEST = `My Firestore security rules let anyone read every collection, like test mode. Replace them with rules for each collection this app uses. ${OWNER_RULES}`;

export function collectionFixRequest(name: string, kind: TableKind): string {
  return kind === 'probably-public'
    ? `Anyone can read the ${name} collection in Firestore. If it's meant to be public, change its rule so anyone can read it but nobody can change it from the browser. If it isn't, ${OWNER_RULES.charAt(0).toLowerCase()}${OWNER_RULES.slice(1)}`
    : `Anyone can read the ${name} collection in Firestore. Change its security rules. ${OWNER_RULES}`;
}

export const REALTIME_FIX_REQUEST = `My Firebase Realtime Database rules let anyone read it. Replace them so everything is locked by default, then add rules for each part of the database this app uses. ${OWNER_RULES}`;
