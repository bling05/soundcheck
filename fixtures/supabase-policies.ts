/**
 * Supabase migrations written the way Lovable and the Supabase CLI write them, with one of
 * each mistake Check #7 looks for, and safe tables next to them.
 */
export const LEAKY_MIGRATIONS: Record<string, string> = {
  'supabase/migrations/20250101000000_init.sql': `
-- Profiles, one per user.
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  user_id uuid not null,
  display_name text,
  email text
);
alter table public.profiles enable row level security;

-- Any signed-in user can read every profile: the classic mistake.
create policy "Profiles are viewable by signed in users"
  on public.profiles for select
  to authenticated
  using (auth.uid() is not null);

-- Safe: owners only.
create policy "Users update own profile" on public.profiles
  for update using ((select auth.uid()) = user_id);

/* Orders never get RLS; the create policy below doesn't help. */
create table if not exists "public"."orders" (
  "id" bigint generated always as identity primary key,
  "user_id" uuid,
  "total" numeric(10, 2),
  constraint orders_total check (total >= 0)
);
create policy "Order owners" on public.orders for select using (auth.uid() = user_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null,
  body text
);
alter table public.messages enable row level security;
create policy "Anyone can read messages" on public.messages for select using (true);
create policy "Users can post messages" on public.messages for insert to authenticated with check (true);

create table public.products (id serial primary key, name text, price int);
alter table public.products enable row level security;
create policy "Public products" on public.products for select using (true);
`,
  'supabase/migrations/20250102000000_admin.sql': `
create table public.reports (id uuid primary key, user_id uuid, body text);
alter table public.reports enable row level security;
create policy "Admins read reports" on public.reports for select
  using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');

-- Copies the role the user typed at sign-up. Its body mentions create policy; that's not a real one.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, user_id, display_name)
  values (new.id, new.id, new.raw_user_meta_data ->> 'full_name');
  update public.profiles set display_name = new.raw_user_meta_data->>'role' where id = new.id;
  -- create policy "fake" on public.products using (true);
  return new;
end;
$$;
`,
  'supabase/migrations/20250103000000_fix_notes.sql': `
create table public.notes (id uuid primary key, user_id uuid, body text);
create policy "Everyone reads notes" on public.notes for select using (true);
-- Fixed later: RLS on, the loose policy dropped.
alter table public.notes enable row level security;
drop policy if exists "Everyone reads notes" on public.notes;
create policy "Own notes" on public.notes for select using ((select auth.uid()) = user_id);
`,
};

/** A project with every table protected properly. */
export const SAFE_MIGRATIONS: Record<string, string> = {
  'supabase/migrations/001.sql': `
create table public.todos (id uuid primary key, user_id uuid not null, title text);
alter table public.todos enable row level security;
create policy "Own todos" on public.todos for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create table private.secrets (id int);
`,
};
