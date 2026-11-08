import type { ManualFix, Severity } from '@soundcheck/report';
import type { TableKind } from '../supabase-rls/rules';
import type { PolicyRuleId, Problem } from './rules';

const BY_KIND: Record<TableKind, Severity> = {
  personal: 'critical',
  unknown: 'high',
  'probably-public': 'medium',
};

export function severityFor(rule: PolicyRuleId, kind: TableKind): Severity {
  switch (rule) {
    case 'trusts-user-metadata':
      return 'critical';
    case 'write-as-anyone':
      return kind === 'personal' ? 'critical' : 'high';
    default:
      return BY_KIND[kind];
  }
}

export function titleFor({ rule, table }: Problem): string {
  switch (rule) {
    case 'rls-off':
      return `Your ${table} table never turns on Row Level Security`;
    case 'everyone-can-read':
      return `A rule lets anyone read your ${table} table`;
    case 'any-user-can-read':
      return `A rule lets any signed-in user read all of your ${table} table`;
    case 'write-as-anyone':
      return `Signed-in users can save ${table} rows under someone else's name`;
    case 'trusts-user-metadata':
      return 'Your database trusts a value users can change themselves';
  }
}

export function detailFor({ rule, policy, table }: Problem): string {
  const named = policy ? `The policy "${policy}"` : 'This rule';
  switch (rule) {
    case 'rls-off':
      return "This migration creates the table, and no later migration turns Row Level Security on for it, so anyone with your site's public key can read and change it.";
    case 'everyone-can-read':
      return `${named} allows reading every row with no condition, for everyone, including visitors who aren't signed in.`;
    case 'any-user-can-read':
      return `${named} allows reading every row as long as someone is signed in. Anyone can sign up, so that's almost everyone.`;
    case 'write-as-anyone':
      return `${named} lets a signed-in user save rows without checking that the owner column is them.`;
    case 'trusts-user-metadata':
      return policy
        ? `${named} decides access using user_metadata, which every user can edit for their own account.`
        : `This function copies "${table}" from the details a user typed at sign-up, which they can set to anything.`;
  }
}

export function fixFor({ rule, table, policy }: Problem): ManualFix {
  const sql = (snippet: string, description: string): ManualFix => ({
    description,
    language: 'sql',
    snippet,
  });
  const ownerPolicy = `-- Each signed-in user can only reach their own rows.
create policy "Users read their own ${table}"
  on public.${table} for select to authenticated
  using ((select auth.uid()) = user_id);`;
  switch (rule) {
    case 'rls-off':
      return sql(
        `alter table public.${table} enable row level security;\n\n${ownerPolicy}`,
        'Add a new migration that turns RLS on, with a policy for each way your app uses the table. Turning RLS on blocks everything no policy allows, so test the app afterwards. Change user_id to the column that says who owns each row.',
      );
    case 'everyone-can-read':
    case 'any-user-can-read':
      return sql(
        `drop policy "${policy ?? 'the policy'}" on public.${table};\n\n${ownerPolicy}`,
        'Add a new migration that replaces this policy with one that only lets people read their own rows. If some rows really are public, add a condition for those, like a published column.',
      );
    case 'write-as-anyone':
      return sql(
        `drop policy "${policy ?? 'the policy'}" on public.${table};\n\ncreate policy "Users create their own ${table}"\n  on public.${table} for insert to authenticated\n  with check ((select auth.uid()) = user_id);`,
        'Add a new migration that replaces this policy, so a new or changed row must belong to the person saving it. Change user_id to your owner column.',
      );
    case 'trusts-user-metadata':
      return sql(
        `-- Read roles from a table only admins can change, not user_metadata.\ncreate table public.user_roles (\n  user_id uuid primary key references auth.users on delete cascade,\n  role text not null default 'user'\n);\nalter table public.user_roles enable row level security;\ncreate policy "Users read their own role"\n  on public.user_roles for select to authenticated\n  using ((select auth.uid()) = user_id);\n-- In policies: exists (select 1 from public.user_roles r\n--   where r.user_id = (select auth.uid()) and r.role = 'admin')`,
        "Keep roles somewhere users can't edit, like a user_roles table that only admins or your server can write, or app_metadata, which only your server can set. Then check that instead of user_metadata.",
      );
  }
}

export function fixRequestFor({ rule, table, policy }: Problem): string {
  const policyName = policy ? `the "${policy}" policy on ` : '';
  switch (rule) {
    case 'rls-off':
      return `The ${table} table in my Supabase migrations never turns on Row Level Security. Add a new migration that enables it and adds policies so each signed-in user can only read and change their own rows. Don't use a policy that lets everyone read everything. Check every part of the app that uses this table still works, and tell me which policies you added.`;
    case 'everyone-can-read':
    case 'any-user-can-read':
      return `${policyName ? `Replace ${policyName}` : 'Replace the policy on '}the ${table} table in my Supabase migrations: it lets ${rule === 'everyone-can-read' ? 'anyone' : 'any signed-in user'} read every row. Add a new migration so each user can only read their own rows, or only rows that are meant to be public. Don't edit old migrations. Tell me what you changed.`;
    case 'write-as-anyone':
      return `${policyName ? `Fix ${policyName}` : 'Fix the insert and update policies on '}the ${table} table in my Supabase migrations: it lets a signed-in user save rows owned by someone else. In a new migration, make the WITH CHECK require that the owner column equals auth.uid(). Tell me which column you used.`;
    case 'trusts-user-metadata':
      return "My Supabase policies or functions decide roles or permissions from user_metadata (raw_user_meta_data), which users can edit themselves. Move roles to a place users can't change, such as a user_roles table only the server can write, or app_metadata, and update every policy and function that reads them. Don't copy roles from sign-up data. Tell me everything you changed.";
  }
}
