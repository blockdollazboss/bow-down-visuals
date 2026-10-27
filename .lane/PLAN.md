# upg-identity — PLAN (banked first, run: replacement worker, Oct 27 ~00:15 EDT)

Base: ecc63098 · Branch: stack200/upg-identity · NO push/merge. Migrations: 9999-* only.

## STATUS — LANE COMPLETE (finisher, Oct 27)
Both deltas built + verified on the lane:
- #162 The Vault: API job (banked) + Settings card (banked) + locale parity
  finished here (rung 5: settings.vault* ×9 keys into all 9 non-en catalogs,
  pin 4500→4509; rung 5b ja numeric parity).
- N20 Duo/Group Profiles: schema+migration (rung 1, banked), API (rung 2,
  banked), FE finished here — 3a view-model lib + 15 tests; 3b public page
  /group/:slug (members credited, published split terms, shared store →
  /storefront/product/:id; route classified public, census pin 46→47);
  3c editor card docked on /team (identity, publish switch, per-member
  split terms, shared-store add-product; read-only for members).
- Rung 4 verification fixes (lane-caused): pg-mem store_products mirrors
  in courses/move-home gained group_profile_id; operator KB regenerated
  (features 245, group--slug carries a sourced description).
- Verification: lib/db dist rebuilt; API typecheck 0; FE typecheck 0;
  API full suite 526/527 files, 6,506/6,507 tests (sole failure
  funding-goals solo-green 18/18 — load flake, not lane-caused);
  FE full suite 411/411 files, 5,352/5,352 tests.
- Join notes: renumber 9999-group-profiles.sql + 9999-vault-jobs.sql;
  the operator KB will regenerate again on the joined tree.

## #162 The Vault — audit delta ONLY (board line 982)
Existing (NOT to rebuild): `GET /api/account/export` in routes/account.ts — JSON of
profile/projects/drafts/clips/songs, Settings Danger Zone (data-only).
DELTA: media itself — original songs/videos/art at full quality in ONE downloadable
archive, packaged as a BACKGROUND JOB with honest progress state, + sales/splits/settings
data in the archive. Docked in Settings/My Studio.
Rungs: (1) covered-check existing export + media storage/R2 patterns + job patterns in repo;
(2) server: vault job (create/status/download) + archiver over the creator's media originals;
(3) FE: Settings/My Studio Vault card — start job, progress, download; both themes; tests.

## N20 Duo/Group Profiles — audit delta ONLY (board line 1022)
Covered at base (NOT to rebuild): internal Team (/team, lib/teams.ts: creation, invites,
roles, shared credit pool, shared vaults); money half (lib/sale-splits.ts wave #36,
lib/co-releases.ts).
DELTA: public-facing half only — duo/group as a first-class creator identity: ONE public
profile page + ONE shared store under the group name, members credited, profile's written
split terms driving the existing sale-splits rail.
Rungs: (1) covered-check teams/sale-splits/store/profile code; (2) schema+API: group public
profile (publish flag, name, bio, split terms) bound to a team; store listing under group;
(3) FE: public group profile page + shared store section, members credited, split terms
visible; both themes; tests.
