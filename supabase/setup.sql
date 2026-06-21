-- Run this SQL once in your Supabase SQL Editor:
-- https://app.supabase.com → your project → SQL Editor

-- Profiles table
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  display_name text,
  plan text not null default 'free',
  credits integer not null default 3,
  created_at timestamptz default now()
);

alter table profiles enable row level security;

create policy "Users can view own profile"
  on profiles for select
  using (auth.uid() = id);

create policy "Users can insert own profile"
  on profiles for insert
  with check (auth.uid() = id);

create policy "Users can update own profile"
  on profiles for update
  using (auth.uid() = id);

-- Projects table
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Untitled',
  type text not null default 'Unknown',
  content text not null default '',
  credits_used integer not null default 1,
  created_at timestamptz default now()
);

alter table projects enable row level security;

create policy "Users can manage own projects"
  on projects for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
