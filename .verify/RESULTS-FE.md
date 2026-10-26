# FE full suite re-run 2026-10-26T16:51:08Z head=63b96da2

[1m[30m[46m RUN [49m[39m[22m [36mv5.0.1 [39m[90m/home/hatch/workspace/bdv-wt-rem-clearance/artifacts/bow-down-visuals[39m

 [32m✓[39m src/lib/world/world-client.test.ts [2m([22m[2m111 tests[22m[2m)[22m[33m 743[2mms[22m[39m
 [32m✓[39m src/lib/stream-kit/background-changer.test.ts [2m([22m[2m47 tests[22m[2m)[22m[33m 39103[2mms[22m[39m
   [32m✓[39m two engines — quality is the creator's only choice (Pro restored, Oct 23, 2026) [2m(6)[22m
     [33m[2m✓[22m[39m auto steps the (fallback) light engine's refinement DOWN when it runs slow — and stops at its floor[33m 5972[2mms[22m[39m
   [32m✓[39m freeze fix (Oct 21, 2026) — raw-first, opt-in effects, init timeout, failure cap [2m(5)[22m
     [33m[2m✓[22m[39m a landed matte resets the failure run — intermittent failures never park the engine[33m 627[2mms[22m[39m
   [32m✓[39m Pro engine restored (Oct 23, 2026) — selection, fallback, degrade, park [2m(6)[22m
     [33m[2m✓[22m[39m Pro inferences that keep failing park the Pro engine and fall through to the light engine[33m 318[2mms[22m[39m
     [33m[2m✓[22m[39m auto walks the Pro steps down on sustained slowness, then degrades to the light engine[33m 6294[2mms[22m[39m
     [33m[2m✓[22m[39m 'pro' quality walks its internal steps on slowness but NEVER degrades engines under the creator[33m 9271[2mms[22m[39m
   [32m✓[39m honest engine status (Stack-100 #3 Lane C — the fallback is VISIBLE) [2m(7)[22m
     [33m[2m✓[22m[39m auto degrade on sustained slowness: the swap reports 'pro-too-slow'[33m 8408[2mms[22m[39m
   [32m✓[39m motion fix (Oct 25, 2026) — the person moves at camera rate, the background never snaps to the raw room [2m(4)[22m
     [33m[2m✓[22m[39m a matte stall holds the effect (the green stays painted) while the status honestly reports off — raw NEVER paints over a live backdrop[33m 317[2mms[22m[39m
     [33m[2m✓[22m[39m a healthy phone's round trips (~100ms) hold the sharpest refinement step — the ladder no longer marches every phone to the floor[33m 5385[2mms[22m[39m
     [33m[2m✓[22m[39m a send slower than the cap is not abandoned or mispaired: no second send piles on, the late result proves life, and its stale matte is never painted[33m 453[2mms[22m[39m
 [32m✓[39m src/lib/locale-newest-surfaces.test.ts [2m([22m[2m125 tests[22m[2m)[22m[33m 1013[2mms[22m[39m
 [32m✓[39m src/lib/world/business-desks.test.ts [2m([22m[2m62 tests[22m[2m)[22m[33m 707[2mms[22m[39m
 [32m✓[39m src/lib/locale-waves-de.test.ts [2m([22m[2m7 tests[22m[2m)[22m[33m 1091[2mms[22m[39m
 [32m✓[39m src/lib/world/shop-stands.test.ts [2m([22m[2m64 tests[22m[2m)[22m[33m 891[2mms[22m[39m
   [32m✓[39m Crowns & Memberships [2m(4)[22m
     [33m[2m✓[22m[39m price labels read the server DTO's own amounts, per period, in the page's format[33m 456[2mms[22m[39m
 [32m✓[39m src/lib/world/create-desks.test.ts [2m([22m[2m43 tests[22m[2m)[22m[33m 349[2mms[22m[39m
 [32m✓[39m src/lib/locale-waves-it.test.ts [2m([22m[2m24 tests[22m[2m)[22m[32m 17[2mms[22m[39m
 [32m✓[39m src/lib/locale-waves-fr.test.ts [2m([22m[2m21 tests[22m[2m)[22m[33m 956[2mms[22m[39m
 [32m✓[39m src/lib/world/palace-layout.test.ts [2m([22m[2m40 tests[22m[2m)[22m[33m 368[2mms[22m[39m
 [32m✓[39m src/lib/world/social-desk.test.ts [2m([22m[2m51 tests[22m[2m)[22m[32m 198[2mms[22m[39m
 [32m✓[39m src/lib/locale-waves-es.test.ts [2m([22m[2m18 tests[22m[2m)[22m[33m 448[2mms[22m[39m
 [32m✓[39m src/lib/world/objective-strip.test.ts [2m([22m[2m40 tests[22m[2m)[22m[32m 242[2mms[22m[39m
 [32m✓[39m src/lib/locale-waves-pt.test.ts [2m([22m[2m21 tests[22m[2m)[22m[32m 258[2mms[22m[39m
 [32m✓[39m src/lib/world/treasury-panels.test.ts [2m([22m[2m38 tests[22m[2m)[22m[32m 118[2mms[22m[39m
 [32m✓[39m src/lib/world/shelf.test.ts [2m([22m[2m50 tests[22m[2m)[22m[32m 269[2mms[22m[39m
 [32m✓[39m src/lib/world/charts-board.test.ts [2m([22m[2m41 tests[22m[2m)[22m[32m 243[2mms[22m[39m
 [32m✓[39m src/lib/stream-kit/transport.test.ts [2m([22m[2m27 tests[22m[2m)[22m[32m 245[2mms[22m[39m
 [32m✓[39m src/lib/world/quality.test.ts [2m([22m[2m53 tests[22m[2m)[22m[33m 318[2mms[22m[39m
 [32m✓[39m src/lib/locale-numeric-parity.test.ts [2m([22m[2m11 tests[22m[2m)[22m[33m 1845[2mms[22m[39m
 [32m✓[39m src/lib/world/voice.test.ts [2m([22m[2m31 tests[22m[2m)[22m[33m 583[2mms[22m[39m
 [32m✓[39m src/lib/world/earnings-board.test.ts [2m([22m[2m36 tests[22m[2m)[22m[33m 485[2mms[22m[39m
 [32m✓[39m src/lib/world/release-desk.test.ts [2m([22m[2m34 tests[22m[2m)[22m[32m 187[2mms[22m[39m
 [32m✓[39m src/lib/locale-waves-hi.test.ts [2m([22m[2m37 tests[22m[2m)[22m[33m 5090[2mms[22m[39m
   [32m✓[39m Stack-28 Hindi locale waves [2m(37)[22m
     [32m✓[39m W5 [2m(6)[22m
       [33m[2m✓[22m[39m keeps {{placeholder}} parity with en[33m 303[2mms[22m[39m
 [32m✓[39m src/lib/resilience-s28.test.ts [2m([22m[2m50 tests[22m[2m)[22m[33m 613[2mms[22m[39m
 [32m✓[39m src/lib/public-routes.test.ts [2m([22m[2m128 tests[22m[2m)[22m[33m 502[2mms[22m[39m
 [32m✓[39m src/lib/world/creator-heights.test.ts [2m([22m[2m25 tests[22m[2m)[22m[32m 295[2mms[22m[39m
 [32m✓[39m src/lib/world/boardwalk.test.ts [2m([22m[2m22 tests[22m[2m)[22m[33m 475[2mms[22m[39m
 [32m✓[39m src/lib/theme-packs.test.ts [2m([22m[2m35 tests[22m[2m)[22m[32m 299[2mms[22m[39m
 [32m✓[39m src/lib/world/scheduler-desk.test.ts [2m([22m[2m26 tests[22m[2m)[22m[33m 610[2mms[22m[39m
 [32m✓[39m src/lib/locale-waves-ko.test.ts [2m([22m[2m30 tests[22m[2m)[22m[33m 413[2mms[22m[39m
 [32m✓[39m src/lib/chat-voice.test.ts [2m([22m[2m27 tests[22m[2m)[22m[33m 377[2mms[22m[39m
 [32m✓[39m src/lib/locale-waves-ar.test.ts [2m([22m[2m7 tests[22m[2m)[22m[33m 3558[2mms[22m[39m
   [32m✓[39m ar-W1 (Stack-28 #70) commerce namespaces fully translated [2m(1)[22m
     [33m[2m✓[22m[39m every en key present, non-empty, placeholders intact, no untranslated residue[33m 642[2mms[22m[39m
   [32m✓[39m ar-W2 (Stack-28 #79) retention/invite + video namespaces fully translated [2m(1)[22m
     [33m[2m✓[22m[39m every en key present, non-empty, placeholders intact, no untranslated residue[33m 340[2mms[22m[39m
   [32m✓[39m ar-W3 (Stack-28 #88) studio-tool namespaces fully translated [2m(1)[22m
     [33m[2m✓[22m[39m every en key present, non-empty, placeholders intact, no untranslated residue[33m 431[2mms[22m[39m
   [32m✓[39m ar-W4 (Stack-28 #97) audio + scheduler/projects namespaces fully translated [2m(1)[22m
     [33m[2m✓[22m[39m every en key present, non-empty, placeholders intact, no untranslated residue[33m 423[2mms[22m[39m
   [32m✓[39m ar-W5 (Stack-28 appendix) link-in-bio/nfc/privacy + promo namespaces fully translated [2m(2)[22m
     [33m[2m✓[22m[39m wave is closed[33m 438[2mms[22m[39m
   [32m✓[39m ar-W6 (Stack-28 appendix) milestones/lufs/presave/stabilize/create + promote/coach/release namespaces fully translated [2m(1)[22m
     [33m[2m✓[22m[39m wave is closed[33m 1244[2mms[22m[39m
 [32m✓[39m src/lib/findability-nav.test.ts [2m([22m[2m20 tests[22m[2m)[22m[33m 2454[2mms[22m[39m
   [32m✓[39m findability — nav labels are the features' real names [2m(4)[22m
     [33m[2m✓[22m[39m every locale has every wired key, and none of them is a poetic Thy-label[33m 1140[2mms[22m[39m
   [32m✓[39m findability — the doors are hung in their home sections [2m(9)[22m
     [33m[2m✓[22m[39m the retired Thy Vision name survives nowhere — the 404 door and the carousel toast use My Projects[33m 1016[2mms[22m[39m
 [32m✓[39m src/lib/world/characters.test.ts [2m([22m[2m24 tests[22m[2m)[22m[32m 211[2mms[22m[39m
 [32m✓[39m src/lib/world/ateliers.test.ts [2m([22m[2m17 tests[22m[2m)[22m[32m 261[2mms[22m[39m
 [32m✓[39m src/lib/world/pbr-materials.test.ts [2m([22m[2m37 tests[22m[2m)[22m[33m 3518[2mms[22m[39m
   [32m✓[39m makeTileable (item 11) [2m(4)[22m
     [33m[2m✓[22m[39m keeps a flat image flat[33m 599[2mms[22m[39m
   [32m✓[39m normalFromHeight (item 9) [2m(2)[22m
     [33m[2m✓[22m[39m flat height gives the neutral tangent normal everywhere[33m 422[2mms[22m[39m
   [32m✓[39m brushed gold (item 12) [2m(4)[22m
     [33m[2m✓[22m[39m roughness stays inside the variant's range (plus grain slack)[33m 914[2mms[22m[39m
   [32m✓[39m materials round 2 (Stack-100 #2 items 9–12) [2m(7)[22m
     [33m[2m✓[22m[39m gold repeats are per-metre: goldFor exists and derives its repeat from surface size[33m 435[2mms[22m[39m
 [32m✓[39m src/lib/world/social-wave2.test.ts [2m([22m[2m29 tests[22m[2m)[22m[32m 94[2mms[22m[39m
 [32m✓[39m src/lib/world/palace-grounds.test.ts [2m([22m[2m15 tests[22m[2m)[22m[32m 286[2mms[22m[39m
 [32m✓[39m src/lib/locale-waves-ja.test.ts [2m([22m[2m18 tests[22m[2m)[22m[33m 536[2mms[22m[39m
 [32m✓[39m src/lib/world/perf-census.test.ts [2m([22m[2m22 tests[22m[2m)[22m[32m 260[2mms[22m[39m
 [32m✓[39m src/lib/world/live-desk-wave2.test.ts [2m([22m[2m21 tests[22m[2m)[22m[32m 281[2mms[22m[39m
 [32m✓[39m src/lib/world/money-desks-2.test.ts [2m([22m[2m24 tests[22m[2m)[22m[33m 397[2mms[22m[39m
 [32m✓[39m src/lib/world/tail-desks.test.ts [2m([22m[2m20 tests[22m[2m)[22m[32m 179[2mms[22m[39m
 [32m✓[39m src/lib/message-drafts.test.ts [2m([22m[2m23 tests[22m[2m)[22m[32m 185[2mms[22m[39m
 [32m✓[39m src/lib/world/games-lobby.test.ts [2m([22m[2m33 tests[22m[2m)[22m[32m 61[2mms[22m[39m
 [32m✓[39m src/lib/sibling-dashboards.test.ts [2m([22m[2m26 tests[22m[2m)[22m[32m 101[2mms[22m[39m
 [32m✓[39m src/lib/live-chat-client.test.ts [2m([22m[2m16 tests[22m[2m)[22m[32m 140[2mms[22m[39m
 [32m✓[39m src/components/guest-gate.test.ts [2m([22m[2m25 tests[22m[2m)[22m[32m 68[2mms[22m[39m
 [32m✓[39m src/lib/profile-website.test.ts [2m([22m[2m30 tests[22m[2m)[22m[32m 96[2mms[22m[39m
 [32m✓[39m src/lib/stream-controller.test.ts [2m([22m[2m19 tests[22m[2m)[22m[33m 304[2mms[22m[39m
 [32m✓[39m src/lib/world/plaza-life.test.ts [2m([22m[2m18 tests[22m[2m)[22m[33m 669[2mms[22m[39m
   [32m✓[39m plaza-life — item 26 daylight life [2m(3)[22m
     [33m[2m✓[22m[39m the pollen field is deterministic and never leaves the courtyard air[33m 409[2mms[22m[39m
 [32m✓[39m src/lib/stream-kit/rvm-engine.test.ts [2m([22m[2m17 tests[22m[2m)[22m[32m 160[2mms[22m[39m
 [32m✓[39m src/lib/world/listening-gardens.test.ts [2m([22m[2m14 tests[22m[2m)[22m[32m 126[2mms[22m[39m
 [32m✓[39m src/lib/world/live-desk.test.ts [2m([22m[2m19 tests[22m[2m)[22m[32m 205[2mms[22m[39m
 [32m✓[39m src/lib/world/stations.test.ts [2m([22m[2m14 tests[22m[2m)[22m[32m 189[2mms[22m[39m
 [32m✓[39m src/lib/command-center.test.ts [2m([22m[2m19 tests[22m[2m)[22m[32m 114[2mms[22m[39m
 [32m✓[39m src/lib/world/office-hours.test.ts [2m([22m[2m19 tests[22m[2m)[22m[33m 339[2mms[22m[39m
 [32m✓[39m src/lib/king-emoji.test.ts [2m([22m[2m26 tests[22m[2m)[22m[33m 367[2mms[22m[39m
 [32m✓[39m src/lib/world/voice-toggle.test.ts [2m([22m[2m27 tests[22m[2m)[22m[32m 101[2mms[22m[39m
 [32m✓[39m src/lib/world/character-voice.test.ts [2m([22m[2m23 tests[22m[2m)[22m[32m 122[2mms[22m[39m
 [32m✓[39m src/lib/world/money-desks.test.ts [2m([22m[2m17 tests[22m[2m)[22m[33m 337[2mms[22m[39m
 [32m✓[39m src/lib/hub-projects.test.ts [2m([22m[2m23 tests[22m[2m)[22m[32m 184[2mms[22m[39m
 [32m✓[39m src/lib/world/create-desks-components.test.ts [2m([22m[2m12 tests[22m[2m)[22m[32m 79[2mms[22m[39m
 [32m✓[39m src/lib/world/creation-row.test.ts [2m([22m[2m14 tests[22m[2m)[22m[32m 257[2mms[22m[39m
 [32m✓[39m src/lib/world/listening-party.test.ts [2m([22m[2m21 tests[22m[2m)[22m[32m 103[2mms[22m[39m
 [32m✓[39m src/lib/world/daily-drop-catalog.test.ts [2m([22m[2m21 tests[22m[2m)[22m[32m 101[2mms[22m[39m
 [32m✓[39m src/lib/world/stage-grounds.test.ts [2m([22m[2m13 tests[22m[2m)[22m[32m 148[2mms[22m[39m
 [32m✓[39m src/lib/world/groups-desk.test.ts [2m([22m[2m18 tests[22m[2m)[22m[32m 105[2mms[22m[39m
 [32m✓[39m src/lib/world/sky-env.test.ts [2m([22m[2m19 tests[22m[2m)[22m[32m 60[2mms[22m[39m
 [32m✓[39m src/lib/timeline-lock.test.ts [2m([22m[2m31 tests[22m[2m)[22m[32m 143[2mms[22m[39m
 [32m✓[39m src/lib/world/hook-desk.test.ts [2m([22m[2m17 tests[22m[2m)[22m[32m 95[2mms[22m[39m
 [32m✓[39m src/lib/world/feel-rewalk.test.ts [2m([22m[2m16 tests[22m[2m)[22m[32m 247[2mms[22m[39m
 [32m✓[39m src/lib/honesty-copy-prices.test.ts [2m([22m[2m16 tests[22m[2m)[22m[33m 478[2mms[22m[39m
 [32m✓[39m src/lib/world/palace-calendar.test.ts [2m([22m[2m18 tests[22m[2m)[22m[32m 188[2mms[22m[39m
 [32m✓[39m src/lib/world/district-gates.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 84[2mms[22m[39m
 [32m✓[39m src/lib/world/storyboard-planner.test.ts [2m([22m[2m18 tests[22m[2m)[22m[32m 96[2mms[22m[39m
 [32m✓[39m src/lib/world/parity-rewalk.test.ts [2m([22m[2m13 tests[22m[2m)[22m[33m 607[2mms[22m[39m
   [32m✓[39m item 76 (D-H8) — one My-Studio truth: STALE, pinned [2m(1)[22m
     [33m[2m✓[22m[39m exactly one my-studio station, rendered once, and no getStatus anywhere in the world lib[33m 491[2mms[22m[39m
 [32m✓[39m src/lib/credit-costs-rail-truth.test.ts [2m([22m[2m21 tests[22m[2m)[22m[32m 299[2mms[22m[39m
 [32m✓[39m src/lib/world/audio-desk-tabs.test.ts [2m([22m[2m16 tests[22m[2m)[22m[32m 100[2mms[22m[39m
 [32m✓[39m src/lib/world/plaza-solids.test.ts [2m([22m[2m16 tests[22m[2m)[22m[32m 271[2mms[22m[39m
 [31m❯[39m src/lib/signature-sounds.test.ts [2m([22m[2m27 tests[22m[2m | [22m[31m1 failed[39m[2m)[22m[33m 5825[2mms[22m[39m
   [32m✓[39m signature sound engine — the acceptance gate [2m(14)[22m
     [32m✓[39m all-on: every kind plays, through the manifest asset for its role[32m 63[2mms[22m[39m
     [32m✓[39m master off: ZERO plays for every kind[32m 8[2mms[22m[39m
     [32m✓[39m kind switch off (notification): that kind is silent, the gate says so[32m 6[2mms[22m[39m
     [32m✓[39m kind switch off (message): that kind is silent, the gate says so[32m 2[2mms[22m[39m
     [32m✓[39m kind switch off (success): that kind is silent, the gate says so[32m 3[2mms[22m[39m
     [32m✓[39m kind switch off (error): that kind is silent, the gate says so[32m 0[2mms[22m[39m
     [32m✓[39m kind switch off (sting): that kind is silent, the gate says so[32m 0[2mms[22m[39m
     [32m✓[39m kind switch off (ringtone): that kind is silent, the gate says so[32m 0[2mms[22m[39m
     [32m✓[39m success_stings off silences BOTH success and sting — and nothing else[32m 2[2mms[22m[39m
     [32m✓[39m device muted: ZERO plays for every kind, whatever the toggles say[32m 1[2mms[22m[39m
     [32m✓[39m device mute landing mid-session closes the gate at once[32m 4[2mms[22m[39m
     [32m✓[39m hidden tab: no plays[32m 1[2mms[22m[39m
     [32m✓[39m turning a switch off silences a sound already playing[32m 0[2mms[22m[39m
     [32m✓[39m master off silences a sound already playing[32m 2[2mms[22m[39m
   [32m✓[39m signature sound engine — restraint [2m(4)[22m
     [32m✓[39m per-kind cooldown collapses a burst into one play[32m 0[2mms[22m[39m
     [32m✓[39m one sound at a time: a new play retires the one still sounding[32m 0[2mms[22m[39m
     [32m✓[39m stop() retires the ringtone[32m 2[2mms[22m[39m
     [32m✓[39m an audio factory that throws never breaks the caller[32m 0[2mms[22m[39m
   [32m✓[39m arrival tracker — bells seed silently, then sound new arrivals once [2m(6)[22m
     [32m✓[39m first sighting seeds silently even with unread waiting[32m 3[2mms[22m[39m
     [32m✓[39m a new notification arrival sounds the notification role[32m 0[2mms[22m[39m
     [32m✓[39m a message arrival outranks a plain notification in the same poll[32m 0[2mms[22m[39m
     [32m✓[39m already-read arrivals never sound[32m 0[2mms[22m[39m
     [32m✓[39m isMessageKind knows the rail's message kinds[32m 4[2mms[22m[39m
     [32m✓[39m soundForNewArrivals prunes ids that left the unread set[32m 40[2mms[22m[39m
   [31m❯[39m the manifest — the only place a sound file is named [2m(3)[22m
     [32m✓[39m maps all six roles to wav assets under /sounds/[32m 4[2mms[22m[39m
     [32m✓[39m every manifest asset exists in public/sounds and is non-empty[32m 13[2mms[22m[39m
[31m     [31m×[31m no other source file names a signature-sound asset (files-only swap)[39m[33m 5624[2mms[22m[39m
 [32m✓[39m src/lib/dm-attachments.test.ts [2m([22m[2m26 tests[22m[2m)[22m[32m 291[2mms[22m[39m
 [32m✓[39m src/lib/world/creator-rooms.test.ts [2m([22m[2m11 tests[22m[2m)[22m[32m 65[2mms[22m[39m
 [32m✓[39m src/lib/world/create-finishers.test.ts [2m([22m[2m14 tests[22m[2m)[22m[32m 190[2mms[22m[39m
 [32m✓[39m src/lib/theme-kit.test.ts [2m([22m[2m18 tests[22m[2m)[22m[32m 179[2mms[22m[39m
[90mstdout[2m | src/lib/i18n-plural-forms.test.ts
[22m[39m🌐 i18next is made possible by our own product, Locize — consider powering your project with managed localization (AI, CDN, integrations): https://locize.com 💙

 [32m✓[39m src/lib/i18n-plural-forms.test.ts [2m([22m[2m10 tests[22m[2m)[22m[33m 3266[2mms[22m[39m
   [32m✓[39m plural-suffixed catalog shape [2m(3)[22m
     [33m[2m✓[22m[39m no catalog anywhere still carries a {{plural}} interpolation[33m 495[2mms[22m[39m
     [33m[2m✓[22m[39m each of the 12 keys exists in all six CLDR suffixed forms, base key gone[33m 1591[2mms[22m[39m
   [32m✓[39m plural rendering across all 10 locales [2m(2)[22m
     [33m[2m✓[22m[39m every touched key renders a real string at every probed count in every locale[33m 942[2mms[22m[39m
 [32m✓[39m src/lib/motion-pro.test.ts [2m([22m[2m27 tests[22m[2m)[22m[32m 75[2mms[22m[39m
 [32m✓[39m src/components/a11y-sweep.test.ts [2m([22m[2m28 tests[22m[2m)[22m[32m 236[2mms[22m[39m
 [32m✓[39m src/lib/scene-look.test.ts [2m([22m[2m20 tests[22m[2m)[22m[32m 136[2mms[22m[39m
 [32m✓[39m src/lib/world/visibility.test.ts [2m([22m[2m20 tests[22m[2m)[22m[32m 67[2mms[22m[39m
 [32m✓[39m src/lib/scheduler-handoff.test.ts [2m([22m[2m19 tests[22m[2m)[22m[32m 272[2mms[22m[39m
 [32m✓[39m src/lib/world/station-panel.test.ts [2m([22m[2m21 tests[22m[2m)[22m[32m 203[2mms[22m[39m
[90mstdout[2m | src/lib/i18n-plural-categories.test.ts
[22m[39m🌐 i18next is made possible by our own product, Locize — consider powering your project with managed localization (AI, CDN, integrations): https://locize.com 💙

 [32m✓[39m src/lib/i18n-plural-categories.test.ts [2m([22m[2m19 tests[22m[2m)[22m[33m 422[2mms[22m[39m
 [32m✓[39m src/components/enter-world-button.test.ts [2m([22m[2m18 tests[22m[2m)[22m[32m 173[2mms[22m[39m
 [32m✓[39m src/lib/scheduler.test.ts [2m([22m[2m24 tests[22m[2m)[22m[32m 261[2mms[22m[39m
 [32m✓[39m src/lib/world/palace-exterior.test.ts [2m([22m[2m15 tests[22m[2m)[22m[32m 68[2mms[22m[39m
 [32m✓[39m src/lib/merged-live-chat.test.ts [2m([22m[2m19 tests[22m[2m)[22m[32m 207[2mms[22m[39m
 [32m✓[39m src/lib/world/creator-room-dressing.test.ts [2m([22m[2m16 tests[22m[2m)[22m[32m 227[2mms[22m[39m
 [32m✓[39m src/lib/stream-kit/matte-post.test.ts [2m([22m[2m20 tests[22m[2m)[22m[32m 139[2mms[22m[39m
 [32m✓[39m src/lib/transcript-edit.test.ts [2m([22m[2m21 tests[22m[2m)[22m[32m 216[2mms[22m[39m
 [32m✓[39m src/lib/stream-kit/avatar-runtime.test.ts [2m([22m[2m9 tests[22m[2m)[22m[33m 335[2mms[22m[39m
 [32m✓[39m src/lib/world/jewelry-bench.test.ts [2m([22m[2m13 tests[22m[2m)[22m[32m 147[2mms[22m[39m
 [32m✓[39m src/lib/world/gamepad.test.ts [2m([22m[2m20 tests[22m[2m)[22m[32m 62[2mms[22m[39m
 [32m✓[39m src/lib/world/audio-ab.test.ts [2m([22m[2m20 tests[22m[2m)[22m[32m 78[2mms[22m[39m
 [32m✓[39m src/lib/stream-kit/avatar-face-engine.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 188[2mms[22m[39m
 [32m✓[39m src/lib/earnings-data.test.ts [2m([22m[2m12 tests[22m[2m)[22m[33m 486[2mms[22m[39m
 [32m✓[39m src/lib/world/monument-board.test.ts [2m([22m[2m6 tests[22m[2m)[22m[33m 305[2mms[22m[39m
 [32m✓[39m src/lib/world/contests.test.ts [2m([22m[2m15 tests[22m[2m)[22m[32m 128[2mms[22m[39m
 [32m✓[39m src/lib/photo-design-export.test.ts [2m([22m[2m13 tests[22m[2m)[22m[32m 143[2mms[22m[39m
 [32m✓[39m src/lib/stream-kit/avatar-drive.test.ts [2m([22m[2m23 tests[22m[2m)[22m[33m 346[2mms[22m[39m
 [32m✓[39m src/components/editor/music/still-to-lipsync.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 125[2mms[22m[39m
 [32m✓[39m src/lib/theme-remap-stack28.test.ts [2m([22m[2m37 tests[22m[2m)[22m[32m 265[2mms[22m[39m
 [32m✓[39m src/lib/arrangement.test.ts [2m([22m[2m18 tests[22m[2m)[22m[32m 116[2mms[22m[39m
 [32m✓[39m src/lib/route-integrity.test.ts [2m([22m[2m3 tests[22m[2m)[22m[33m 5887[2mms[22m[39m
   [32m✓[39m route integrity — no literal internal link points at a non-route [2m(3)[22m
     [33m[2m✓[22m[39m every literal internal link in app source resolves to a route or a public asset[33m 5844[2mms[22m[39m
 [32m✓[39m src/lib/lockdown-guest-honesty.test.ts [2m([22m[2m14 tests[22m[2m)[22m[32m 91[2mms[22m[39m
 [32m✓[39m src/lib/dashboard-sections.test.ts [2m([22m[2m16 tests[22m[2m)[22m[32m 84[2mms[22m[39m
 [32m✓[39m src/lib/short-publish.test.ts [2m([22m[2m23 tests[22m[2m)[22m[32m 115[2mms[22m[39m
 [32m✓[39m src/lib/world/money-desks-2-components.test.ts [2m([22m[2m9 tests[22m[2m)[22m[32m 130[2mms[22m[39m
 [32m✓[39m src/lib/press-kit.test.ts [2m([22m[2m26 tests[22m[2m)[22m[32m 103[2mms[22m[39m
 [32m✓[39m src/lib/reports.test.ts [2m([22m[2m15 tests[22m[2m)[22m[32m 204[2mms[22m[39m
 [32m✓[39m src/lib/world/figure-loop.test.ts [2m([22m[2m15 tests[22m[2m)[22m[32m 122[2mms[22m[39m
 [32m✓[39m src/lib/world/ugc-station.test.ts [2m([22m[2m12 tests[22m[2m)[22m[32m 87[2mms[22m[39m
 [32m✓[39m src/lib/party-client.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 198[2mms[22m[39m
 [32m✓[39m src/lib/brand-kit.test.ts [2m([22m[2m14 tests[22m[2m)[22m[32m 221[2mms[22m[39m
 [32m✓[39m src/lib/chat-speak.test.ts [2m([22m[2m14 tests[22m[2m)[22m[32m 148[2mms[22m[39m
 [32m✓[39m src/lib/studio-light-honesty.test.ts [2m([22m[2m16 tests[22m[2m)[22m[32m 54[2mms[22m[39m
 [32m✓[39m src/lib/world/movement.test.ts [2m([22m[2m14 tests[22m[2m)[22m[32m 98[2mms[22m[39m
 [32m✓[39m src/components/mobile-touch-targets.test.ts [2m([22m[2m20 tests[22m[2m)[22m[32m 64[2mms[22m[39m
 [32m✓[39m src/lib/dmca-report.test.ts [2m([22m[2m20 tests[22m[2m)[22m[32m 172[2mms[22m[39m
 [32m✓[39m src/lib/ugc-ads.test.ts [2m([22m[2m15 tests[22m[2m)[22m[32m 47[2mms[22m[39m
 [32m✓[39m src/lib/world/audio-benches.test.ts [2m([22m[2m10 tests[22m[2m)[22m[32m 138[2mms[22m[39m
 [32m✓[39m src/lib/photo-canvas.test.ts [2m([22m[2m9 tests[22m[2m)[22m[32m 76[2mms[22m[39m
 [32m✓[39m src/lib/my-shop-management-wiring.test.ts [2m([22m[2m17 tests[22m[2m)[22m[32m 122[2mms[22m[39m
 [32m✓[39m src/lib/world/drop-spectacle.test.ts [2m([22m[2m13 tests[22m[2m)[22m[32m 186[2mms[22m[39m
 [32m✓[39m src/components/editor/editor-mode-gating.test.ts [2m([22m[2m17 tests[22m[2m)[22m[32m 89[2mms[22m[39m
 [32m✓[39m src/lib/world/panel-payload.test.ts [2m([22m[2m10 tests[22m[2m)[22m[32m 99[2mms[22m[39m
 [32m✓[39m src/lib/stream-kit/stage.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 198[2mms[22m[39m
 [32m✓[39m src/lib/world/portrait-card.test.ts [2m([22m[2m11 tests[22m[2m)[22m[32m 132[2mms[22m[39m
 [32m✓[39m src/lib/seo-share-invariants.test.ts [2m([22m[2m24 tests[22m[2m)[22m[32m 140[2mms[22m[39m
 [32m✓[39m src/lib/royal-court.test.ts [2m([22m[2m16 tests[22m[2m)[22m[32m 100[2mms[22m[39m
 [32m✓[39m src/lib/master-player-size.test.ts [2m([22m[2m12 tests[22m[2m)[22m[32m 170[2mms[22m[39m
 [32m✓[39m src/lib/stream-kit/avatar-vault.test.ts [2m([22m[2m13 tests[22m[2m)[22m[32m 135[2mms[22m[39m
 [32m✓[39m src/lib/theme-remap-golds.test.ts [2m([22m[2m24 tests[22m[2m)[22m[32m 137[2mms[22m[39m
 [32m✓[39m src/lib/world/admin-locks.test.ts [2m([22m[2m10 tests[22m[2m)[22m[32m 132[2mms[22m[39m
 [32m✓[39m src/lib/world/daylight-motes.test.ts [2m([22m[2m9 tests[22m[2m)[22m[33m 2314[2mms[22m[39m
   [32m✓[39m daylight motes — the district volumes (item 4 retry) [2m(4)[22m
     [33m[2m✓[22m[39m district fields are deterministic, distinct per district, and never leave their air[33m 2227[2mms[22m[39m
 [32m✓[39m src/lib/promo-card-history.test.ts [2m([22m[2m15 tests[22m[2m)[22m[32m 210[2mms[22m[39m
 [32m✓[39m src/lib/world/guard-fixtures.test.ts [2m([22m[2m17 tests[22m[2m)[22m[32m 46[2mms[22m[39m
 [32m✓[39m src/lib/scene-references.test.ts [2m([22m[2m16 tests[22m[2m)[22m[32m 133[2mms[22m[39m
 [32m✓[39m src/pages/fe-datapaths-pages.test.ts [2m([22m[2m15 tests[22m[2m)[22m[32m 94[2mms[22m[39m
 [32m✓[39m src/lib/world/creator-profile-create.test.ts [2m([22m[2m11 tests[22m[2m)[22m[32m 132[2mms[22m[39m
 [32m✓[39m src/lib/hub-song.test.ts [2m([22m[2m11 tests[22m[2m)[22m[32m 106[2mms[22m[39m
 [32m✓[39m src/lib/stream-kit/frame-stall.test.ts [2m([22m[2m15 tests[22m[2m)[22m[32m 45[2mms[22m[39m
 [32m✓[39m src/lib/tour.test.ts [2m([22m[2m20 tests[22m[2m)[22m[33m 383[2mms[22m[39m
 [32m✓[39m src/lib/world/party-invite-doors.test.ts [2m([22m[2m11 tests[22m[2m)[22m[32m 167[2mms[22m[39m
 [32m✓[39m src/components/wallpapers/wallpapers-desk.test.ts [2m([22m[2m11 tests[22m[2m)[22m[32m 105[2mms[22m[39m
 [32m✓[39m src/components/editor/sections/export-doctor-honesty.test.ts [2m([22m[2m17 tests[22m[2m)[22m[32m 97[2mms[22m[39m
 [32m✓[39m src/lib/theme-kit-sound-stamp.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 152[2mms[22m[39m
 [32m✓[39m src/lib/artist-profiles-media.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 159[2mms[22m[39m
 [32m✓[39m src/pages/pitch-fix-wiring.test.ts [2m([22m[2m9 tests[22m[2m)[22m[32m 204[2mms[22m[39m
 [32m✓[39m src/lib/world/room-bar.test.ts [2m([22m[2m11 tests[22m[2m)[22m[32m 173[2mms[22m[39m
 [32m✓[39m src/components/SceneStudio/CameraMovePlanner.test.ts [2m([22m[2m12 tests[22m[2m)[22m[32m 210[2mms[22m[39m
 [32m✓[39m src/lib/stem-fx-chain.test.ts [2m([22m[2m12 tests[22m[2m)[22m[32m 68[2mms[22m[39m
 [32m✓[39m src/components/theme-packs/theme-packs-desk.test.ts [2m([22m[2m17 tests[22m[2m)[22m[32m 44[2mms[22m[39m
 [32m✓[39m src/lib/editor-mobile-sheet.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 191[2mms[22m[39m
 [32m✓[39m src/lib/splits-editor.test.ts [2m([22m[2m17 tests[22m[2m)[22m[32m 258[2mms[22m[39m
 [32m✓[39m src/lib/earnings-statement.test.ts [2m([22m[2m13 tests[22m[2m)[22m[32m 162[2mms[22m[39m
 [32m✓[39m src/lib/studio-context-menu.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 32[2mms[22m[39m
 [32m✓[39m src/lib/world/__tests__/tutorial.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 91[2mms[22m[39m
 [32m✓[39m src/components/chat-voice-wiring.test.ts [2m([22m[2m10 tests[22m[2m)[22m[32m 56[2mms[22m[39m
 [32m✓[39m src/lib/prerender-sitemap-lockdown.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 132[2mms[22m[39m
 [32m✓[39m src/lib/fcpxml-export.test.ts [2m([22m[2m10 tests[22m[2m)[22m[32m 158[2mms[22m[39m
 [32m✓[39m src/lib/broken-doors.test.ts [2m([22m[2m10 tests[22m[2m)[22m[32m 92[2mms[22m[39m
 [32m✓[39m src/lib/world/announce.test.ts [2m([22m[2m9 tests[22m[2m)[22m[32m 143[2mms[22m[39m
 [32m✓[39m src/lib/scene-timing.test.ts [2m([22m[2m16 tests[22m[2m)[22m[32m 89[2mms[22m[39m
 [32m✓[39m src/lib/world/money-desks-components.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 122[2mms[22m[39m
 [32m✓[39m src/lib/world/actions.test.ts [2m([22m[2m23 tests[22m[2m)[22m[32m 126[2mms[22m[39m
 [32m✓[39m src/lib/stream-pack.test.ts [2m([22m[2m11 tests[22m[2m)[22m[32m 144[2mms[22m[39m
 [32m✓[39m src/lib/wallpapers.test.ts [2m([22m[2m11 tests[22m[2m)[22m[32m 151[2mms[22m[39m
 [32m✓[39m src/lib/tutorials.test.ts [2m([22m[2m10 tests[22m[2m)[22m[32m 156[2mms[22m[39m
 [32m✓[39m src/lib/co-releases.test.ts [2m([22m[2m13 tests[22m[2m)[22m[32m 90[2mms[22m[39m
 [32m✓[39m src/lib/world/studio-board.test.ts [2m([22m[2m11 tests[22m[2m)[22m[33m 347[2mms[22m[39m
 [32m✓[39m src/lib/active-artist.test.ts [2m([22m[2m12 tests[22m[2m)[22m[32m 126[2mms[22m[39m
 [32m✓[39m src/lib/stream-kit/avatar-rigs.test.ts [2m([22m[2m9 tests[22m[2m)[22m[32m 77[2mms[22m[39m
 [32m✓[39m src/lib/commerce-pixels.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 100[2mms[22m[39m
 [32m✓[39m src/lib/stream-kit/scenes.test.ts [2m([22m[2m13 tests[22m[2m)[22m[32m 99[2mms[22m[39m
 [32m✓[39m src/lib/__tests__/export-job-poll.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 208[2mms[22m[39m
 [32m✓[39m src/lib/world/voice-ice.test.ts [2m([22m[2m11 tests[22m[2m)[22m[32m 53[2mms[22m[39m
 [32m✓[39m src/lib/world/kingdom-party-tables.test.ts [2m([22m[2m10 tests[22m[2m)[22m[32m 82[2mms[22m[39m
 [32m✓[39m src/lib/asset-library.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 116[2mms[22m[39m
 [32m✓[39m src/lib/timeline-lanes.test.ts [2m([22m[2m11 tests[22m[2m)[22m[32m 168[2mms[22m[39m
 [32m✓[39m src/lib/world/presence-rewalk.test.ts [2m([22m[2m9 tests[22m[2m)[22m[32m 186[2mms[22m[39m
 [32m✓[39m src/lib/world/creator-room-tier.test.ts [2m([22m[2m10 tests[22m[2m)[22m[32m 264[2mms[22m[39m
 [32m✓[39m src/components/site-mode/site-mode-gate-lockdown.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 73[2mms[22m[39m
 [32m✓[39m src/lib/smartlink-pixels.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 123[2mms[22m[39m
 [32m✓[39m src/lib/locale-source-auto.test.ts [2m([22m[2m29 tests[22m[2m)[22m[33m 2492[2mms[22m[39m
 [32m✓[39m src/components/wallpapers/wallpapers-prices.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 203[2mms[22m[39m
 [32m✓[39m src/components/trust/TrustPanels.claims.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 39[2mms[22m[39m
 [32m✓[39m src/lib/catalog-import-honesty.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 32[2mms[22m[39m
 [32m✓[39m src/lib/sfx.test.ts [2m([22m[2m14 tests[22m[2m)[22m[32m 66[2mms[22m[39m
 [32m✓[39m src/lib/resolve-video-audio-url.test.ts [2m([22m[2m11 tests[22m[2m)[22m[32m 108[2mms[22m[39m
 [32m✓[39m src/components/guest-gate-alias-behavior.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 129[2mms[22m[39m
 [32m✓[39m src/lib/onboarding.test.ts [2m([22m[2m13 tests[22m[2m)[22m[32m 202[2mms[22m[39m
 [32m✓[39m src/lib/go-live/studio-bridge.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 26[2mms[22m[39m
 [32m✓[39m src/lib/world/hall-looks.test.ts [2m([22m[2m9 tests[22m[2m)[22m[32m 63[2mms[22m[39m
 [32m✓[39m src/lib/world/groups-desk-components.test.ts [2m([22m[2m12 tests[22m[2m)[22m[32m 276[2mms[22m[39m
 [32m✓[39m src/components/chat-speak-wiring.test.ts [2m([22m[2m10 tests[22m[2m)[22m[32m 97[2mms[22m[39m
 [32m✓[39m src/lib/world/lips.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 142[2mms[22m[39m
 [32m✓[39m src/lib/stream-kit/stream-recorder.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 80[2mms[22m[39m
 [32m✓[39m src/lib/world/king-moment.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 39[2mms[22m[39m
 [32m✓[39m src/lib/world/party-table-home.test.ts [2m([22m[2m9 tests[22m[2m)[22m[32m 70[2mms[22m[39m
 [32m✓[39m src/components/identity-set-wiring.test.ts [2m([22m[2m11 tests[22m[2m)[22m[32m 56[2mms[22m[39m
 [32m✓[39m src/lib/website-builder-gallery.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 75[2mms[22m[39m
 [32m✓[39m src/lib/go-live/guest-mesh.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 60[2mms[22m[39m
 [32m✓[39m src/lib/handoff-sweep.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 170[2mms[22m[39m
 [32m✓[39m src/lib/publishing-splits.test.ts [2m([22m[2m12 tests[22m[2m)[22m[32m 131[2mms[22m[39m
 [32m✓[39m src/pages/group-detail-forum.test.ts [2m([22m[2m10 tests[22m[2m)[22m[32m 90[2mms[22m[39m
 [32m✓[39m src/lib/scene-chaining.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 69[2mms[22m[39m
 [32m✓[39m src/lib/world/bindings.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 69[2mms[22m[39m
 [32m✓[39m src/lib/earned-rank.test.ts [2m([22m[2m13 tests[22m[2m)[22m[32m 95[2mms[22m[39m
 [32m✓[39m src/lib/song-library.test.ts [2m([22m[2m10 tests[22m[2m)[22m[32m 83[2mms[22m[39m
 [32m✓[39m src/lib/carousel-disclosure.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 28[2mms[22m[39m
 [32m✓[39m src/lib/co-posts.test.ts [2m([22m[2m11 tests[22m[2m)[22m[32m 86[2mms[22m[39m
 [32m✓[39m src/lib/scheduler-calendar-depth.test.ts [2m([22m[2m9 tests[22m[2m)[22m[32m 28[2mms[22m[39m
 [32m✓[39m src/lib/profile-memberships-guest.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 83[2mms[22m[39m
 [32m✓[39m src/lib/stream-kit/avatar-stage.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 10[2mms[22m[39m
 [32m✓[39m src/lib/subject-reframe.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 57[2mms[22m[39m
 [32m✓[39m src/components/chat-doors-wiring.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 85[2mms[22m[39m
 [32m✓[39m src/lib/setlist.test.ts [2m([22m[2m15 tests[22m[2m)[22m[32m 195[2mms[22m[39m
 [32m✓[39m src/lib/world/website-switch.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 63[2mms[22m[39m
 [32m✓[39m src/lib/world/water-levels.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 83[2mms[22m[39m
 [32m✓[39m src/lib/stream-kit/audio-mixer.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 113[2mms[22m[39m
 [32m✓[39m src/lib/profile-website-guards.test.ts [2m([22m[2m10 tests[22m[2m)[22m[32m 116[2mms[22m[39m
 [32m✓[39m src/lib/subject-reframe-wiring.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 197[2mms[22m[39m
 [32m✓[39m src/lib/project-handoff.test.ts [2m([22m[2m10 tests[22m[2m)[22m[32m 141[2mms[22m[39m
 [32m✓[39m src/data/video-template-gallery-price.test.ts [2m([22m[2m4 tests[22m[2m)[22m[33m 1066[2mms[22m[39m
   [32m✓[39m video template gallery price == rail charge [2m(4)[22m
     [33m[2m✓[22m[39m applyPrice exists in all 10 catalogs with the count + brand intact[33m 1010[2mms[22m[39m
 [32m✓[39m src/lib/royalties-load.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 66[2mms[22m[39m
 [32m✓[39m src/lib/chat-doors.test.ts [2m([22m[2m9 tests[22m[2m)[22m[32m 120[2mms[22m[39m
 [32m✓[39m src/lib/comment-replies.test.ts [2m([22m[2m14 tests[22m[2m)[22m[32m 63[2mms[22m[39m
 [32m✓[39m src/lib/smartlink-routing.test.ts [2m([22m[2m9 tests[22m[2m)[22m[33m 322[2mms[22m[39m
 [32m✓[39m src/components/editor/editor-honesty.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 44[2mms[22m[39m
 [32m✓[39m src/components/site-mode/site-mode-theme.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 27[2mms[22m[39m
 [32m✓[39m src/lib/world/court-season.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 145[2mms[22m[39m
 [32m✓[39m src/components/settings-cards-not-ready.test.ts [2m([22m[2m9 tests[22m[2m)[22m[33m 1037[2mms[22m[39m
   [32m✓[39m SocialProofSettings — 503 renders the localized notReady line [2m(3)[22m
     [33m[2m✓[22m[39m the notReady key exists in every locale[33m 968[2mms[22m[39m
 [32m✓[39m src/lib/artist-profiles-song-pin.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 6[2mms[22m[39m
 [32m✓[39m src/lib/media-serving.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 18[2mms[22m[39m
 [32m✓[39m src/lib/feedback-prompt.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 31[2mms[22m[39m
 [32m✓[39m src/lib/world/figure.test.ts [2m([22m[2m10 tests[22m[2m)[22m[32m 149[2mms[22m[39m
 [32m✓[39m src/lib/midi-roll.test.ts [2m([22m[2m9 tests[22m[2m)[22m[32m 49[2mms[22m[39m
 [32m✓[39m src/lib/scheduler-handoff-wiring.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 49[2mms[22m[39m
 [32m✓[39m src/lib/arcade-games.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 96[2mms[22m[39m
 [32m✓[39m src/lib/explore-data.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 123[2mms[22m[39m
 [32m✓[39m src/lib/kings-set.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 46[2mms[22m[39m
 [32m✓[39m src/lib/world/night-life.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 214[2mms[22m[39m
 [32m✓[39m src/lib/world/boot-lifecycle.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 58[2mms[22m[39m
 [32m✓[39m src/components/publish/publish-protocol.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 31[2mms[22m[39m
 [32m✓[39m src/lib/shorts-data.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 141[2mms[22m[39m
 [32m✓[39m src/pages/songs/dj-set-prep.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 150[2mms[22m[39m
 [32m✓[39m src/lib/asset-handoff.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 93[2mms[22m[39m
 [32m✓[39m src/lib/courses.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 230[2mms[22m[39m
 [32m✓[39m src/components/GenerateArtistImageModal.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 34[2mms[22m[39m
 [32m✓[39m src/lib/world/post-assist.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 38[2mms[22m[39m
 [32m✓[39m src/lib/charts-brands.test.ts [2m([22m[2m9 tests[22m[2m)[22m[32m 51[2mms[22m[39m
 [32m✓[39m src/lib/world/figure-mouth-decouple.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 165[2mms[22m[39m
 [32m✓[39m src/lib/reach-watch.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 48[2mms[22m[39m
 [32m✓[39m src/lib/prompt-improve.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 118[2mms[22m[39m
 [32m✓[39m src/lib/alt-text-attachments.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 86[2mms[22m[39m
 [32m✓[39m src/pages/group-detail-tier-gate.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 29[2mms[22m[39m
 [32m✓[39m src/lib/photo-matting.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 62[2mms[22m[39m
 [32m✓[39m src/lib/title-studio.test.ts [2m([22m[2m14 tests[22m[2m)[22m[32m 154[2mms[22m[39m
 [32m✓[39m src/lib/shops.test.ts [2m([22m[2m14 tests[22m[2m)[22m[32m 86[2mms[22m[39m
 [32m✓[39m src/lib/__tests__/compare-slider.test.ts [2m([22m[2m16 tests[22m[2m)[22m[32m 114[2mms[22m[39m
 [32m✓[39m src/lib/world/notifications.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 159[2mms[22m[39m
 [32m✓[39m src/lib/__tests__/lrc.test.ts [2m([22m[2m11 tests[22m[2m)[22m[32m 114[2mms[22m[39m
 [32m✓[39m src/pages/memberships-pause.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 44[2mms[22m[39m
 [32m✓[39m src/lib/__tests__/lyric-video.test.ts [2m([22m[2m13 tests[22m[2m)[22m[32m 46[2mms[22m[39m
 [32m✓[39m src/components/editor/music/lipsync-coming-soon.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 52[2mms[22m[39m
 [32m✓[39m src/lib/link-in-bio-builder.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 98[2mms[22m[39m
 [32m✓[39m src/components/final-video-export-pro-finish.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 20[2mms[22m[39m
 [32m✓[39m src/lib/pricing-reconcile.test.ts [2m([22m[2m4 tests[22m[2m)[22m[33m 996[2mms[22m[39m
   [32m✓[39m credit pack displays match the server PACK_MAP on every surface [2m(2)[22m
     [33m[2m✓[22m[39m all 10 locale catalogs price the packs $9/$39/$99/$249 for 1k/5k/15k/50k VB[33m 908[2mms[22m[39m
 [32m✓[39m src/components/scene-costars-wiring.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 24[2mms[22m[39m
 [32m✓[39m src/components/reach/IngestKeyPanel.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 51[2mms[22m[39m
 [32m✓[39m src/lib/editor-library.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 99[2mms[22m[39m
 [32m✓[39m src/lib/world/step-dust.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 144[2mms[22m[39m
 [32m✓[39m src/components/trust/legacy-contact.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 11[2mms[22m[39m
 [32m✓[39m src/lib/world/capsule-color.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 191[2mms[22m[39m
 [32m✓[39m src/lib/track-context-menu.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 64[2mms[22m[39m
 [32m✓[39m src/lib/platform-fee-truth.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 65[2mms[22m[39m
 [32m✓[39m src/lib/asset-context-menu.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 137[2mms[22m[39m
 [32m✓[39m src/components/layout/floating-admin-panel.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 39[2mms[22m[39m
 [32m✓[39m src/components/artist/social-proof-strip.test.ts [2m([22m[2m7 tests[22m[2m)[22m[33m 330[2mms[22m[39m
 [32m✓[39m src/components/scene-look-rails-wiring.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 56[2mms[22m[39m
 [32m✓[39m src/data/video-templates.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 93[2mms[22m[39m
 [32m✓[39m src/lib/world/level-watch.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 109[2mms[22m[39m
 [32m✓[39m src/lib/color-pro.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 117[2mms[22m[39m
 [32m✓[39m src/lib/world/stage-tip.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 164[2mms[22m[39m
 [32m✓[39m src/components/trust/catalog-export-builder.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 19[2mms[22m[39m
 [32m✓[39m src/lib/beat-license-terms.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 209[2mms[22m[39m
 [32m✓[39m src/contexts/referral-attribution.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 20[2mms[22m[39m
 [32m✓[39m src/components/scene-effects-wiring.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 22[2mms[22m[39m
 [32m✓[39m src/lib/locale-email-opens.test.ts [2m([22m[2m18 tests[22m[2m)[22m[33m 362[2mms[22m[39m
 [32m✓[39m src/lib/scheduler-release-chip.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 36[2mms[22m[39m
 [32m✓[39m src/lib/world/jukebox-sync.test.ts [2m([22m[2m9 tests[22m[2m)[22m[32m 36[2mms[22m[39m
 [32m✓[39m src/lib/__tests__/editor-priority-s200.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 44[2mms[22m[39m
 [32m✓[39m src/components/sample-clearance/sample-clearance-wiring.test.ts [2m([22m[2m9 tests[22m[2m)[22m[32m 57[2mms[22m[39m
 [32m✓[39m src/components/fan-graph-visibility.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 212[2mms[22m[39m
 [32m✓[39m src/data/llc-state-fees.test.ts [2m([22m[2m11 tests[22m[2m)[22m[32m 172[2mms[22m[39m
 [32m✓[39m src/lib/stream-kit/perf-ladder.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 44[2mms[22m[39m
 [32m✓[39m src/lib/locale-subject-reframe.test.ts [2m([22m[2m20 tests[22m[2m)[22m[32m 173[2mms[22m[39m
 [32m✓[39m src/hooks/use-sidebar-collapsed.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 30[2mms[22m[39m
 [32m✓[39m src/lib/photo-context-menu.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 73[2mms[22m[39m
 [32m✓[39m src/lib/locale-email-explainer.test.ts [2m([22m[2m11 tests[22m[2m)[22m[33m 787[2mms[22m[39m
 [32m✓[39m src/lib/text-edit.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 62[2mms[22m[39m
 [32m✓[39m src/lib/go-live/guest-feeds.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 80[2mms[22m[39m
 [32m✓[39m src/lib/world/panel-open-visibility.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 36[2mms[22m[39m
 [32m✓[39m src/lib/spotlight.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 32[2mms[22m[39m
 [32m✓[39m src/lib/collabs.test.ts [2m([22m[2m13 tests[22m[2m)[22m[32m 75[2mms[22m[39m
 [32m✓[39m src/lib/live-alerts-client.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 115[2mms[22m[39m
 [32m✓[39m src/lib/__tests__/scene-effects.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 82[2mms[22m[39m
 [32m✓[39m src/lib/desks.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 39[2mms[22m[39m
 [32m✓[39m src/lib/__tests__/editor-opening-hook.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 53[2mms[22m[39m
 [32m✓[39m src/data/features.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 130[2mms[22m[39m
 [32m✓[39m src/world-3d-proof/showdown-slots.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 117[2mms[22m[39m
 [32m✓[39m src/lib/__tests__/lip-sync-result-meta.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 79[2mms[22m[39m
 [32m✓[39m src/components/discovery/notifications-read-state.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 31[2mms[22m[39m
 [32m✓[39m src/lib/app-downloads.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 127[2mms[22m[39m
 [32m✓[39m src/lib/scheduler-provenance.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 29[2mms[22m[39m
 [32m✓[39m src/lib/branding-shop.test.ts [2m([22m[2m10 tests[22m[2m)[22m[32m 186[2mms[22m[39m
 [32m✓[39m src/lib/world/prop-variation.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 234[2mms[22m[39m
 [32m✓[39m src/lib/presave-tracklist.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 104[2mms[22m[39m
 [32m✓[39m src/pages/library-tab-param.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 78[2mms[22m[39m
 [32m✓[39m src/lib/world/courtesies.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 85[2mms[22m[39m
 [32m✓[39m src/pages/group-detail-datapaths.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 81[2mms[22m[39m
 [32m✓[39m src/components/scene-end-frame-wiring.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 90[2mms[22m[39m
 [32m✓[39m src/lib/product-reviews.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 22[2mms[22m[39m
 [32m✓[39m src/lib/editor-settings-speed-curve.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 51[2mms[22m[39m
 [32m✓[39m src/pages/video-studio.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 99[2mms[22m[39m
 [32m✓[39m src/lib/world/nameplate.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 22[2mms[22m[39m
 [32m✓[39m src/lib/__tests__/product-drop.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 173[2mms[22m[39m
 [32m✓[39m src/components/discovery/cards.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 91[2mms[22m[39m
 [32m✓[39m src/lib/content-calendar.test.ts [2m([22m[2m9 tests[22m[2m)[22m[32m 71[2mms[22m[39m
 [32m✓[39m src/lib/sound-fit.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 38[2mms[22m[39m
 [32m✓[39m src/lib/stream-kit/widget-data.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 97[2mms[22m[39m
 [32m✓[39m src/lib/academy-courses.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 142[2mms[22m[39m
 [32m✓[39m src/lib/content-removal.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 108[2mms[22m[39m
 [32m✓[39m src/components/discovery/notifications-bell.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 140[2mms[22m[39m
 [32m✓[39m src/lib/my-projects-tabs.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 28[2mms[22m[39m
 [32m✓[39m src/lib/world/fullscreen.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 15[2mms[22m[39m
 [32m✓[39m src/lib/voiceover.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 51[2mms[22m[39m
 [32m✓[39m src/lib/coach-next-action.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 221[2mms[22m[39m
 [32m✓[39m src/lib/video-translator.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 97[2mms[22m[39m
 [32m✓[39m src/lib/world/boot-screen-gate.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 45[2mms[22m[39m
 [32m✓[39m src/lib/world/perf-instancing.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 83[2mms[22m[39m
 [32m✓[39m src/lib/__tests__/poll-tolerance.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 54[2mms[22m[39m
 [32m✓[39m src/lib/feed-formats.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 21[2mms[22m[39m
 [32m✓[39m src/lib/world/view-mode.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 50[2mms[22m[39m
 [32m✓[39m src/lib/distribution.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 69[2mms[22m[39m
 [32m✓[39m src/pages/live-shopping-datapaths.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 43[2mms[22m[39m
 [32m✓[39m src/components/wallpapers/wallpapers-logo.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 20[2mms[22m[39m
 [32m✓[39m src/lib/server-strings-locale.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 25[2mms[22m[39m
 [32m✓[39m src/pages/credit-history-datapaths.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 96[2mms[22m[39m
 [32m✓[39m src/lib/content-warnings.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 85[2mms[22m[39m
 [32m✓[39m src/lib/clip-context-menu-tone.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 64[2mms[22m[39m
 [32m✓[39m src/lib/email-list-honesty.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 36[2mms[22m[39m
 [32m✓[39m src/lib/repurpose.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 119[2mms[22m[39m
 [32m✓[39m src/lib/contests.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 182[2mms[22m[39m
 [32m✓[39m src/components/active-overlay-face-protect.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 20[2mms[22m[39m
 [32m✓[39m src/lib/__tests__/scene-end-frame.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 45[2mms[22m[39m
 [32m✓[39m src/lib/world/room-trim.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 67[2mms[22m[39m
 [32m✓[39m src/lib/destination-keys.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 27[2mms[22m[39m
 [32m✓[39m src/lib/podcast.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 31[2mms[22m[39m
 [32m✓[39m src/components/presave-tracklist-wiring.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 27[2mms[22m[39m
 [32m✓[39m src/components/__tests__/cheat-code-jackpot.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 189[2mms[22m[39m
 [32m✓[39m src/lib/cover-art.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 55[2mms[22m[39m
 [32m✓[39m src/lib/live-shopping.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 92[2mms[22m[39m
 [32m✓[39m src/lib/load-fonts.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 231[2mms[22m[39m
 [32m✓[39m src/lib/cooldown.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 130[2mms[22m[39m
 [32m✓[39m src/lib/make-song-price-display.test.ts [2m([22m[2m3 tests[22m[2m)[22m[33m 1217[2mms[22m[39m
   [32m✓[39m make-song price: footnote == button == rail (400 VB) [2m(3)[22m
     [33m[2m✓[22m[39m every catalog's footnote states 400, never 100[33m 1144[2mms[22m[39m
 [32m✓[39m src/lib/tap-targets.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 67[2mms[22m[39m
 [32m✓[39m src/lib/corner-budget.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 148[2mms[22m[39m
 [32m✓[39m src/lib/randomizer-price-copy.test.ts [2m([22m[2m11 tests[22m[2m)[22m[33m 802[2mms[22m[39m
 [32m✓[39m src/lib/pitch-fix.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 145[2mms[22m[39m
 [32m✓[39m src/lib/world/indoor-dressing.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 83[2mms[22m[39m
 [32m✓[39m src/lib/sponsors.test.ts [2m([22m[2m12 tests[22m[2m)[22m[33m 346[2mms[22m[39m
 [32m✓[39m src/lib/push-client.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 112[2mms[22m[39m
 [32m✓[39m src/lib/comment-controls.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 20[2mms[22m[39m
 [32m✓[39m src/lib/world/world-typing-guard.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 78[2mms[22m[39m
 [32m✓[39m src/lib/templates-guest-copy.test.ts [2m([22m[2m2 tests[22m[2m)[22m[32m 48[2mms[22m[39m
 [32m✓[39m src/lib/thumbnail-test.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 298[2mms[22m[39m
 [32m✓[39m src/lib/lazy-marketing-routes.test.ts [2m([22m[2m2 tests[22m[2m)[22m[32m 192[2mms[22m[39m
 [32m✓[39m src/lib/hero-defer.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 57[2mms[22m[39m
 [32m✓[39m src/lib/email-list-edit-details.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 82[2mms[22m[39m
 [32m✓[39m src/lib/coach-tracker.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 200[2mms[22m[39m
 [32m✓[39m src/lib/sample-pack.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 72[2mms[22m[39m
 [32m✓[39m src/lib/storefront-product.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 25[2mms[22m[39m
 [32m✓[39m src/lib/shorts-navigation.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 44[2mms[22m[39m
 [32m✓[39m src/lib/clip-maker.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 45[2mms[22m[39m
 [32m✓[39m src/lib/profile-shop-link.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 33[2mms[22m[39m
 [32m✓[39m src/components/editor/music/stem-waveform.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 118[2mms[22m[39m
 [32m✓[39m src/lib/ducking.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 26[2mms[22m[39m
 [32m✓[39m src/lib/chunk-split.test.ts [2m([22m[2m2 tests[22m[2m)[22m[32m 62[2mms[22m[39m
 [32m✓[39m src/lib/locale-split.test.ts [2m([22m[2m2 tests[22m[2m)[22m[32m 81[2mms[22m[39m
 [32m✓[39m src/lib/table-scroll-wrappers.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 71[2mms[22m[39m
 [32m✓[39m src/lib/stream-kit/guest-source.test.ts [2m([22m[2m2 tests[22m[2m)[22m[32m 29[2mms[22m[39m
 [32m✓[39m src/lib/quests-anchor.test.ts [2m([22m[2m2 tests[22m[2m)[22m[32m 49[2mms[22m[39m
 [32m✓[39m src/lib/witty-loader-poster.test.ts [2m([22m[2m2 tests[22m[2m)[22m[32m 28[2mms[22m[39m
 [32m✓[39m src/lib/viewport-zoom.test.ts [2m([22m[2m1 test[22m[2m)[22m[32m 17[2mms[22m[39m
 [32m✓[39m src/lib/editor-text-size.test.ts [2m([22m[2m1 test[22m[2m)[22m[32m 53[2mms[22m[39m
 [32m✓[39m src/components/ui/button.test.ts [2m([22m[2m2 tests[22m[2m)[22m[32m 7[2mms[22m[39m
 [32m✓[39m src/lib/wanted-meter-aria.test.ts [2m([22m[2m1 test[22m[2m)[22m[32m 24[2mms[22m[39m

[31m⎯⎯⎯⎯⎯⎯⎯[39m[1m[41m Failed Tests 1 [49m[22m[31m⎯⎯⎯⎯⎯⎯⎯[39m

[41m[1m FAIL [22m[49m src/lib/signature-sounds.test.ts[2m > [22mthe manifest — the only place a sound file is named[2m > [22mno other source file names a signature-sound asset (files-only swap)
[31m[1mError[22m: Test timed out in 5000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".[39m
[36m [2m❯[22m src/lib/signature-sounds.test.ts:[2m279:3[22m[39m
    [90m277|[39m   });
    [90m278|[39m
    [90m279|[39m   it("no other source file names a signature-sound asset (files-only s…
    [90m   |[39m   [31m^[39m
    [90m280|[39m     const srcRoot = new URL("../", import.meta.url).pathname;
    [90m281|[39m     const offenders: string[] = [];

[31m[2m⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯[22m[39m


[2m Test Files [22m [1m[31m1 failed[39m[22m[2m | [22m[1m[32m409 passed[39m[22m[90m (410)[39m
[2m      Tests [22m [1m[31m1 failed[39m[22m[2m | [22m[1m[32m5339 passed[39m[22m[90m (5340)[39m
[2m   Start at [22m 16:51:12
[2m   Duration [22m 890.17s[2m (tests 44%, import 29%, transform 21%, worker 6%)[22m

[2m    Isolate [22m [33m410 workers spawned[39m[2m · ~1.31s startup each (spawn + environment, per file)[22m
[2m            [22m [2mat least ~536.91s faster with [22m[33misolate: false[39m[2m — reuses workers across files instead of one per file[22m

full-fe exit=1
ALLDONE-FE 2026-10-26T17:06:03Z

== isolated re-run verdict: src/lib/signature-sounds.test.ts ==
26 passed / 1 failed — the same whole-tree scan test timed out at the
5000ms testTimeout (ran 5730ms) with NO assertion failure and no
offenders reported. This is the PRE-EXISTING base defect named in the
lane brief (signature-sounds whole-tree scan timeout on the untouched
base); the lane's files name no signature-sound assets. Full FE suite:
409/410 files passed, 5339/5340 tests passed, sole failure = this
pre-existing timeout.
