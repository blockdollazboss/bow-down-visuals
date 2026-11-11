-- 0336: crownfall_meta — the server home for Crownfall Run prestige
-- (lane stack1600/join19, closing the gap crownfall-v2 flagged).
--
-- WHY THIS FILE EXISTS: prestige shipped in crownfall-v2 behind a
-- client storage adapter that persisted only to the member's device
-- (localStorage), because the arcade backend stored score ROWS only
-- (arcade_scores) — there was no per-member profile field to hang a
-- prestige tier, lifetime kills/boss kills, best depth, or earned
-- achievements on. A member who cleared their browser storage or
-- switched devices lost their prestige. This table is that missing
-- home: ONE ROW PER MEMBER, keyed by user_id.
--
-- The route (routes/crownfall.ts GET/PUT /arcade/crownfall/meta)
-- merges monotonically — tier and lifetime counters only ever rise,
-- achievements union — so a stale device syncing late can never
-- roll a member's progress back, and the response always returns
-- the merged truth the client folds in.
--
-- Prestige is power + status only: the tier feeds run bonuses
-- (+5% bolt damage, +10% scrip-coin drops per tier, capped at 10)
-- and NEVER touches a score row (the arcade caps in arcade-rules.ts
-- ignore prestige by design) and never touches Visual Bucs.
--
-- Fresh CREATE (no legacy table to reconcile): every statement is
-- IF NOT EXISTS, safe to re-run as a no-op. No BEGIN/COMMIT, no
-- CONCURRENTLY.

CREATE TABLE IF NOT EXISTS crownfall_meta (
  user_id uuid PRIMARY KEY,
  tier integer NOT NULL DEFAULT 0,
  lifetime_kills integer NOT NULL DEFAULT 0,
  lifetime_boss_kills integer NOT NULL DEFAULT 0,
  best_depth integer NOT NULL DEFAULT 0,
  achievements jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_bounty_day text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
