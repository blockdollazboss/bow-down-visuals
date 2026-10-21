-- 0192: "Move Home" concierge onboarding progress
-- (competitor-study/social-platforms.md candidate C2).
--
-- Platforms give a creator an audience but no home; Bow Down already
-- has every piece of the home (Grand Stage profile, store, press kit,
-- email list, smartlinks) but a migrating creator had to assemble them
-- by hand. Move Home is the guided flow that drafts the whole home in
-- one pass and applies each piece only on the creator's explicit
-- per-step approval.
--
-- move_home_progress: one row per member, created lazily on their
-- first Move Home read (the world_tutorial_progress pattern, 0149).
--   answers     the intake — the creator's own words only.
--   drafts      per-step draft payloads assembled from the answers,
--               the creator's existing on-platform content, and their
--               ALREADY-connected social accounts. Inert data: a
--               draft is never public, sellable, or sendable.
--   steps       per-step state (pending → drafted → approved |
--               skipped) with the applied rail row id stamped on
--               approval. Nothing publishes, charges, or goes live
--               from this table — approval is the only door, and the
--               apply happens on each step's real rail at that moment.
--   completed_at stamped when every step is approved or skipped.
--
-- The flow is free: no credits column, no charge path. Charged
-- follow-ons (e.g. scheduling a drafted launch post) ride their own
-- rails with their own prices and confirmations.
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS move_home_progress (
  user_id UUID PRIMARY KEY,
  answers JSONB NOT NULL DEFAULT '{}',
  drafts JSONB NOT NULL DEFAULT '{}',
  steps JSONB NOT NULL DEFAULT '{}',
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
