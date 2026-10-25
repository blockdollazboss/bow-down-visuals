# STACK-200 LANE REPORT — Pitch & Fix (UPGRADES 196) + Feedback Pop-Ups (UPGRADES 180)

Branch: `stack200/pitch-fix` from integration tip `6800a34a`. NO push, NO join.
Spec: stack200-board.md items 196 + 180 in full, plus the owner-approved Gate-1
preview (slug `pitch-fix-preview`) as the design spec, plus the REWARDS RULING
(owner, Oct 25, 18:12 EDT — the adopted `pitch-fix-reward-recommendation.md`),
which superseded the original brief's "no rewards" point. Everything else in
the original brief stands: no prices anywhere in the section.

## Commits (verify branch before every commit — done throughout)

1. `c592abf2` migration 0244 + drizzle schema (intake, votes, feedback prompt prefs)
2. `4a8908a6` API lib + routes (moderated intake, boards, votes, admin queue, feedback cap)
3. `93d5d688` FE page, pop-up host + settings toggle, sidebar door, admin bench, qualifying-moment wiring
4. `299f7ce6` locale copy in all 10 catalogs
5. `a0b8803f` typecheck fix (express params typing)
6. `7c4f1192` rewards: schema + 0244 reward state
7. `16df1524` rewards: payment rail (claim/grant/strict ledger/release), pool + FIFO queue, duplicates, admin process triggers
8. `185bbcb5` rewards: public VB line, shipped paid/queued badges, admin pool line + reward chips + duplicate marking, locales ×10
9. KB commit: operator KB regen (Pitch & Fix = feature 244) + ROUTE_MATRIX entry
10. Locale-guard alignment: symbol-only rating key removed (bench renders
    the number + ★ inline), de/it/pt feedback words corrected, ja/ko
    spelled-quantity fixes, newest-surfaces pins updated (4489 / admin 207)

## Data model (migration 0244, idempotent, no BEGIN/COMMIT/CONCURRENTLY; drizzle schema in sync same commits; lib/db dist rebuilt before API typechecks)

`lib/db/migrations/0244_pitch_fix.sql` + `lib/db/src/schema/pitch-fix.ts`:

