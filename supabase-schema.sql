create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  account text not null unique check (account ~ '^[0-9]{8}$'),
  display_name text not null,
  chat_muted boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.checkin_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  checkin_date date not null,
  month text not null,
  created_at timestamptz not null default now(),
  unique (user_id, checkin_date)
);

create index if not exists idx_checkin_records_month
on public.checkin_records(month);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null default 'text' check (type in ('text', 'image')),
  text text not null default '',
  image_data text,
  image_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

create index if not exists idx_push_subscriptions_user_id
on public.push_subscriptions(user_id);

create index if not exists idx_push_subscriptions_enabled
on public.push_subscriptions(enabled);

alter table public.profiles enable row level security;
alter table public.checkin_records enable row level security;
alter table public.chat_messages enable row level security;
alter table public.push_subscriptions enable row level security;

drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated"
on public.profiles for select
to authenticated
using (true);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles for insert
to authenticated
with check (id = auth.uid());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "profiles_delete_super_admin" on public.profiles;
create policy "profiles_delete_super_admin"
on public.profiles for delete
to authenticated
using (
  exists (
    select 1 from public.profiles admin
    where admin.id = auth.uid()
      and admin.account = '20010927'
  )
  and id <> auth.uid()
);

drop policy if exists "checkins_select_authenticated" on public.checkin_records;
create policy "checkins_select_authenticated"
on public.checkin_records for select
to authenticated
using (true);

drop policy if exists "checkins_insert_own" on public.checkin_records;
create policy "checkins_insert_own"
on public.checkin_records for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "checkins_delete_super_admin" on public.checkin_records;
create policy "checkins_delete_super_admin"
on public.checkin_records for delete
to authenticated
using (
  exists (
    select 1 from public.profiles admin
    where admin.id = auth.uid()
      and admin.account = '20010927'
  )
);

drop policy if exists "messages_select_authenticated" on public.chat_messages;
create policy "messages_select_authenticated"
on public.chat_messages for select
to authenticated
using (true);

drop policy if exists "messages_insert_own" on public.chat_messages;
create policy "messages_insert_own"
on public.chat_messages for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "messages_delete_super_admin" on public.chat_messages;
create policy "messages_delete_super_admin"
on public.chat_messages for delete
to authenticated
using (
  exists (
    select 1 from public.profiles admin
    where admin.id = auth.uid()
      and admin.account = '20010927'
  )
);

drop policy if exists "messages_delete_own" on public.chat_messages;
create policy "messages_delete_own"
on public.chat_messages for delete
to authenticated
using (user_id = auth.uid());

drop policy if exists "push_subscriptions_select_own" on public.push_subscriptions;
create policy "push_subscriptions_select_own"
on public.push_subscriptions for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "push_subscriptions_insert_own" on public.push_subscriptions;
create policy "push_subscriptions_insert_own"
on public.push_subscriptions for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "push_subscriptions_update_own" on public.push_subscriptions;
create policy "push_subscriptions_update_own"
on public.push_subscriptions for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "push_subscriptions_delete_own" on public.push_subscriptions;
create policy "push_subscriptions_delete_own"
on public.push_subscriptions for delete
to authenticated
using (user_id = auth.uid());
