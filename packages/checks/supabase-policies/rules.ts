import type { Place, Policy, Schema } from './schema';
import { insideParens } from './sql';

export type PolicyRuleId =
  | 'rls-off'
  | 'everyone-can-read'
  | 'any-user-can-read'
  | 'write-as-anyone'
  | 'trusts-user-metadata';

export interface Problem {
  rule: PolicyRuleId;
  table: string;
  place: Place;
  /** The policy's name, when the problem is in one. */
  policy?: string;
}

export type Condition =
  /** `true`: no condition at all. */
  | 'always'
  /** Only checks that someone is signed in, which anyone can be by signing up. */
  | 'any-signed-in-user'
  /** Uses a value the user can set themselves. */
  | 'user-metadata'
  /** Compares the signed-in user to the row, or does something we don't judge. */
  | 'other';

function withoutOuterParens(expression: string): string {
  let text = expression;
  while (text.startsWith('(') && insideParens(text, 0) === text.slice(1, -1)) {
    text = text.slice(1, -1);
  }
  return text;
}

const ANY_SIGNED_IN_USER = [
  'auth.uid()isnotnull',
  '(selectauth.uid())isnotnull',
  "auth.role()='authenticated'",
  "(selectauth.role())='authenticated'",
  "auth.jwt()->>'role'='authenticated'",
  "(selectauth.jwt())->>'role'='authenticated'",
];

/** What a policy condition really allows, judged from its text. */
export function judgeCondition(expression: string): Condition {
  const compact = withoutOuterParens(
    expression.toLowerCase().replace(/\s+/g, ''),
  );
  if (/user_metadata|raw_user_meta_data/.test(compact)) return 'user-metadata';
  if (compact === 'true') return 'always';
  if (ANY_SIGNED_IN_USER.includes(compact)) return 'any-signed-in-user';
  return 'other';
}

const ANYONE = new Set(['public', 'anon']);
/** Columns that say who a row belongs to. */
const OWNER_COLUMN =
  /^(user_id|owner_id|author_id|profile_id|created_by|owner|user|uid|account_id|member_id|customer_id)$/;

/** Who a read policy lets in, if it's too loose. */
function readProblem(policy: Policy): PolicyRuleId | undefined {
  if (policy.command !== 'select' && policy.command !== 'all') return undefined;
  if (policy.using === undefined) return undefined;
  const condition = judgeCondition(policy.using);
  if (condition === 'always') {
    return policy.roles.some((role) => ANYONE.has(role))
      ? 'everyone-can-read'
      : 'any-user-can-read';
  }
  return condition === 'any-signed-in-user' ? 'any-user-can-read' : undefined;
}

/**
 * Whether a write policy lets people save rows under someone else's name. Postgres reuses
 * USING as the check for UPDATE and ALL when WITH CHECK is left out, so only a check
 * that's there and too loose counts.
 */
function writesAsAnyone(policy: Policy): boolean {
  if (policy.command === 'select' || policy.command === 'delete') return false;
  const check =
    policy.check ?? (policy.command === 'insert' ? undefined : policy.using);
  if (check === undefined) return false;
  const condition = judgeCondition(check);
  return condition === 'always' || condition === 'any-signed-in-user';
}

const usesMetadata = (policy: Policy) =>
  [policy.using, policy.check].some(
    (expression) =>
      expression !== undefined &&
      judgeCondition(expression) === 'user-metadata',
  );

/** Every problem in the schema, table by table, in a fixed order. */
export function findProblems(
  schema: Schema,
  isMeantToBePublic: (table: string) => boolean,
): Problem[] {
  const problems: Problem[] = [];
  const tables = [...schema.tables.values()].sort((a, b) =>
    a.table.localeCompare(b.table),
  );

  for (const { table, rls, created, columns, policies } of tables) {
    if (!rls) {
      problems.push({ rule: 'rls-off', table, place: created });
      // With RLS off, its policies do nothing, so judging them would only add noise.
      continue;
    }
    const hasOwner = [...columns].some((column) => OWNER_COLUMN.test(column));
    const seen = new Set<PolicyRuleId>();
    for (const policy of [...policies.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const found: PolicyRuleId[] = [];
      if (usesMetadata(policy)) found.push('trusts-user-metadata');
      const read = readProblem(policy);
      // A product list anyone may read is often the point, so it isn't reported.
      if (read && !isMeantToBePublic(table)) found.push(read);
      if (hasOwner && writesAsAnyone(policy)) found.push('write-as-anyone');
      for (const rule of found) {
        if (seen.has(rule)) continue;
        seen.add(rule);
        problems.push({
          rule,
          table,
          place: policy.place,
          policy: policy.name,
        });
      }
    }
  }

  for (const { key, place } of schema.metadataCopies) {
    problems.push({ rule: 'trusts-user-metadata', table: key, place });
  }
  return problems;
}
