-- 0238: Content warnings & sensitive-content labels (Wave 4 #40) — a
-- creator may label their OWN post at publish time with any subset of
-- the fixed label set (sensitive / flashing_lights / mature_themes /
-- strong_language). The label is the creator's honesty tool, never a
-- moderation weapon: only the author sets or clears it, and platform
-- moderation (flags / removal) stays a separate system.
--
-- Enforcement is at READ time in the post DTO (routes/social.ts
-- enrichPosts, the same pattern as the members gate in 0233): a
-- labelled post's media never leaves the server — feeds, profile,
-- single-post reads, hashtag, saves and quote embeds all serve the
-- post covered, with the warning named, until the viewer taps to
-- reveal that one item (per item, per session — no global switch).
-- A viewer may additionally choose, for themselves only, to always
-- HIDE posts carrying chosen labels (content_warning_preferences);
-- the preference can only make labels stricter for that viewer, never
-- looser for anyone.
--
-- Because the cover withholds the media URL entirely (not a visual
-- blur over a shipped URL), labelled media cannot autoplay — or even
-- be fetched — uncovered on any surface that serves the DTO.
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS content_warnings jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$ BEGIN
  ALTER TABLE posts
    ADD CONSTRAINT posts_content_warnings_check
    CHECK (jsonb_typeof(content_warnings) = 'array');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS content_warning_preferences (
  user_id uuid PRIMARY KEY,
  hidden_labels jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
