# Lane stack29/coposts — #24 Co-Posts & Collab Releases — REPORT

Base: stack28/integration @ f96d7b72 · Branch: stack29/coposts · No push.

## What works end-to-end (code-complete; DB half lights up with migration 0205)

**Gap verified first** (`.lane/GAP.md`): no co-post / co-author product
existed under any name; Collabs was matchmaking only; Feed posts carry
a single `profile_id`.

### The flow
1. **Start** — Collabs page, accepted collab card → "Start a co-post"
   (or the new **Co-posts tab** on the same page, PROMOTE dock, no
   standalone page) → pick partner, write the post, optional image.
   Accepted-collab provenance (`collab_request_id`) is validated
   server-side (must be an *accepted* request between exactly these
   two accounts). Direct co-author invite (no prior collab request)
   also works, per the brief.
2. **Consent gate** — creation writes ONE `posts` row + two
   `post_co_authors` sides: initiator `accepted`, co-author `pending`.
   The post is invisible everywhere public while pending: Feed (chrono
   + For You + hashtag), single-post read, replies/quotes/reposts all
   pass a co-post gate; the two creators manage it via
   `GET /api/co-posts/mine`.
3. **Approve** — co-author approves in the Co-posts tab (or declines).
   Second approval publishes: the SAME post row now appears in the
   Feed bylined "A × B" with a Co-post badge, and on both creators'
   co-post profile lists (`GET /api/co-posts/by-profile/:profileId`).
4. **Engage** — likes/comments/reactions attach to the single post row
   as today. There is exactly one count set, rendered identically on
   both profiles; nothing is ever summed per author (state machine's
   `sharedEngagement` + `dedupePostsById`, test-pinned).
5. **Withdraw** — either side, any time after accepting:
   `POST /api/co-posts/:id/withdraw` changes ONLY that side's row to
   `withdrawn`. The post leaves their profile list and their name
   leaves the byline; the other creator keeps the post, live, with
   the same counts. If both withdraw, it leaves the Feed too.

### Consent / withdraw behaviour, as implemented (exact semantics)
- Both approve before live: published ⇔ every side has `accepted_at`.
- A late accept after a pre-live withdrawal/decline is REFUSED
  (`co_post_ended`) — consent withdrawn before publish can never be
  overridden by the other side; a fresh co-post is the only way back.
  (Caught in the lane's own tests while building; machine fixed.)
- Decline is pre-live only, ends the co-post, and never turns it into
  a solo post for the initiator. After live, decline is refused —
  withdraw is the honest action.
- Only a side's owner can act on that side (403 for anyone else,
  including the other co-author). Withdrawal writes one row only.
- UI copy states all of this where creators act (Collabs Co-posts
  tab, withdraw confirm dialog, Feed card badge tooltip).

### Surfaces changed
- API: `src/lib/co-posts.ts` (pure consent machine), `src/lib/co-posts-db.ts`,
  `src/routes/co-posts.ts` (6 endpoints, mounted in routes/index.ts),
  `src/routes/social.ts` (enrichment adds `co_authors` / `co_post_state`;
  feed + hashtag + single-read co-post gate), `src/routes/generate/collabs.ts`
  (inbox DTO gains counterpart user ids so an accepted collab can
  start a co-post).
- DB schema: `postCoAuthorsTable` in `lib/db/src/schema/collab.ts`,
  in sync with the held migration.
- FE: `src/lib/co-posts.ts` (+ tests), `src/lib/social-api.ts`
  (FeedPost co-author fields), `PostCard.tsx` (dual byline + badge),
  `src/components/collabs/CoPostsPanel.tsx`, `src/pages/collabs.tsx`
  (Co-posts tab, accepted-collab "Start a co-post", ?tab=coposts
  deep link used by notifications).
- Free throughout — co-posting is pure interface, no compute, exactly
  like collab requests. No price or fee was created or touched.

## Migration held
`post_co_authors` — exact SQL (0205, idempotent, no BEGIN/COMMIT) in
`.lane/MIGRATION-NEEDED.md`, NOT applied, per lane rules. Until it
lands: writes answer `503 co_post_not_ready` BEFORE creating anything
(probe-first; nobody is notified), reads treat the missing table as
"no co-posts yet" and behave byte-identically to today.

## Parked
- **Store/distribute co-release — PARKED.** Releases
  (`distribution_releases`) are single-artist rows already carrying a
  separate royalty-splits system (wave8 splits + SplitEditor, with
  its own invite flow). Bolting co-authorship onto releases means a
  second consent ledger over money-bearing splits — a different
  consent problem (percentages, not visibility) that needs its own
  design and its own migration; forcing it into this lane would
  balloon scope and mix two consent models. The Feed co-post ships
  fully; the release half should be its own lane, reusing this lane's
  side/consent pattern for the *attribution* layer only, with split
  percentages staying in the splits system.
- Co-posts are public-audience only in v1 (stated in the UI): the
  Feed's audience gate keys off the primary author, so a
  followers-scoped co-post could hide from the co-author's own
  followers. Public-only keeps "both audiences" literally true.
- Scheduled co-posts and poll co-posts: not offered (composer parity
  is a follow-up, not a consent question).

## Tests
<!-- filled from finished sequential suite logs at the end -->
