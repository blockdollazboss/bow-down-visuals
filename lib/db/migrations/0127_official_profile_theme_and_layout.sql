-- 0127: King's Welcome data repair — give the official Thy Cheat Code
-- profile the theme_config and sections layout its public page needs.
--
-- WHY: Migrations 0125/0126 seeded the house profile without
-- theme_config or sections, so the row carries the 0085 column
-- defaults (theme_config = '{}', sections = '[]'). Every real profile
-- gets both from the client creation flows (a full theme preset +
-- the vertical's starter layout). The public page dereferences
-- theme_config nested (themeVars reads colors.*, the hero reads
-- banner.overlayOpacity), so '{}' threw on render and
-- /artist/thy-cheat-code landed on the app error boundary — and with
-- sections = '[]' no hero, name, or banner would render at all.
-- The API now also completes partial theme configs at the payload
-- boundary (completeThemeConfig in creator-platform.ts) and the
-- client falls back to the starter layout when none is saved; this
-- migration repairs the stored row itself so every reader sees the
-- real values.
--
-- Values mirror the client exactly: theme_config = the "midnight-gold"
-- preset (the client's DEFAULT_THEME — black velvet, molten gold) and
-- sections = the "influencer" starter template (the profile's
-- vertical) from lib/artist-profiles STARTER_TEMPLATES.
--
-- Idempotent + gap-only: each UPDATE fires only while the stored
-- value is still missing/empty, and only on the house account's row
-- (slug + sentinel user id, the 0126 anchor). A theme or layout the
-- King ever sets himself is never overwritten.

-- 1) Theme: fill only while the stored config has no colors.
UPDATE creator_profiles
SET theme_config = '{
  "themeId": "midnight-gold",
  "colors": {
    "background": "#0a0a0b",
    "surface": "#121214",
    "primary": "#d4af37",
    "accent": "#f5d67b",
    "text": "#f5f1e6",
    "mutedText": "#a8a29e",
    "cardBg": "#161618",
    "border": "#2a2416"
  },
  "fonts": { "heading": "Cinzel", "body": "Inter" },
  "banner": { "layout": "full-bleed", "overlayOpacity": 0.55 },
  "spacing": "comfortable",
  "cornerRadius": "sharp"
}'::jsonb,
    updated_at = now()
WHERE slug = 'thy-cheat-code'
  AND user_id = '00000000-0000-4000-8000-000000000001'
  AND (theme_config IS NULL OR NOT (theme_config ? 'colors'));

-- 2) Layout: fill only while no sections are stored.
UPDATE creator_profiles
SET sections = '[
  { "id": "hero-0",       "type": "hero",        "title": "Featured",    "visible": true },
  { "id": "mediakit-1",   "type": "mediakit",    "title": "Media Kit",   "visible": true },
  { "id": "videos-2",     "type": "videos",      "title": "Content",     "visible": true },
  { "id": "tracks-3",     "type": "tracks",      "title": "Audio",       "visible": true },
  { "id": "merch-4",      "type": "merch",       "title": "My Picks",    "visible": true },
  { "id": "bio-5",        "type": "bio",         "title": "About",       "visible": true },
  { "id": "shoutwall-6",  "type": "shoutwall",   "title": "Shout Wall",  "visible": true },
  { "id": "topcreators-7","type": "topcreators", "title": "Top Creators","visible": true }
]'::jsonb,
    updated_at = now()
WHERE slug = 'thy-cheat-code'
  AND user_id = '00000000-0000-4000-8000-000000000001'
  AND (sections IS NULL OR sections = '[]'::jsonb);
