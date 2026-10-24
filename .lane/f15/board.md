# Lane F15 — Product Bundles (Stack-100 #3, feature #15)

## Design (no new tables)
- **Definition**: a bundle is a `playlists` row with `kind='bundle'` — `price_cents`
  = the seller-set bundle price, `items` = jsonb [{kind:'track'|'video'|'series', id}]
  (same item-ref shape series already uses, widened to 'series' refs). All
  components must belong to the bundle owner's profile and be sellable today.
- **Sale**: ONE `digital_sales` row, item_kind='bundle', amount = bundle total,
  fee = the rail's existing splitFee on the TOTAL (flat 5%, STOREFRONT knob).
- **Grants at verify** (exactly once per item per purchase):
  - track/video → download_links rows against the bundle sale (find-or-mint,
    the rail's existing idempotency discipline).
  - series → a completed $0 `digital_sales` row (kind='series') — the row IS
    the unlock (creator-platform access reads completed rows) — with
    stripe_session_id = `<session>#grant:series:<id>`, ON CONFLICT DO NOTHING.
- **Refund**: payment-reversals' digital_sale case extended to also flip
  `#grant:` rows of the session and expire the bundle sale's download links.
  A buyer's standalone purchase of the same series (different session id) is
  untouched — the board's main risk, handled.
- **Duplicates** (following the rail, not inventing): track/video components
  may be re-bought (downloads re-sell today); a bundle containing a series
  the buyer already owns (standalone OR via an earlier bundle grant) is
  refused at checkout with the series rail's ALREADY_OWNED discipline.
- **Edits**: bundle price/item edits touch the playlist row only — recorded
  sales snapshot their amounts, and /store/token re-mints from the RECORDED
  grants (download_links file set + grant rows), never the live bundle.

## STOPPED part — schema change (reported, not written)
Prod `digital_sales.item_kind` is CHECK-constrained (0090, widened 0192) and
does not include 'bundle'. Everything above is built + fake-db tested; the
sale INSERT is the only statement prod would reject. Exact migration needed
(next free number 0205) + the lib/db source sync that must land with it:
see `.lane/f15/migration-needed.md`. No lib/db files were touched by this lane;
store.ts carries 'bundle' in a local kind list until the migration lands.
