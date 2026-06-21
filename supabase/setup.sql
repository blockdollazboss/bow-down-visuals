-- Run this SQL once in your Supabase SQL Editor (re-run is safe — uses IF NOT EXISTS / IF NOT EXISTS):
-- https://app.supabase.com → your project → SQL Editor

-- ─────────────────────────── WAITLIST ───────────────────────────

create table if not exists waitlist (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  artist_type text,
  want_to_create text,
  social_handle text,
  message text,
  created_at timestamptz default now()
);

alter table waitlist enable row level security;

create policy if not exists "Anyone can join waitlist"
  on waitlist for insert
  with check (true);

-- ─────────────────────────── PROFILES ───────────────────────────

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  display_name text,
  plan text not null default 'free',
  credits integer not null default 3,
  created_at timestamptz default now()
);

alter table profiles enable row level security;

create policy if not exists "Users can view own profile"
  on profiles for select
  using (auth.uid() = id);

create policy if not exists "Users can insert own profile"
  on profiles for insert
  with check (auth.uid() = id);

create policy if not exists "Users can update own profile"
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
  input_data   jsonb       not null default '{}'::jsonb,
  output_data  jsonb       not null default '{}'::jsonb,
  credits_used integer     not null default 0,
  created_at   timestamptz not null default now()
);

alter table projects enable row level security;

create policy if not exists "Users can manage own projects"
  on projects for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Migration: add new columns if upgrading from old schema (safe to re-run)
do $$ begin
  if not exists (select 1 from information_schema.columns where table_name='projects' and column_name='project_type') then
    alter table projects add column project_type text not null default 'Unknown';
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
