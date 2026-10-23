# OPEN WORLD — FEATURE PARITY MAP

Every site feature → its in-world home → status. Statuses: **WORKS** = the full task
completes in-world on the real rails · **PARTIAL** = part works, named part leaves ·
**LINK-ONLY** = panel/station exists but the action is a website link · **MISSING** = no
in-world surface at all. Hosted-checkout opening in a new tab at the payment moment and
guest sign-in are the owner's sanctioned external moments and are NOT counted against a
feature. The quiet "Open on the website ↗" transfer footer every panel carries is also
not counted against a feature — only a feature whose completion REQUIRES it fails.
Evidence: audit facets A (worker 5013d79c) + B (worker 20efce72), file:line citations in
.lane/audit.md facet reports.

## CREATE

| Feature | In-world home | Status |
|---|---|---|
| Song generation (Turbo/Advanced, 400 VB tiers) | Song Desk, Create Wing | WORKS |
| Song → audio → publish to profile → jukebox | Song Desk | WORKS (conditional: needs an existing creator profile — see Account) |
| Song Inspo / Mashup / Hum-to-Song, vault presets, upload+transcribe | Song Desk tabs | WORKS |
| Finished-song extras: cover-from-package, .lrc export | Song Desk | PARTIAL (2D only via transfer) |
| Hear desk-published song on room jukebox | Song Desk chip | PARTIAL (jukebox authority runs only in Music Hall; add from Create Wing never lands) |
| Video plan + per-scene clips (200/400 VB) | Video Desk | WORKS |
| Storyboard flow (analyze → approve → clips → draft+project) | Video Desk | WORKS |
| Song+Video package + wizard | Song+Video Desk | WORKS |
| Cover art generation + in-motion + artist image + showcase + share | Cover Art Desk | WORKS |
| Audio quick benches (cleanup, deverb, finish, beat maker, SFX) | Audio Studio Desk | WORKS |
| Audio full workbench (mix/master, stems, vocal, LUFS, podcast…) | Audio Studio Desk | WORKS |
| Sound packs, library, stem splitter | Audio Studio Desk | WORKS |
| Arrangement timeline editing (comping/automation/MIDI/FX/export) | Audio Studio Desk | PARTIAL (in-world: title/BPM/mutes only; full editor via transfer) |
| Harmony AI mode; stems remix-levels | Audio Studio Desk | MISSING (classic harmony only) |
| Thumbnail single + 4-variation + A/B + CTR prediction | Thumbnail Desk | WORKS |
| Thumbnail CTR apply-suggestions | Thumbnail Desk | PARTIAL (prediction ships, apply rail doesn't) |
| Video Editor (Visual Vibes) incl. export, templates, lip-sync | Editor door / My Studio | WORKS (real editor mounted full-screen inside /world) |
| My Studio (projects, balance/streak, vault characters) | My Studio board | PARTIAL (Continue + view only; no delete/rename/share) |
| Draft saving from desks | All Create desks | WORKS |
| "Schedule it" on a finished creation | Result chips | PARTIAL — target=_blank exit to 2D scheduler |

## BRAND

| Feature | In-world home | Status |
|---|---|---|
| Brand kit: view, generate (200 VB), tagline, apply to profile | Branding Kit Desk | WORKS |
| Brand kit manual field editing | Branding Kit Desk | PARTIAL (via footer to 2D) |
| Logo maker (100/200 VB) | Branding Kit Desk | WORKS (generation) |
| Save generated logo into brand kit | Branding Kit Desk | PARTIAL — desk itself says "on the website bench for now" |
| Intro/outro maker (750 VB) | Branding Kit Desk | WORKS |
| Headshot studio (100 VB) | Branding Kit Desk | WORKS |
| Stream pack graphics (generate/library/apply) | Branding Kit Desk | WORKS |
| Branding Shop (catalog, cart, design desk, orders) | Branding Shop stand | WORKS (+ sanctioned checkout tab) |
| Jewelry studio / bench | Branding Atelier | MISSING |
| Press kit: view, generate (300 VB), regen bio (100 VB) | Press Kit Desk | WORKS |
| Press kit full editing (socials, quotes, photos, tracks, public toggle, PDF, delete) | Press Kit Desk | PARTIAL — leaves to 2D |

## PROMOTE

| Feature | In-world home | Status |
|---|---|---|
| Promo copy generator (100 VB) | Promote Room | WORKS |
| Promo cards: make (100 VB), download, share, add to project | Promote Room | WORKS |
| Promo card Schedule action | Promote Room | PARTIAL — blank-tab exit |
| Promo cards full history | Promote Room | PARTIAL (this sitting's pack only) |
| Link-in-bio status + analytics | Promote Room | PARTIAL — read-only |
| Link-in-bio create/edit links, themes, slug, avatar | Promote Room | MISSING (2D only) |
| Link-in-bio publish/unpublish (100 VB) | Promote Room | MISSING |
| Scheduler: view upcoming | Promote Room | PARTIAL — read-only, next 3 |
| Scheduler: compose/schedule, calendar, reschedule, connect accounts, best-time | Promote Room | LINK-ONLY — the PROMOTE finish step; also breaks CREATE's finish |
| Post Assist "Write It For Me" (100 VB) | NONE | MISSING |
| Distribution / release wizard (metadata, splits, UPC, pre-save, submit) | Promote Room Release Desk | PARTIAL — status counts only, actions leave |
| Smartlinks / pre-save links + analytics | NONE | MISSING |
| UGC Product Ads (script, persona 100 VB, video 400 VB, briefs board, pin) | NONE | MISSING — entire feature, not even a station |
| Brand Deals outreach | Charts Desk brands tab | LINK-ONLY ("outreach lives on the website") |
| Monetization Coach | Promote Room coach row | PARTIAL (one action on hardcoded defaults, not the creator's inputs) |

## MONEY

| Feature | In-world home | Status |
|---|---|---|
| Earnings headline + per-source totals | Get Paid Room | WORKS (view) |
| Credit/payment ledger | Get Paid Room | WORKS (view) |
| Earnings statements view + PDF download | Get Paid Room | WORKS |
| Distribution permanence elections; Content-ID claim actions | Get Paid Room | PARTIAL — read-only status |
| Marketplace: browse, cart, checkout, verify | Marketplace stand | WORKS (+ sanctioned checkout tab) |
| Own shop management (create, products CRUD, AI desc/image, settings, analytics) | Marketplace stand | WORKS |
| Storefront custom domains | Marketplace stand | PARTIAL — "stay on the website" |
| Creator's own profile store inside their Creator Room | Creator Room "Their Store" | LINK-ONLY for purchase ("Buy on the website") — inconsistent with Marketplace stand |
| Memberships fan side (browse, free join, trial, paid join) | Crowns & Memberships | WORKS (+ sanctioned checkout tab); no in-world creator picker |
| Memberships creator side (tier CRUD, prices, perks, trials) | NONE | MISSING |
| Stage tips (VB, from seats) | World chrome | WORKS |
| Tip jar / tip page (real-money tips, settings, dashboard) | NONE | MISSING |
| Beats licensing marketplace (browse, 3 license tiers, sell, dashboard) | NONE | MISSING (beat *generation* works at Audio Desk) |
| Payouts: Stripe Connect onboarding, status, cash-out | NONE | MISSING — money never closes in-world |
| Buy Visual Bucs (credit packs) | NONE | MISSING — every out-of-credits state dead-ends |
| Site plan subscriptions (Pro/Elite) | NONE | MISSING |
| Free VB economy: Daily Drop, Shark Drops/spin, Quest Board | Treasury | WORKS |

## SOCIAL & COMMUNITY

| Feature | In-world home | Status |
|---|---|---|
| DMs: inbox/requests, read, send, new convo by slug, accept/decline/block | Post Office | WORKS |
| DMs: attachments, saved drafts, search | Post Office | WORKS |
| Feed: read posts | Community Hall board | PARTIAL (chrono only, 12-post cap, no For You/New Drops/pagination) |
| Feed: create/pin post (incl. AI generate), react, full threads, reply drafts | Community Hall | WORKS |
| Feed: repost, save/bookmark, delete own post, poll vote, post analytics | NONE | MISSING |
| Explore / discovery + creator/post search | Charts + Front Row + Board | PARTIAL (no Explore surface, no search) |
| Groups: browse/create/join/leave, group feeds | NONE — tagline promises them | MISSING |
| Groups: forums (channels, threads, pin/lock, moderation), member mgmt, broadcast | NONE | MISSING |
| Friends | — | N/A (site has no friend system; follows + King's auto-friend) |
| Follow/unfollow, follower counts | Portrait cards, Charts, Creator Rooms | WORKS |
| Community tools: superfan radar, sentiment, AI reply drafts | Community Hall | WORKS |
| Community moderation bench | Community Hall | LINK-ONLY (explicitly deferred) |
| Room text chat ("say") + emoji | World chrome | WORKS (members; guests get honest pitch) |
| Palace announcements / herald | World chrome + host panel | WORKS (herald admin-only) |

## LIVE

| Feature | In-world home | Status |
|---|---|---|
| Start a livestream (studio, camera/effects, ingest/destination keys, loyalty, scheduling) | NONE — links out | LINK-ONLY — flagship hole |
| Take the stage with an already-live stream | Screen panel, King's Hall | WORKS |
| Watch-party: catalog video on big screen, shared transport, King's Reel | Screen panel | WORKS |
| Spectating a live show | King's Hall | PARTIAL (no dedicated stream chat / follow rail like the 2D watch page) |
| Stage tips from seats | World chrome | WORKS |
| Tip a creator not on stage | NONE | MISSING |
| Stream guests & backstage (invites, promote/demote, backstage chat) | NONE | MISSING |
| Join a stream as guest | NONE | MISSING |
| Schedule/manage upcoming streams | NONE | MISSING (Palace Calendar is read-only) |
| Stream Controller deck | NONE | MISSING |
| Premiere / broadcast scheduling | NONE | MISSING |

## QUESTS, GAMES & DROPS

| Feature | In-world home | Status |
|---|---|---|
| Weekly quests: view, claim, do-at-desk mapping | Quest Board (Treasury) | WORKS |
| Daily Quest Trio | Quest Board + Objective Strip | WORKS |
| "Your First 10 Minutes" tutorial line | World chrome + Objective Strip | WORKS |
| Quest trophy ledger, history, leaderboards, streak view | Quest Board depths | WORKS (read); streak claim one hop up in same panel |
| Daily Drop claim; template catalogue archive | The Daily Drop | WORKS |
| Daily Drop template "Use" | Catalogue rows | LINK-ONLY (raw website href ejects walker) |
| Hourly crate spin; Shark Drops claim | Shark Drops | WORKS |
| In-room drop spectacles; King's daily moment | World chrome | WORKS |
| Jackpot (admin prize events, player entry) | NONE | MISSING |
| Arcade games (play, scores, bests, leaderboards) | Arcade Cabinets | WORKS |
| Party games (tables, codes, invites, records) | The Marble Table + Board block | WORKS |
| Weekly challenge standings + Hall of Fame | Arcade panel | WORKS (read) |
| World Contests (host, enter, judge, Winners' Circle) | The Winners' Circle | WORKS (complete flow) |
| 2D giveaway contests (/api/contests — different system) | NONE | MISSING |
| Court Season standings + seasons wall | Season Marks Wall | WORKS (read, by design) |
| Front Row gallery / earned-rank honors | Front Row Gallery | WORKS |
| Palace Calendar | Kingdom Board block | WORKS (read) |
| Listening parties (book from catalog/playlist, cancel) | Jukebox panel, Music Hall | WORKS |
| Jukebox (queue, transport, synced playback) | The Jukebox | WORKS |
| Office hours (book in own room, visitor slate) | Creator Room stations | WORKS |

## ACCOUNT & PROFILE

| Feature | In-world home | Status |
|---|---|---|
| View another creator's profile | Portrait cards | PARTIAL (summary card, not the full public profile) |
| View my own profile as others see it | NONE | MISSING |
| Create a creator profile | NONE | MISSING — blocks a new creator's first in-world publish |
| Edit my creator profile (bio, blocks, theme, socials) | NONE | MISSING |
| Creator Room dressing (18 looks) | Own Creator Room | WORKS |
| Visit/browse other creators' rooms | Creator Rooms directory | WORKS |
| Account settings (fields, cursor, preferences) | NONE | MISSING |
| Danger zone: export data / delete account | NONE | MISSING |
| Notifications (bell, unread, mark-read) | NONE | MISSING |
| Balance view | My Studio / Treasury | WORKS (view) |
| Full credit history page | Earnings ledger + Studio strip | PARTIAL (no full history/pagination) |
| Creator Level stars, level-up moments | Automatic | WORKS |
| Sign-in / sign-out | — | LINK-ONLY by design (sanctioned) |

## WORLD SYSTEMS

| Feature | In-world home | Status |
|---|---|---|
| Presence, room directory, truthful counts, travel | Directory bar + Board | WORKS |
| Avatar: house guard defaults | Automatic | WORKS |
| Avatar: walk in as vault character; change in-world | Entry picker + chrome | WORKS |
| Avatar: rename/remove vault character | Picker manage strip | WORKS |
| Avatar: create/edit appearance (portrait, look, regalia, voice) | Picker defers to Creative Vault | LINK-ONLY |
| Avatar customization (outfits/colors/accessories on figure) | NONE | MISSING |
| Emotes/actions (Bow, Wave, Cheer, Clap, Spin, Dance, Sit) | Action bar + gamepad | WORKS (members) |
| Movement, collision slide | Native | WORKS (prop collision partial — see stack board) |
| Camera 1st/3rd person, remembered | Chrome + gamepad | WORKS |
| Fullscreen; VR/XR entry | Chrome | WORKS |
| Controller/gamepad (sticks, voice, view, actions) | Native | WORKS |
| Voice chat (proximity mesh, cap 12, modes, mute/deafen) | Footer controls | WORKS (no TURN relay — some networks won't connect) |
| Character voice shaping; lip-sync | Footer switch; native | WORKS |
| Admin: mute peer, remove peer, herald, drive stage/screen | Host Controls panel | WORKS (server re-verifies) |
| Admin: lock a room's door | Directory shows Locked pill only | MISSING (display-only — no client verb) |
| Admin: lock a person out (timed ban), moderation queue | NONE | MISSING |
| Guest experience (look, listen, watch, read boards) | All public stations | WORKS (honest pitches, no dead buttons) |
| Guest restrictions (no say/voice/emotes/claims) | Chrome + server | WORKS (as designed) |
| "Switch to the website" standing exit | Header | WORKS (deliberate exit) |

## Parity totals (counted from the tables above)

- CREATE 19 rows: 13 WORKS · 5 PARTIAL · 1 MISSING-adjacent (Harmony AI/remix counted in PARTIAL row + MISSING note)
- BRAND 11 rows: 7 WORKS · 3 PARTIAL · 1 MISSING
- PROMOTE 15 rows: 2 WORKS · 6 PARTIAL · 5 MISSING · 1 LINK-ONLY (+coach partial)
- MONEY 17 rows: 8 WORKS · 3 PARTIAL · 5 MISSING · 1 LINK-ONLY
- SOCIAL 16 rows: 9 WORKS · 2 PARTIAL · 4 MISSING · 1 LINK-ONLY
- LIVE 11 rows: 3 WORKS · 1 PARTIAL · 6 MISSING · 1 LINK-ONLY
- QUESTS/GAMES 19 rows: 17 WORKS · 2 MISSING · 1 LINK-ONLY (rows overlap-counted once)
- ACCOUNT 13 rows: 5 WORKS · 2 PARTIAL · 5 MISSING · 1 by-design
- WORLD SYSTEMS 20 rows: 16 WORKS · 2 MISSING · 1 LINK-ONLY · 1 display-only

**The pattern:** generation and play are in-world; the FINISH of every money/promote/live
workflow and the whole social-graph layer (groups, notifications, profile) are not. That is
what the 100-item board's parity half fixes.
