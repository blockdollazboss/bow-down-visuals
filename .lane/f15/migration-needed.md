# F15 — migration needed before bundles can record a sale in prod

Everything in the lane is built and tested. The ONE statement prod rejects
today is `INSERT INTO digital_sales (..., item_kind='bundle', ...)`:
`digital_sales_item_kind_check` (0090, widened by 0192) allows only
('track','video','album','pack','digital','series').

## Exact migration — `lib/db/migrations/0205_store_bundles.sql`
(next free number at lane time: existing files run to 0204)

```sql
-- Stack-100 #3 F15: Product bundles — widen digital_sales.item_kind.
--
-- A bundle is a playlists row with kind='bundle' (price_cents = the bundle
-- price, items = the components). Its sale rides the digital store rail as
-- ONE digital_sales row with item_kind='bundle', so the flat 5% fee splits
-- once, on the bundle total. Component grants are recorded at verify:
-- download_links against the bundle sale (tracks/videos) and completed $0
-- 'series' rows keyed by a suffixed session id (series unlocks).
--
-- Idempotent: safe to re-run.

ALTER TABLE digital_sales DROP CONSTRAINT IF EXISTS digital_sales_item_kind_check;
ALTER TABLE digital_sales
  ADD CONSTRAINT digital_sales_item_kind_check
  CHECK (item_kind IN ('track', 'video', 'album', 'pack', 'digital', 'series', 'bundle'));
```

No new tables, no new columns: bundles reuse `playlists` (kind/price_cents/
items already exist since 0192) and the existing sales/download tables.

## lib/db source sync that must land in the same commit (house rule)
1. `lib/db/src/schema/digital-sales.ts`:
   - `DIGITAL_ITEM_KINDS` → add `"bundle"`.
   - the `digital_sales_item_kind_check` in the table def → add `'bundle'`.
2. `lib/db/src/schema/creator-platform.ts`:
   - `playlistsTable.items` $type → `Array<{ kind: "track" | "video" | "series"; id: string }>`.
3. Then `tsc -b .` in lib/db, and in `artifacts/api-server/src/routes/store.ts`
   the lane's local `STORE_ITEM_KINDS` list can collapse back to
   `DIGITAL_ITEM_KINDS` (it is written so that swap is a two-line change).
