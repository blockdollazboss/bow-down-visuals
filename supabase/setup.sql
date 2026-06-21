-- Run this SQL once in your Supabase SQL Editor (re-run is safe):
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

drop policy if exists "Anyone can join waitlist" on waitlist;
create policy "Anyone can join waitlist"
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

drop policy if exists "Users can view own profile" on profiles;
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
  input_data   jsonb       not null default '{}'::jsonb,
  output_data  jsonb       not null default '{}'::jsonb,
  credits_used integer     not null default 0,
  created_at   timestamptz not null default now()
);

alter table projects enable row level security;

drop policy if exists "Users can manage own projects" on projects;
create policy "Users can manage own projects"
  on projects for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
