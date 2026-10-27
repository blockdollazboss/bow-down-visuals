# Lane par-get-paid-tail (P3-F) — plan

Base ecc63098 · branch stack200/par-get-paid-tail · NO pushes/merges.
Scope: parity-p3-audit.md rows "Catalog-export builder" + "Succession/legacy
settings" — both MISSING in-world, both pure desk promotions of site rails
that already exist in artifacts/api-server/src/routes/trust.ts. No new
server logic, no migrations.

## Rungs
0. This plan.
1. Lib seam `src/lib/world/get-paid-tail.ts` + `get-paid-tail.test.ts`:
   pure payload shaping / parsers / validators / paths for both desks.
   - Catalog export: kinds+fields re-exported from the SITE's own
     components/trust/catalog-export-options (the mirror of the server
     whitelist in CATALOG_EXPORT_KINDS); POST /api/catalog-export/build.
   - Legacy: GET/POST/DELETE /api/legacy/designation, GET
     /api/legacy/inbox + POST /api/legacy/inbox/:id/respond,
     GET/PUT/DELETE /api/legacy/contact — TrustPanels' exact bodies.
2. CatalogExportDesk.tsx — kind chips, field toggles, format, build →
   file downloads in-world (the statement-PDF pattern: a download is
   not a pull-up); honest result line incl. the 2,000-row cap flag.
3. SuccessionDesk.tsx — designation form + inbox answers + legacy
   contact form over the trust rails; every write re-reads its rail.
4. Wire both desks into boards/EarningsBoard.tsx (the Earnings Board
   area / Get Paid Room) + source-contract component pins
   (get-paid-tail-components.test.ts).
5. Verify: new tests + src/lib/world suite slice + FE typecheck.

Both themes via NativeCard + isLight, same as MoneyActionsDesk.
Native panels only; no website footer (Earnings Board desks carry
none — the sanctioned-exit law is untouched: no hosted pages here).
