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
drop policy if exists "Users can update own projects" on projects;
drop policy if exists "Users can manage own projects" on projects;

create policy "Users can read own projects"
  on projects for select
  using (auth.uid() = user_id);

create policy "Users can create own projects"
  on projects for insert
  with check (auth.uid() = user_id);

create policy "Users can update own projects"
  on projects for update
  using (auth.uid() = user_id);

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

-- ─────────────────────────── ARTIST VAULTS ───────────────────────────────────

create table if not exists artist_vaults (
  id                    uuid        primary key default gen_random_uuid(),
  user_id               uuid        not null references auth.users(id) on delete cascade,
  artist_name           text        not null default '',
  artist_type           text,
  artist_description    text,
  genre                 text,
  visual_style          text,
  hair                  text,
  tattoos               text,
  jewelry               text,
  clothing_style        text,
  brand_colors          text,
  logo_description      text,
  image_reference_notes text,
  do_not_change_rules   text,
  special_style_rules   text,
  photo_url             text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- If the table already exists, add the photo_url column safely
alter table artist_vaults add column if not exists photo_url text;

-- ─────────────────────────── STORAGE: ARTIST PHOTOS ──────────────────────────

insert into storage.buckets (id, name, public)
values ('artist-photos', 'artist-photos', true)
on conflict (id) do nothing;

drop policy if exists "Authenticated users can upload artist photos" on storage.objects;
drop policy if exists "Anyone can view artist photos"                on storage.objects;
drop policy if exists "Users can delete own artist photos"          on storage.objects;
drop policy if exists "Users can update own artist photos"          on storage.objects;

create policy "Authenticated users can upload artist photos"
  on storage.objects for insert
  with check (bucket_id = 'artist-photos' and auth.role() = 'authenticated');

create policy "Anyone can view artist photos"
  on storage.objects for select
  using (bucket_id = 'artist-photos');

create policy "Users can delete own artist photos"
  on storage.objects for delete
  using (bucket_id = 'artist-photos' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can update own artist photos"
  on storage.objects for update
  using (bucket_id = 'artist-photos' and auth.uid()::text = (storage.foldername(name))[1]);

-- ─────────────────────────── STORAGE: AUDIO STEMS ────────────────────────────
-- Music Studio stem uploads (WAV/MP3/M4A/FLAC). Files are stored under a
-- per-user folder: `${auth.uid}/...` so users can only delete their own.

insert into storage.buckets (id, name, public)
values ('audio-stems', 'audio-stems', true)
on conflict (id) do nothing;

drop policy if exists "Authenticated users can upload audio stems" on storage.objects;
drop policy if exists "Anyone can view audio stems"                on storage.objects;
drop policy if exists "Users can delete own audio stems"           on storage.objects;
drop policy if exists "Users can update own audio stems"           on storage.objects;

create policy "Authenticated users can upload audio stems"
  on storage.objects for insert
  with check (bucket_id = 'audio-stems' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Anyone can view audio stems"
  on storage.objects for select
  using (bucket_id = 'audio-stems');

create policy "Users can delete own audio stems"
  on storage.objects for delete
  using (bucket_id = 'audio-stems' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can update own audio stems"
  on storage.objects for update
  using (bucket_id = 'audio-stems' and auth.uid()::text = (storage.foldername(name))[1]);

alter table artist_vaults enable row level security;

drop policy if exists "Users can read own artist vaults"   on artist_vaults;
drop policy if exists "Users can create own artist vaults" on artist_vaults;
drop policy if exists "Users can update own artist vaults" on artist_vaults;
drop policy if exists "Users can delete own artist vaults" on artist_vaults;

create policy "Users can read own artist vaults"
  on artist_vaults for select
  using (auth.uid() = user_id);

create policy "Users can create own artist vaults"
  on artist_vaults for insert
  with check (auth.uid() = user_id);

create policy "Users can update own artist vaults"
  on artist_vaults for update
  using (auth.uid() = user_id);

create policy "Users can delete own artist vaults"
  on artist_vaults for delete
  using (auth.uid() = user_id);

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

-- ─────────────────────────── 2026-06-30 APP COMPLETION PATCH ───────────────
-- Safe to re-run. This aligns Supabase with the current TypeScript app/schema.

create extension if not exists pgcrypto;

-- Current Artist Vault code uses these columns. Older setup.sql versions did not.
alter table artist_vaults add column if not exists voice_style text;
alter table artist_vaults add column if not exists personality text;
alter table artist_vaults add column if not exists reference_image_url text;
alter table artist_vaults add column if not exists reference_image_path text;
alter table artist_vaults add column if not exists consistency_prompt text;
alter table artist_vaults add column if not exists is_active boolean not null default false;

-- Backfill from older photo_url column if it exists.
do $$ begin
  if exists (select 1 from information_schema.columns where table_name='artist_vaults' and column_name='photo_url') then
    update artist_vaults
       set reference_image_url = coalesce(reference_image_url, photo_url)
     where reference_image_url is null and photo_url is not null;
  end if;
end $$;

-- The frontend uploads artist reference images to this bucket.
insert into storage.buckets (id, name, public)
values ('artist-references', 'artist-references', true)
on conflict (id) do nothing;

drop policy if exists "Authenticated users can upload artist references" on storage.objects;
drop policy if exists "Anyone can view artist references" on storage.objects;
drop policy if exists "Users can delete own artist references" on storage.objects;
drop policy if exists "Users can update own artist references" on storage.objects;

create policy "Authenticated users can upload artist references"
  on storage.objects for insert
  with check (bucket_id = 'artist-references' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Anyone can view artist references"
  on storage.objects for select
  using (bucket_id = 'artist-references');

create policy "Users can delete own artist references"
  on storage.objects for delete
  using (bucket_id = 'artist-references' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can update own artist references"
  on storage.objects for update
  using (bucket_id = 'artist-references' and auth.uid()::text = (storage.foldername(name))[1]);

-- ─────────────────────────── GENERATED CLIPS ────────────────────────────────

create table if not exists generated_clips (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  project_id     uuid,
  scene_id       text,
  title          text,
  prompt         text,
  final_prompt   text,
  runway_job_id  text,
  video_url      text,
  thumbnail_url  text,
  status         text not null default 'completed',
  created_at     timestamptz not null default now()
);

alter table generated_clips enable row level security;

drop policy if exists "Users can read own generated clips" on generated_clips;
drop policy if exists "Users can create own generated clips" on generated_clips;
drop policy if exists "Users can update own generated clips" on generated_clips;
drop policy if exists "Users can delete own generated clips" on generated_clips;

create policy "Users can read own generated clips"
  on generated_clips for select
  using (auth.uid() = user_id);
create policy "Users can create own generated clips"
  on generated_clips for insert
  with check (auth.uid() = user_id);
create policy "Users can update own generated clips"
  on generated_clips for update
  using (auth.uid() = user_id);
create policy "Users can delete own generated clips"
  on generated_clips for delete
  using (auth.uid() = user_id);

create index if not exists generated_clips_user_created_idx
  on generated_clips (user_id, created_at desc);

-- ─────────────────────────── PROJECT DRAFTS ─────────────────────────────────

create table if not exists project_drafts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  workflow_type text not null,
  title         text,
  draft_data    jsonb not null default '{}'::jsonb,
  updated_at    timestamptz not null default now(),
  constraint project_drafts_user_workflow_uniq unique (user_id, workflow_type)
);

alter table project_drafts enable row level security;

drop policy if exists "Users can read own drafts" on project_drafts;
drop policy if exists "Users can create own drafts" on project_drafts;
drop policy if exists "Users can update own drafts" on project_drafts;
drop policy if exists "Users can delete own drafts" on project_drafts;

create policy "Users can read own drafts"
  on project_drafts for select
  using (auth.uid() = user_id);
create policy "Users can create own drafts"
  on project_drafts for insert
  with check (auth.uid() = user_id);
create policy "Users can update own drafts"
  on project_drafts for update
  using (auth.uid() = user_id);
create policy "Users can delete own drafts"
  on project_drafts for delete
  using (auth.uid() = user_id);

create index if not exists project_drafts_user_updated_idx
  on project_drafts (user_id, updated_at desc);

-- ─────────────────────────── CREDIT HISTORY ─────────────────────────────────

create table if not exists credit_usage (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  action        text not null,
  credits_used  integer not null,
  project_id    uuid,
  created_at    timestamptz not null default now()
);

alter table credit_usage enable row level security;

drop policy if exists "Users can read own credit usage" on credit_usage;
drop policy if exists "Users can create own credit usage" on credit_usage;

create policy "Users can read own credit usage"
  on credit_usage for select
  using (auth.uid() = user_id);
create policy "Users can create own credit usage"
  on credit_usage for insert
  with check (auth.uid() = user_id);

create index if not exists credit_usage_user_created_idx
  on credit_usage (user_id, created_at desc);

-- ─────────────────────────── GENERATION HISTORY ─────────────────────────────

create table if not exists generation_history (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  project_id      uuid,
  generation_type text,
  prompt          text,
  result          jsonb,
  credits_used    integer,
  save_status     text not null default 'pending',
  refunded        boolean not null default false,
  created_at      timestamptz not null default now()
);

alter table generation_history enable row level security;

drop policy if exists "Users can read own generation history" on generation_history;
drop policy if exists "Users can create own generation history" on generation_history;
drop policy if exists "Users can update own generation history" on generation_history;

create policy "Users can read own generation history"
  on generation_history for select
  using (auth.uid() = user_id);
create policy "Users can create own generation history"
  on generation_history for insert
  with check (auth.uid() = user_id);
create policy "Users can update own generation history"
  on generation_history for update
  using (auth.uid() = user_id);

create index if not exists generation_history_user_created_idx
  on generation_history (user_id, created_at desc);

-- ─────────────────────────── STRIPE PAYMENTS ────────────────────────────────

create table if not exists stripe_payments (
  id                       uuid primary key default gen_random_uuid(),
  stripe_session_id        text not null unique,
  stripe_payment_intent_id text,
  user_id                  uuid not null references auth.users(id) on delete cascade,
  credit_pack              text,
  credits_amount           integer not null,
  amount_total             integer,
  currency                 text,
  status                   text default 'completed',
  created_at               timestamptz not null default now()
);

alter table stripe_payments enable row level security;

drop policy if exists "Users can read own stripe payments" on stripe_payments;
create policy "Users can read own stripe payments"
  on stripe_payments for select
  using (auth.uid() = user_id);

create index if not exists stripe_payments_user_created_idx
  on stripe_payments (user_id, created_at desc);

-- Make sure the current core tables have helpful indexes.
create index if not exists projects_user_updated_idx on projects (user_id, updated_at desc);
create index if not exists artist_vaults_user_created_idx on artist_vaults (user_id, created_at desc);
