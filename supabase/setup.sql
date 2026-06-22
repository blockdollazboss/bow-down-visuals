-- Bow Down Visuals — Supabase Database Setup
-- Safe to re-run: uses IF NOT EXISTS and DROP POLICY IF EXISTS
-- Paste the full contents into: app.supabase.com → your project → SQL Editor → Run

-- ─────────────────────────── PROFILES ───────────────────────────

create table if not exists profiles (
  id           uuid        primary key references auth.users(id) on delete cascade,
  email        text        not null default '',
  display_name text,
  plan         text        not null default 'demo',
  credits      integer     not null default 10,
  created_at   timestamptz not null default now()
);

alter table profiles enable row level security;

drop policy if exists "Users can view own profile"   on profiles;
drop policy if exists "Users can insert own profile" on profiles;
drop policy if exists "Users can update own profile" on profiles;

create policy "Users can view own profile"
  on profiles for select
  using (auth.uid() = id);

create policy "Users can insert own profile"
  on profiles for insert
  with check (auth.uid() = id);

create policy "Users can update own profile"
  on profiles for update
  using (auth.uid() = id);

-- ─────────────────────────── PROJECTS ───────────────────────────

create table if not exists projects (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users(id) on delete cascade,
  project_type text        not null default 'Unknown',
  title        text        not null default 'Untitled',
  artist_name  text,
  song_title   text,
  genre        text,
  mood         text,
  style        text,
  platform     text,
  input_data   jsonb       not null default '{}'::jsonb,
  output_data  jsonb       not null default '{}'::jsonb,
  credits_used integer     not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table projects enable row level security;

drop policy if exists "Users can read own projects"   on projects;
drop policy if exists "Users can create own projects" on projects;
drop policy if exists "Users can delete own projects" on projects;
drop policy if exists "Users can manage own projects" on projects;

create policy "Users can read own projects"
  on projects for select
  using (auth.uid() = user_id);

create policy "Users can create own projects"
  on projects for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own projects"
  on projects for delete
  using (auth.uid() = user_id);

-- ─────────────────────── MIGRATION (existing tables) ─────────────────────────
-- Adds any missing columns if the table already existed from a prior run.

do $$ begin
  -- profiles
  if not exists (select 1 from information_schema.columns where table_name='profiles' and column_name='display_name') then
    alter table profiles add column display_name text;
  end if;

  -- projects — new columns
  if not exists (select 1 from information_schema.columns where table_name='projects' and column_name='style') then
    alter table projects add column style text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='projects' and column_name='platform') then
    alter table projects add column platform text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='projects' and column_name='updated_at') then
    alter table projects add column updated_at timestamptz not null default now();
  end if;
  -- projects — columns from earlier schema versions
  if not exists (select 1 from information_schema.columns where table_name='projects' and column_name='title') then
    alter table projects add column title text not null default 'Untitled';
  end if;
  if not exists (select 1 from information_schema.columns where table_name='projects' and column_name='artist_name') then
    alter table projects add column artist_name text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='projects' and column_name='song_title') then
    alter table projects add column song_title text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='projects' and column_name='genre') then
    alter table projects add column genre text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='projects' and column_name='mood') then
    alter table projects add column mood text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='projects' and column_name='input_data') then
    alter table projects add column input_data jsonb not null default '{}'::jsonb;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='projects' and column_name='output_data') then
    alter table projects add column output_data jsonb not null default '{}'::jsonb;
  end if;
end $$;

-- ─────────────────────────── WAITLIST (optional) ─────────────────────────────

create table if not exists waitlist (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  email        text not null unique,
  artist_type  text,
  want_to_create text,
  social_handle  text,
  message      text,
  created_at   timestamptz default now()
);

alter table waitlist enable row level security;

drop policy if exists "Anyone can join waitlist" on waitlist;
create policy "Anyone can join waitlist"
  on waitlist for insert
  with check (true);
