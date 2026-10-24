-- 0226: Smartlink territory / language routing (Stack-100 #3 Wave 3,
-- lane 10 — numbered at the join): creator-entered routed
-- destinations for a release's smartlink.
--   smartlink_territory_destinations: { "DE": "https://…", … }
--     exact-country overrides, resolved server-side from the CDN geo
--     header (cf-ipcountry — the same coarse signal smartlink
--     analytics already records; IPs are never stored).
--   smartlink_language_destinations: { "es": "https://…", … }
--     language destinations, resolved from Accept-Language.
-- Resolution order: territory override → language match → the
-- release's normal flat platform links (the default, unchanged).
-- Both default to {} = no routing = today's behaviour, byte-for-byte.
-- Keys/values are validated at the API layer on save (ISO alpha-2
-- country codes, language primary subtags, http(s) URLs only) — the
-- same discipline as the 0187 pixel columns.
-- Idempotent, no BEGIN/COMMIT, no CONCURRENTLY (house rules).

ALTER TABLE distribution_releases
  ADD COLUMN IF NOT EXISTS smartlink_territory_destinations jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE distribution_releases
  ADD COLUMN IF NOT EXISTS smartlink_language_destinations jsonb NOT NULL DEFAULT '{}'::jsonb;
