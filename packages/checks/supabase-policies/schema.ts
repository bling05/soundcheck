import type { RepoFile } from '../repo';
import { insideParens, splitStatements, tableName } from './sql';

export interface Place {
  path: string;
  line: number;
}

export type Command = 'all' | 'select' | 'insert' | 'update' | 'delete';

export interface Policy {
  name: string;
  command: Command;
  /** Lower case. No `to` clause means `public`, which is every role. */
  roles: string[];
  using?: string;
  check?: string;
  place: Place;
}

export interface Table {
  table: string;
  columns: Set<string>;
  rls: boolean;
  created: Place;
  policies: Map<string, Policy>;
}

export interface MetadataCopy {
  /** The user_metadata key copied, like `role`. */
  key: string;
  place: Place;
}

export interface Schema {
  /** Tables in the public schema, by name, as the migrations leave them. */
  tables: Map<string, Table>;
  /** Functions that copy a role-like value from sign-up data, which users choose. */
  metadataCopies: MetadataCopy[];
  filesRead: number;
}

/** Migration files, in the order Supabase runs them: by file name. */
export function migrationFiles(files: readonly RepoFile[]): RepoFile[] {
  return files
    .filter(
      ({ path }) =>
        path.endsWith('.sql') &&
        /(?:^|\/)(?:supabase\/migrations|migrations)\//.test(path),
    )
    .sort((a, b) => a.path.localeCompare(b.path));
}

// `profiles`, `public.profiles`, or `"public"."profiles"`, the way the Supabase CLI writes it.
const NAME = '((?:"[^"]+"|\\w+)(?:\\.(?:"[^"]+"|\\w+))?)';
const CREATE_TABLE = new RegExp(
  `^create (?:unlogged )?table (?:if not exists )?${NAME} ?\\(`,
  'i',
);
const RLS_CHANGE = new RegExp(
  `^alter table (?:if exists )?(?:only )?${NAME} (enable|disable) row level security`,
  'i',
);
const ADD_COLUMN = new RegExp(
  `^alter table (?:if exists )?(?:only )?${NAME} add (?:column )?(?:if not exists )?("?\\w+"?)`,
  'i',
);
const DROP_TABLE = new RegExp(`^drop table (?:if exists )?${NAME}`, 'i');
const CREATE_POLICY = new RegExp(
  `^create policy ("[^"]+"|\\w+) on ${NAME}(.*)$`,
  'i',
);
const DROP_POLICY = new RegExp(
  `^drop policy (?:if exists )?("[^"]+"|\\w+) on ${NAME}`,
  'i',
);
// Keys that decide what someone may do. A display name copied from sign-up is fine.
const ROLE_KEY =
  /raw_user_meta_data\s*->>?\s*'(role|roles|user_role|is_admin|admin|plan|tier|subscription|permissions)'/i;

const CONSTRAINT_START =
  /^(constraint|primary|foreign|unique|check|exclude|like)\b/i;

function columnsOf(body: string): Set<string> {
  const columns = new Set<string>();
  let depth = 0;
  let start = 0;
  const parts: string[] = [];
  for (let index = 0; index < body.length; index++) {
    const char = body[index];
    if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (char === ',' && depth === 0) {
      parts.push(body.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(body.slice(start));
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed || CONSTRAINT_START.test(trimmed)) continue;
    const name = /^"?(\w+)"?/.exec(trimmed)?.[1];
    if (name) columns.add(name.toLowerCase());
  }
  return columns;
}

const unquote = (name: string) => name.replace(/^"|"$/g, '').toLowerCase();

function parsePolicy(name: string, rest: string, place: Place): Policy {
  const lower = rest.toLowerCase();
  const command = (/\bfor (all|select|insert|update|delete)\b/.exec(
    lower,
  )?.[1] ?? 'all') as Command;
  const roles = /\bto ((?:[\w"]+\s*,\s*)*[\w"]+)/
    .exec(lower)?.[1]
    ?.split(',')
    .map((role) => unquote(role.trim())) ?? ['public'];
  const clause = (keyword: RegExp) => {
    const match = keyword.exec(rest);
    return match
      ? insideParens(rest, match.index + match[0].length - 1)
      : undefined;
  };
  const using = clause(/\busing\s*\(/i);
  const check = clause(/\bwith check\s*\(/i);
  return {
    name: unquote(name),
    command,
    roles,
    ...(using !== undefined && { using }),
    ...(check !== undefined && { check }),
    place,
  };
}

/** Plays every migration in order and returns the tables and rules they leave behind. */
export function readSchema(files: readonly RepoFile[]): Schema {
  const tables = new Map<string, Table>();
  const metadataCopies: MetadataCopy[] = [];
  const migrations = migrationFiles(files);

  for (const { path, text } of migrations) {
    for (const { text: statement, line } of splitStatements(text)) {
      const place = { path, line };

      const created = CREATE_TABLE.exec(statement);
      if (created?.[1]) {
        const { schema, table } = tableName(created[1]);
        if (schema !== 'public') continue;
        const body = insideParens(statement, created[0].length - 1) ?? '';
        tables.set(table, {
          table,
          columns: columnsOf(body),
          rls: false,
          created: place,
          policies: new Map(),
        });
        continue;
      }

      const rls = RLS_CHANGE.exec(statement);
      if (rls?.[1]) {
        const entry = tables.get(tableName(rls[1]).table);
        if (entry) entry.rls = rls[2]?.toLowerCase() === 'enable';
        continue;
      }

      const added = ADD_COLUMN.exec(statement);
      if (added?.[1] && added[2]) {
        tables.get(tableName(added[1]).table)?.columns.add(unquote(added[2]));
        continue;
      }

      const dropped = DROP_TABLE.exec(statement);
      if (dropped?.[1]) {
        tables.delete(tableName(dropped[1]).table);
        continue;
      }

      const policy = CREATE_POLICY.exec(statement);
      if (policy?.[1] && policy[2]) {
        const entry = tables.get(tableName(policy[2]).table);
        if (entry) {
          const parsed = parsePolicy(policy[1], policy[3] ?? '', place);
          entry.policies.set(parsed.name, parsed);
        }
        continue;
      }

      const droppedPolicy = DROP_POLICY.exec(statement);
      if (droppedPolicy?.[1] && droppedPolicy[2]) {
        tables
          .get(tableName(droppedPolicy[2]).table)
          ?.policies.delete(unquote(droppedPolicy[1]));
        continue;
      }

      if (/^create (?:or replace )?function\b/i.test(statement)) {
        const key = ROLE_KEY.exec(statement)?.[1];
        if (key) metadataCopies.push({ key: key.toLowerCase(), place });
      }
    }
  }
  return { tables, metadataCopies, filesRead: migrations.length };
}
