import type { ManualFix, Severity } from '@soundcheck/report';
import { LIST_LIMIT, type BucketKind } from './rules';

export const SEVERITY: Record<BucketKind, Severity> = {
  personal: 'critical',
  unknown: 'high',
  'probably-public': 'medium',
};

export function titleFor(bucket: string, kind: BucketKind): string {
  return kind === 'probably-public'
    ? `Anyone can list the files in your ${bucket} storage. Check that's on purpose`
    : `Anyone can list the files in your ${bucket} storage`;
}

export function detailFor(entries: number): string {
  const count =
    entries >= LIST_LIMIT
      ? `at least ${LIST_LIMIT} files and folders`
      : `${entries} ${entries === 1 ? 'file or folder' : 'files and folders'}`;
  return `We could see the names of ${count} using only the public key in your site's code. We didn't open or save any of them.`;
}

const FIND_THE_RULE = `-- 1. Find the rule that lets anyone list this bucket. It's a "select" rule
--    on storage.objects, often named something like "Public Access".
select policyname, roles, qual
  from pg_policies
 where schemaname = 'storage' and tablename = 'objects' and cmd = 'SELECT';`;

export function manualFixFor(bucket: string, kind: BucketKind): ManualFix {
  if (kind === 'probably-public') {
    return {
      description:
        'Run this in the SQL editor in your Supabase dashboard. If the bucket is marked Public in Supabase, its files still load from their links without any rule, so you can usually remove the rule that lets everyone list them. Test that your images still load afterwards.',
      language: 'sql',
      snippet: `${FIND_THE_RULE}\n\n-- 2. Remove it. Put its name from step 1 in the quotes.\ndrop policy "Public Access" on storage.objects;`,
    };
  }
  return {
    description:
      "Run this in the SQL editor in your Supabase dashboard. It replaces the rule that lets everyone list this bucket with one where each signed-in user sees only their own folder. It assumes each user's files are in a folder named after their user id; if yours are stored differently, ask your AI tool to adapt it, then test uploads and downloads.",
    language: 'sql',
    snippet: `${FIND_THE_RULE}\n\n-- 2. Remove it. Put its name from step 1 in the quotes.\ndrop policy "Public Access" on storage.objects;\n\n-- 3. Each signed-in user can see only the files in their own folder.\ncreate policy "Users see their own ${bucket} files"\n  on storage.objects for select to authenticated\n  using (\n    bucket_id = '${bucket}'\n    and (select auth.uid())::text = (storage.foldername(name))[1]\n  );`,
  };
}

export function fixRequestFor(bucket: string, kind: BucketKind): string {
  return kind === 'probably-public'
    ? `Anyone can list every file in the ${bucket} storage bucket in Supabase. If these files are meant to be public, keep the bucket public so links still work, but remove the storage policy that lets everyone list or search its files. If they aren't meant to be public, make the bucket private and add policies so each user can only see their own files. Tell me which policies you changed.`
    : `Anyone can list every file in the ${bucket} storage bucket in Supabase. Make the bucket private, replace any storage policy that lets everyone read it with policies so each signed-in user can only see and change their own files, and use signed URLs where the app shows these files. Don't switch to a secret key in the browser. Check that uploads and downloads still work, and tell me which policies you added.`;
}
