-- コイン記録: cloud setup. Run once in Supabase: SQL Editor -> New query -> paste all -> Run.
-- (This project is only for コイン記録; the ライブ記録 app has its own, separate project.)
--
-- Login is by user name + password. Supabase needs an e-mail address, so the app turns the
-- name into "<name>@nunonuno08.github.io" (never shown, no mail is ever sent: Confirm email is off).

/* ---------- 1. each person's own data (sync between their devices) ---------- */

create table if not exists public.records (
  user_id    uuid        not null default auth.uid() references auth.users on delete cascade,
  kind       text        not null check (kind in ('records', 'settings')),
  id         text        not null,
  data       jsonb,
  deleted    boolean     not null default false,
  updated_at bigint      not null,               -- when the change was made on the phone (ms)
  server_at  timestamptz not null default now(), -- when the server received it (for "what's new")
  primary key (user_id, kind, id)
);

create index if not exists records_changes on public.records (user_id, server_at);

-- Keep the newer change: an update carrying an older timestamp is ignored.
create or replace function public.records_keep_newest() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return null;
  end if;
  new.server_at := now();
  return new;
end $$;

drop trigger if exists records_keep_newest on public.records;
create trigger records_keep_newest before insert or update on public.records
  for each row execute function public.records_keep_newest();

grant select, insert, update, delete on public.records to authenticated;
alter table public.records enable row level security;
drop policy if exists "own records" on public.records;
create policy "own records" on public.records
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

/* ---------- 2. what friends see of each other (なかま) ---------- */

-- One row per person, written by that person's app: only totals, never the readings.
create table if not exists public.summaries (
  user_id    uuid        primary key default auth.uid() references auth.users on delete cascade,
  username   text        not null,
  name       text        not null,
  coins      bigint,                          -- coins at the latest reading
  last_at    bigint,                          -- time of the latest reading (ms)
  streak     integer     not null default 0,  -- days in a row with a reading
  days       jsonb       not null default '{}', -- { "2026-11-08": 150000, ... } recent days
  weeks      jsonb       not null default '{}', -- { "2026-11-02": 900000, ... } recent weeks (Monday)
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.summaries to authenticated;
alter table public.summaries enable row level security;
-- Everyone logged in may look (only invited people can have an account)...
drop policy if exists "members read" on public.summaries;
create policy "members read" on public.summaries for select to authenticated using (true);
-- ...but each person writes only their own row.
drop policy if exists "own summary insert" on public.summaries;
drop policy if exists "own summary update" on public.summaries;
drop policy if exists "own summary delete" on public.summaries;
create policy "own summary insert" on public.summaries for insert to authenticated with check (auth.uid() = user_id);
create policy "own summary update" on public.summaries for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own summary delete" on public.summaries for delete to authenticated using (auth.uid() = user_id);

/* ---------- 3. only invited user names can register ---------- */

-- To invite someone: Table Editor -> signup_allowlist -> Insert row (username: half-width
-- letters / numbers, as they will type it), or run:
--   insert into public.signup_allowlist (username, note) values ('yumi', 'Yumi');
create table if not exists public.signup_allowlist (
  username text        primary key,
  note     text,
  added_at timestamptz not null default now()
);

-- Edited in the dashboard only: the app's keys can neither read nor change it.
alter table public.signup_allowlist enable row level security;
revoke all on public.signup_allowlist from anon, authenticated;

create or replace function public.check_signup_allowlist() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.signup_allowlist
    where lower(new.email) = lower(username) || '@nunonuno08.github.io'
  ) then
    raise exception 'This user name is not invited';
  end if;
  return new;
end $$;

revoke execute on function public.check_signup_allowlist() from public, anon, authenticated;

drop trigger if exists check_signup_allowlist on auth.users;
create trigger check_signup_allowlist before insert on auth.users
  for each row execute function public.check_signup_allowlist();

/* ---------- 4. keep-alive ---------- */

-- A GitHub Actions job calls this a few times a day so the free project is never paused
-- for inactivity. It only returns the current time.
create or replace function public.ping() returns timestamptz
language sql stable as $$ select now() $$;
grant execute on function public.ping() to anon;
