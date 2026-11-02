-- Tip pages — the jar's settings become durable (stack1300 tip-jar fix,
-- 2026-11-02).
--
-- WHY THIS FILE EXISTS: until now a tip page's settings (handle,
-- display name, suggested amounts, funding goal) lived ONLY in a
-- process-memory map in artifacts/api-server/src/routes/generate/
-- tip-jar.ts. The module's own header said it: "NOT restart-safe —
-- move to DB-backed storage before real payments ship." Real payments
-- DID ship (0142's tip_jar_tips), but the settings never moved.
--
-- Proven live on staging, Gate #5, Nov 2, 2026: a jar created in the
-- morning for handle "testcreator" resolved publicly and took two
-- paid $5 tips; an env-var save then redeployed the staging service,
-- and by 11:12 the public page answered "Tip page not found" for
-- guests, the buyer, and the artist page's Tip Jar link — while the
-- durable tip rows (and the creator's $10.00 / 2-tips record) sat
-- unharmed in tip_jar_tips. Every tip page on the site shares this
-- failure shape: one restart erases them all.
--
-- This table is the store of record: one row per ACCOUNT (user_id is
-- the PK — the jar is per-account; an account's several artist
-- profiles share the one jar, exactly as the in-memory map was keyed),
-- handle globally unique (it is the public /tips/:handle identity).
-- The route keeps its in-memory maps as a read-through cache only;
-- eviction or restart now costs a re-read, never the page.
--
-- Fresh CREATE (no legacy table to reconcile): every statement is
-- IF NOT EXISTS, safe to re-run as a no-op. No BEGIN/COMMIT, no
-- CONCURRENTLY. 0316 > BASELINE (55), so the boot runner applies it
-- on fresh and existing databases alike.

CREATE TABLE IF NOT EXISTS tip_pages (
  user_id uuid PRIMARY KEY,
  handle text NOT NULL,
  display_name text NOT NULL,
  message text NOT NULL DEFAULT '',
  suggested_amounts jsonb NOT NULL DEFAULT '[]'::jsonb,
  goal_amount double precision,
  goal_label text NOT NULL DEFAULT '',
  funding_goal jsonb,
  goal_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tip_pages_handle_ux ON tip_pages (handle);

CREATE INDEX IF NOT EXISTS tip_pages_handle_idx ON tip_pages (handle);
