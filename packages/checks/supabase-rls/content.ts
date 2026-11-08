import type { ManualFix, Severity } from '@soundcheck/report';
import type { TableKind } from './rules';

export const SEVERITY: Record<TableKind, Severity> = {
  personal: 'critical',
  unknown: 'high',
  'probably-public': 'medium',
};

export function titleFor(table: string, kind: TableKind): string {
  return kind === 'probably-public'
    ? `Anyone can read your ${table} table. Check that's on purpose`
    : `Anyone can read your ${table} table`;
}

function plural(count: number): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? 'row' : 'rows'}`;
}

export function detailFor(rows: number): string {
  return `We counted ${plural(rows)} using only the public key in your site's code. We didn't read any of them.`;
}

export function manualFixFor(table: string, kind: TableKind): ManualFix {
  if (kind === 'probably-public') {
    return {
      description:
        'If this table is meant to be public, keep it readable but make sure nobody can change it: turn RLS on and allow reading only. With RLS off, anyone can usually edit or delete these rows too.',
      language: 'sql',
      snippet: `alter table public.${table} enable row level security;\n\ncreate policy "Anyone can read ${table}"\n  on public.${table} for select\n  using (true);`,
    };
  }
  return {
    description:
      "Run this in the SQL editor in your Supabase dashboard. Turning RLS on blocks every read no rule allows, including your own app's, so add a rule for each way your app uses this table, then test the app. Change user_id to the column that says who owns each row.",
    language: 'sql',
    snippet: `alter table public.${table} enable row level security;\n\n-- Each signed-in user can read only their own rows.\ncreate policy "Users read their own ${table}"\n  on public.${table} for select to authenticated\n  using ((select auth.uid()) = user_id);`,
  };
}

export function fixRequestFor(table: string, kind: TableKind): string {
  return kind === 'probably-public'
    ? `Turn on Row Level Security for the ${table} table. If it's meant to be public, add a policy that lets anyone read it but nobody change it without permission. If it isn't meant to be public, add policies so each user can only read and change their own rows. Tell me which policies you added.`
    : `Turn on Row Level Security for the ${table} table and add policies so each signed-in user can only read and change their own rows. Don't use a policy that lets everyone read everything, and don't switch to a secret key in the browser. Check that every part of the app that uses this table still works, and tell me which policies you added.`;
}