- **pitch_fix_submissions** — the ONE intake. `kind` ∈ pitch / fix / feedback;
  `source` ∈ door / feedback_popup. Pitch fields: title, body, why, category
  (create/world/money/social/other). Fix fields: title, body, page (10-value
  vocabulary mirroring the preview's Where list), severity
  (blocks_me/annoying/small). Feedback fields: rating 1–5 + title = the one
  optional line, flattened to a single line at intake. `submitter_name` is a
  filing-time snapshot (route resolves creator-profile display name →
  typed name → "Creator") so board/shipped credit survives renames.
- **Status vocabularies (CHECK-constrained, team-set only):**
  pitch reviewing/approved/building/shipped; fix+feedback
  received/confirmed/fixing/fixed. `shipped_at` stamps on terminal entry,
  clears on exit — drives the RECENTLY SHIPPED strip.
- **Moderation:** `moderation_status` pending/approved/rejected, born pending.
- **Reward state (ruling):** `reward_status` none/queued/paid/ineligible,
  `reward_amount`, `reward_queued_at`, `reward_paid_at`, `duplicate_of_id`.
  0244 was amended in-lane before ever applying anywhere, with
  ADD COLUMN IF NOT EXISTS + a guarded constraint DO-block so a re-run on
  the first shape is also a no-op.
- **pitch_fix_votes** — one upvote per member per pitch (unique index);
  the submission's `upvote_count` is recomputed from the vote rows on toggle.
- **feedback_prompt_prefs** — per-account pop-up state: `enabled` (default
  true), `last_prompted_at`, `prompt_count`.

## Moderation flow

Submissions land PENDING from all three doors (two section doors + the
pop-up). The public board endpoint (`GET /api/pitch-fix/board`) filters
`moderation_status='approved'` in the store layer of `getPublicBoard` —
there is no code path that lists a pending/rejected row publicly; tests pin
this for every kind. Submitters see their own pending rows via
`GET /api/pitch-fix/mine` and a "Waiting for review — yours" strip on the
page. The team surface is a **PitchFixInbox on the existing admin page**
(house pattern, beside DMCA/Content Reports), backed by
`GET /api/admin/pitch-fix/queue` and `PATCH /api/admin/pitch-fix/:id`
(both `requireAuth` + the fail-closed `requireAdmin` ADMIN_EMAILS gate
imported from routes/admin.ts). From the bench the team can: approve
(post to boards) / reject, walk the board status through its lifecycle,
mark duplicates, and read the reward pool line + per-row reward state.
Door success copy is review-first ("the team reviews every pitch before
it posts to the board") — a deliberate, spec-consistent deviation from
the preview's sample JS, which posted instantly; the board item's
moderation gate governs.

## Boards / doors / strip wiring

- Route **`/pitch-fix` inside AuthedLayout's Switch** (one-website shell),
  sidebar door in the **Social** section with the real name "Pitch & Fix"
  (`nav.pitchFix`, Lightbulb icon, NEW badge, alias-rich searchTerms),
  ROUTE_MATRIX entry added (`locked`, beside /community), and the operator
  KB regenerated — Pitch & Fix is feature #244, stage social, description
  sourced from the page's own en subtitle.
- Page (`pages/pitch-fix.tsx`) follows the approved preview 1:1 in
  structure: header + flow chips (PITCH → REVIEW → BUILD → SHIPPED),
  two doors side by side (pitch: title/what/why/category/name; fix:
  what's broken/where/severity/details/name), two boards side by side,
  RECENTLY SHIPPED strip, and the "Read by the team, every one" note card.
  House gold styling in BOTH themes via `useIsLightTheme` (light = golden
  marble cards, dark = black-marble gold) — no gradients-as-defects, no
  dark slabs in light.
- Pitch Board: upvote toggle (server counts, viewer's voted ids return
  with the board via optional session resolution), **Top/Newest sort**
  (pure sorter in `lib/pitch-fix.ts`, tested), status chips.
- Fix Board: newest first; feedback rows render their star rating and
  line; status + severity chips; "Reported in <page>".
- Shipped strip: approved rows at shipped/fixed, newest terminal first
  (max 12), crediting the submitter by snapshot name — pitches as
  "Idea by X — shipped", fixes as "Fix reported by X — fixed", plus the
  reward badge below (paid/queued).

## THE REWARD RAIL (owner ruling, Oct 25, 18:12 EDT)

Amounts (constants in the drizzle schema, exported via @workspace/db):
**pitch 500 VB · fix/feedback 100 VB · blocks_me fix 250 VB.**
Pop-up-sourced items follow the uniform fix rule per the coordinator's
ruling: a pop-up item has no severity, so it earns the plain 100; the
submitter is its first reporter. Visual Bucs ONLY — no cash path exists.

- **Trigger:** ONLY the team-set status transition into shipped/fixed,
  inside `setSubmissionStatus` — never at submit/approve, and there is
  no self-serve claim endpoint. Entering terminal with reward_status
  `none` queues it (amount + queued_at stamped). Leaving terminal while
  queued un-queues it. `paid` is a terminal money state: un-shipping and
  re-shipping later never re-queues and never pays twice. `ineligible`
  never queues.
- **Pool:** ONE shared **1,000 VB/week** envelope, GLOBAL (all members),
  Monday-UTC week anchor (same anchor shape as lib/quest-pool, funds and
  module fully separate — pitch-fix never reads or draws the quest
  pool's 300/wk). Accounting derives from the items themselves:
  spent = Σ reward_amount where reward_paid_at ∈ this week. Processing
  is **strict FIFO by reward_queued_at** (first-shipped first-paid):
  the first item that doesn't fit the remaining pool stops the run —
  nothing behind it jumps — and it pays when a later run finds room,
  i.e. when the next week opens. Queued is a visible, durable state,
  never dropped.
- **Payment (referral pattern, `lib/pitch-fix-rewards.ts`):**
  1. CLAIM — conditional flip queued→paid on the submission row
     (`WHERE reward_status='queued'`); one winner, losers pay nothing.
  2. GRANT — `addCreditsAtomic` (dynamic import, payment-record pattern).
  3. LEDGER — STRICT `recordCreditUsageStrict` row, creditsUsed
     negative (grant convention), action "Pitch & Fix Reward — Shipped
     Pitch" / "— Fixed Report", **idempotency key
     `pitch-fix-reward:<submission_id>`**; a pre-check + 23505-safe
     replay (drizzle-wrapped codes unwrapped via `isUniqueViolation`,
     the grant-ledger rule) resolves "already-recorded".
  4. FAILURE — grant or ledger failure after the claim: claw back any
     credits that moved, RELEASE the claim (paid→queued), log loudly,
     report `failed_released`. The item stays queued for the next run —
     never a double-pay, never a silent loss.
- **Processing triggers:** (a) the admin status PATCH itself
  (`setStatusAndProcessRewards` — a shipped item with pool room pays in
  the same team action), (b) opening the admin queue (GET processes
  first, so weekly roll-over pays when the team opens the bench),
  (c) `POST /api/admin/pitch-fix/rewards/process` for the 3x/day
  intake checks. Queue GET also returns `rewardPool`
  {weekStart, capVb, spentVb, remainingVb, queuedIds}; the bench renders
  the pool line and per-row reward chips (paid/queued/ineligible +
  duplicate-of label).
- **Duplicates — first voice only, two layers:**
  (1) AUTO: at intake, a submission whose normalized title (case/
  punctuation/whitespace-insensitive) matches an earlier non-rejected
  submission of the same kind is born `ineligible` with
  `duplicate_of_id` pointing at the first one — visibly badged in the
  bench. Feedback with no text line skips auto-detection (no title).
  (2) TEAM: the bench's duplicate control marks paraphrase duplicates
  (`PATCH {duplicate_of}` → `markDuplicate`): refuses self-marks,
  cross-kind marks, pointing at another duplicate, and — with an
  `already_paid` error — marking an item whose reward already paid;
  marking a queued item dequeues it.
- **Public copy:** one ruled line under the section subtitle, all 10
  locales: "Shipped pitches earn 500 VB · shipped fixes earn 100–250 VB"
  (en; translated per catalog). Shipped-strip cards show
  "{{amount}} VB paid" / "{{amount}} VB queued". NO prices anywhere:
  the wiring test asserts no $-amounts, no price copy, no charge/grant
  call from any client surface of the section.

Reward tests (`pitch-fix-rewards.test.ts`, 12): amounts exact;
nothing queues pre-terminal; exactly-once across reprocessing AND
un-ship/re-ship cycles; ledger-failure clawback+release then successful
retry; grant-failure release with zero movement; pool cap 2×500 paid +
third queued, still queued on same-week rerun, paid at next-week open;
strict FIFO no-jumping (500 head blocks a fitting 100 behind it);
auto-duplicate ineligible + first voice paid; team mark dequeues;
all four markDuplicate refusals.

## Feedback Pop-Ups (item 180)

- **Component:** `FeedbackPromptHost`, mounted once in AuthedLayout;
  card in house gold styling, both themes; star rating (radio group) +
  ONE optional single-line text input; X and a "Not now" button both
  dismiss in one tap; NO guilt copy anywhere (test greps for it).
  Submit → `POST /api/pitch-fix/feedback` → the same intake + moderation
  as everything else (kind=feedback boards on the Fix Board when
  approved). A "thanks" state confirms receipt.
- **Trigger law (`lib/feedback-prompt.ts`, pure + tested):** gates in
  order — (1) QUALIFYING MOMENT only: `export_finished` /
  `creation_succeeded` / `session_milestone` events; a null/unknown
  moment can never show, and the module has NO load-time entry point;
  (2) settings toggle ON; (3) hard cap clear; (4) not suppressed;
  (5) chance roll 25% LAST (never the trigger).
- **Producers wired to real success paths:** FinalVideoExport calls
  `notifyQualifyingMoment("export_finished")` at its completed-status
  set; HumToSong at its "Your song is ready" completion
  (`creation_succeeded`); the host raises `session_milestone` once at
  20 minutes into a signed-in session (a session event, not a load).
- **Hard cap:** 7 days per account from the last SHOWING, server-
  authoritative: eligibility `GET …/feedback-prompt/eligibility`;
  the host stamps the showing via `POST …/feedback-prompt/shown`
  BEFORE rendering, and the server refuses to stamp (409) when the
  toggle is off or the cap is running — a client can't stamp around it.
  Dismissal counts as a showing (the stamp precedes the render).
- **Hard suppression:** explicit flags (inCreationFlow / inCall /
  inLiveStream / inCheckout) OR suppressed route prefixes:
  /create, /video-editor, /audio-studio, /ai-audio, /go-live, /live,
  /live-shopping, /checkout, /cart, /messages (calls live in threads),
  /world. A suppressed moment is dropped, never queued for later.
- **Settings toggle:** `FeedbackPromptSettings` card in Settings beside
  SoundPrefsSettings (same house pattern: per-account GET/PATCH
  `/api/pitch-fix/feedback-prefs`, default ON, load-failure = error
  card with retry, never a fake "on"; optimistic toggle with revert).

## Tests & verification (numbers ONLY from finished logs)

- API targeted (`pitch-fix.test.ts` + `pitch-fix-rewards.test.ts`):
  **24/24 passed** (.lane/api-pitchfix-test2.log) — moderation gate for
  every kind, door vocabularies, vote toggling rules, status-vocabulary
  separation, shippedAt/strip behavior, feedback cap/toggle isolation,
  plus the 12 reward tests above.
- API FULL suite (sequential, --maxWorkers=1, .lane/api-full2.log):
  **6,473 passed / 6,475 — 2 failed, both in
  `operator-knowledge.test.ts`** (coverage: the new route/page not yet
  in the KB). Root-caused and FIXED in-lane: ROUTE_MATRIX entry +
  generator re-run; standalone rerun of that file: **63/63 passed**
  (.lane/kb-test.log). The finished full-suite log predates the fix;
  the join should re-run the full API suite on the joined tree.
- FE targeted (feedback-prompt 7, pitch-fix sort 3, wiring 9):
  **19/19 passed** (.lane/fe-pitchfix-test2.log).
- FE FULL suite (sequential, --maxWorkers=1, .lane/fe-full.log):
  **5,247 passed / 5,270 — 23 failed, ALL in the locale guard files**
  (locale-newest-surfaces 11, locale-numeric-parity 2, locale-waves
  ×9 files 10). Root causes were all in this lane's new copy: (a) the
  guards pin exact key counts (newest-surfaces required set + admin
  leaf count) that each adding lane must advance; (b) the bench rating
  string "{{rating}}★" is symbol-only and identical in every language,
  tripping the untranslated-residue guards in 10 files; (c) de/it/pt
  admin "Feedback" words identical to en; (d) ja/ko translations
  numeralized quantities en spells in words ("once a week",
  "a sentence or two"), tripping numeric parity. FIXED in-lane:
  counts advanced in the test's own ledger style (4462→4489,
  admin 189→207, with derivation comments), the rating key deleted
  (bench renders `{rating} ★` inline — a glyph, not copy), feedback
  words corrected (Rückmeldung / Riscontro / Comentário), ja/ko
  quantities spelled (一度 / 一文か二文 / 한 번). Standalone rerun of
  all 11 guard files + the wiring suite: **319/319 passed**
  (.lane/fe-locale-fix.log). The finished full-FE log predates the
  fix commit; the join should re-run the full FE suite on the joined
  tree (same honest caveat as the API suite).
- Typechecks: API `tsc --noEmit` exit 0 (.lane/api-typecheck2.log);
  FE exit 0 (.lane/fe-typecheck4.log, after the last FE edit).
  lib/db + lib/api-zod dists built in-tree before the API typecheck.
- Locales: 128 pitch-fix keys per catalog (nav.pitchFix, pitchFix.*,
  settings.feedbackPrompts.*, admin.pitchFix.* — 129 as built, minus
  the symbol-only rating key removed by the guard fix), parity
  asserted by script across all 10; rewardsLine verified translated
  (non-English ≠ English) in all 9 non-English catalogs.

## Left open / notes for the join

- Both full suites should be re-run on the joined tree (every red
  either suite produced is root-caused above and proven fixed by
  standalone rerun, but the finished full logs predate the fix
  commits — honest state, not a claim of green full runs).
- Reward processing has no cron of its own by design: it fires on
  team-surface activity (status PATCH, queue open) and the explicit
  admin process endpoint, which the already-scheduled 3x/day Pitch &
  Fix checks can call. If the team never opens the bench in a week,
  queued rewards wait — visible in the pool line, never lost. Adding
  a standing cron is a coordinator call, not invented here.
- `duplicate_of_id` has no FK constraint (house pattern for cross-row
  pointers in this schema family is a plain uuid + index-free lookup);
  the bench resolves the target's title client-side from the queue.
- Feedback items carry no severity, so the blocks_me 250 tier cannot
  arise from the pop-up door (uniform 100) — per the coordinator's
  uniform-item ruling, not a gap.
- The preview's instant-post sample behavior was overridden by the
  board item's moderation gate (see Moderation flow) — the one place
  the build deliberately differs from the preview's demo script; the
  layout, doors, boards, chips, sort, and strip are the preview's.
- No push, no join performed. .lane/ holds logs + the two locale
  scripts used (locales.py / locales2.py) for provenance.
