-- 9999-fonts (PROVISIONAL — Stack-200 fonts lane): creator font favorites sync.
--
-- ⚠️ PROVISIONAL NUMBER: 9999 is a placeholder. The integration lane MUST
-- renumber this file to the next free migration number at join time and
-- update this header. Do NOT apply as 9999.
--
-- Stores a member's favorited creator fonts (ids from the frontend
-- catalog, artifacts/bow-down-visuals/src/lib/creator-fonts.ts — 64
-- open-license families). Until this migration is numbered/applied,
-- favorites live in localStorage (lib/font-favorites.ts) and this table
-- is the sync target only; no API route reads or writes it yet.
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS user_font_favorites (
  user_id text NOT NULL,
  font_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, font_id)
);

CREATE INDEX IF NOT EXISTS user_font_favorites_user_idx
  ON user_font_favorites (user_id);
