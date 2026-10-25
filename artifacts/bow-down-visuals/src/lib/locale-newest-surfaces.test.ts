/**
 * locale-newest-surfaces.test.ts — wave-3/4 newest surfaces speak all 10
 * languages (Stack-20 locale-parity lane, Oct 21 2026).
 *
 * History: the newest surfaces shipped English-first and the catalogs
 * silently fell back — the email automations/segments block existed only
 * in en.json, djSets / tutorials / command / smartClips likewise, and
 * playlistPitch existed in only 5 of 10 catalogs (hi/it/ja/ko/pt had
 * none of it). This test pins the repaired state: every key of the
 * wave-3/4 surface blocks must exist, non-empty, in EVERY catalog, with
 * the en placeholder shape ({{...}} tokens) preserved exactly.
 *
 * The required set is DERIVED from en.json at runtime (whole namespaces
 * + block prefixes), so adding a key to one of these blocks in en
 * without translating it fails this suite from now on.
 *
 * Known deliberate exception: socialProof.headlinePrefix may be empty
 * in ja/ko — the headline composes prefix + count + word + tail, and in
 * those languages the count leads, so the prefix slot is legitimately
 * blank (the words live in headlineCreatorsWord/headlineTail).
 *
 * Value-level follow-up (Stack-20 playlistPitch translation pass,
 * Oct 21 2026): key presence alone had masked a second gap — in
 * ar/de/es/fr most playlistPitch VALUES were byte-identical English
 * (73/78/73/76 of 120). Those are now really translated, and the last
 * describe block below pins it: a playlistPitch value identical to en
 * fails the suite unless the key sits on that locale's explicit
 * legit-identical allowlist (loanwords, identically-spelled words,
 * universal abbreviations — each entry justified in the comment).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ALL = ["en", "es", "fr", "de", "it", "pt", "ar", "hi", "ja", "ko"] as const;

type Catalog = Record<string, unknown>;

function load(locale: string): Catalog {
  const raw = readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), "utf8");
  return JSON.parse(raw) as Catalog;
}

function flat(o: unknown, p = "", out: Record<string, string> = {}): Record<string, string> {
  if (o && typeof o === "object" && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const key = p ? `${p}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) flat(v, key, out);
      else out[key] = v as string;
    }
  }
  return out;
}

const CATALOGS: Record<string, Record<string, string>> = {};
for (const l of ALL) CATALOGS[l] = flat(load(l));
const EN = CATALOGS.en!;

/* Whole namespaces that are wave-3/4 surfaces end to end. The middle six were
   added by the surface-wiring lane: those pages were wired to t() and their
   strings now live in these namespaces. The next three (videoExport,
   outOfCredits, showcasePublish) came with the export-screen wiring lane:
   FinalVideoExport's general export surface plus its two hardcoded
   siblings. The last two (share, review) came with the share-wiring lane:
   ShareMenu + ShareForReview were partially on useTranslation — the en
   catalog carried the namespaces but the other nine catalogs had neither,
   so every non-English user silently got English. "videoEditor" was added
   by the editor-i18n backfill lane (Oct 21 2026): whole editor sub-blocks
   (multiRatio, extractAudio, screenRecorder, stockLibrary, mask,
   motionTrack, myLibrary, the vibes/freeze/share clusters) existed only in
   en.json, and 130 component-referenced keys existed in no catalog at all
   (code defaultValue only) — all are now in en and translated ×9, and the
   whole namespace is pinned here so no editor block can ship en-only
   again. The last five (settings, dashboard, myShop, nav, retention) came
   with the Stack-21 locale-parity-2 lane (Oct 21 2026): the top older
   namespaces by leaf count x surface traffic — settings + dashboard
   (every signed-in user's first surfaces), myShop (shop-owner flows),
   nav (global chrome) and retention (streak/bonus widgets) — existed
   only partially in the nine catalogs (retention in none of them), so
   non-English users silently fell back to English across all five.
   "wave8" came with the Stack-22 locale-parity-3 lane (Oct 22 2026):
   the ten wave-8 creator tools (adlib, captionStyler, calendar,
   highlights, hookRewriter, mediaKit, merchDrop, splits, sponsors,
   thumbnailAb) existed only in en.json — 294 leaves absent from all
   nine catalogs (2,646 values) — now translated ×9 and pinned here.
   Its calendar.dayNames leaf is the pinned set's first ARRAY value
   (components read it with returnObjects: true), so the emptiness and
   placeholder checks below judge array leaves by their elements.
   "wave9" came with the Stack-23 locale-parity-4 lane (Oct 22 2026):
   eight of its nine tool blocks (directEdit, structure, remix,
   timeline, beatSync, templates, bgReplace, characterDirector)
   existed only in en.json — 222 leaves absent from all nine catalogs
   (1,998 values) — now translated ×9 and pinned here; the ninth block
   (cameraMovePlanner) was already pinned via BLOCK_PREFIXES below
   and is subsumed by the whole-namespace pin.
   "podcast" came with the Stack-24 locale-parity-5 lane (Oct 22 2026):
   the Podcast Studio + Guest Questions + multi-speaker dialogue blocks
   (147 leaves) existed only partially in ar/de/es/fr (73 leaves, all of
   them untranslated English or stale copy; guestQuestions and dialogue
   absent) and not at all in hi/it/ja/ko/pt — all 147 are now translated
   ×9 and pinned here. The namespace carries no array leaves, so the
   plain string checks below judge it as-is.
   "outreach" came with the Stack-24 locale-parity-6 lane (Oct 22
   2026): the sponsorship outreach surface (pitch kit, sponsor read,
   invoice generator) existed in full only in en.json — ar/de/es/fr
   carried 49 of 127 leaves, every one of them byte-identical English,
   and hi/it/ja/ko/pt had none of it (947 missing + 196 residue values)
   — now translated ×9 and pinned here. The namespace has no array
   leaves, so the string checks below judge every leaf directly.
   "press-kit" came with the Stack-24 locale-parity-7 lane (Oct 22 2026):
   the Press Kit Builder + Press Release Generator blocks (129 leaves)
   existed only partially in ar/de/es/fr (70 leaves, every one of them
   untranslated English; the layout, tabs and pressRelease blocks absent)
   and not at all in hi/it/ja/ko/pt — all 129 are now translated ×9 and
   pinned here. The three count families (generateKit, refreshBio,
   pressRelease.generateRelease) keep their suffixed plural variants:
   Arabic carries the full six-form CLDR sets (the generateKit/refreshBio
   forms preserved verbatim from the plural-categories lane), and
   es/fr/it/pt carry the _many form alongside _one/_other. The namespace
   carries no array leaves, so the plain string checks below judge it
   as-is.
   "admin" came with the Stack-24 locale-parity-8 lane (Oct 22 2026):
   the owner-only admin console existed in full only in en.json — the
   spotlight/contact/dmca/reports/removal/users blocks (90 of its 189
   leaves) were absent from all nine catalogs, and 46 further values
   were byte-identical English residue (the rank names in de/fr/ja,
   "Global Bow Race" and "Cheat Code Jackpot" in de/fr, …) — now
   translated ×9 and pinned here. The namespace has no array leaves,
   so the string checks below judge every leaf directly; it is also
   the first pinned namespace whose placeholders include single-brace
   tokens ({email} in removal.removedBy, users.banConfirm and
   users.unbanConfirm), which the admin block at the bottom checks
   separately because the shared token check only sees {{...}}.
   "analyticsHub" came with the Stack-24 locale-parity-6 lane
   (Oct 22 2026): the Analytics Hub's newest blocks — 80 of its 148
   leaves (the competitor + milestones tab labels, the whole
   milestones tracker and competitor tracker blocks, tabConnected /
   tabChannelAudit / tabVirality, csvReadError) — existed in NO non-en
   catalog, so the Competitor and Milestones tabs silently fell back
   to English everywhere. All 148 leaves are now translated ×9 and
   pinned here, and the analyticsHub residue describe at the bottom
   pins the values too. The namespace carries no array leaves, so the
   plain string checks below judge it as-is.
   "contentIntelligence" came with the Stack-24 locale-parity lane
   (Oct 22 2026): the five-analyst guided flow (validate idea, hook lab,
   niche check, competitor gaps, calendar, plan) existed ONLY in
   en.json — all 146 leaves absent from all nine catalogs — so every
   non-English user got the whole surface in English. Now translated
   ×9 and pinned here; the namespace carries no array leaves, so the
   string emptiness/placeholder checks apply as-is.
   "hubSpine" came with the Stack-24 locale-parity lane (Oct 22 2026):
   the hub spine surface (attribution toggle, song-saved banner, the
   handoffs rail, Social Kit, Release Promo Cards — 131 leaves) existed
   in NO non-en catalog at all, so every non-English creator silently
   got English across the whole hub. All 131 leaves are now translated
   ×9 and pinned here, and the hubSpine residue describe at the bottom
   pins the values too. The namespace carries no array leaves, so the
   plain string checks below judge it as-is.
   "captionSuite" came with the Stack-24 locale-parity-7 lane
   (Oct 22 2026): the Caption Suite's whole guided flow (generate /
   style / translate, 110 leaves) existed in NO non-en catalog — the
   analytics lane's gap survey flagged it as a guard-external gap —
   so every non-English user silently got English for the entire
   surface. All 110 leaves are now translated ×9 and pinned here,
   and the captionSuite residue describe at the bottom pins the
   values too. The namespace carries no array leaves, so the plain
   string checks below judge it as-is.
   "world" came with the Stack-26 lock-cards lane (Oct 22 2026):
   the World's two lock cards (person lock 4415 / door lock 4416)
   plus the doorway-refusal notices are the first World chrome on
   the translation rails — the namespace was born in en only for
   the length of one lane, all 9 leaves now translated ×9 and
   pinned here. The namespace carries no array leaves, so the
   plain string checks below judge it as-is.
   "wallpapers" came with the Wallpapers, Screensavers & Themes lane
   (Oct 22 2026): the desk docked in Create + the Branding Kit
   (source / device renders / theme pack / screensaver — 93 leaves)
   was born translated ×10 in the same lane, so the namespace is
   pinned here from day one. Its only digit-bearing leaf is
   brandCleanNote (the clean-render price, 400 Visual Bucs, kept
   byte-identical in every catalog — the numeric-parity suite
   judges it a fact, not copy). The namespace carries no array
   leaves, so the plain string checks below judge it as-is.
   "appPage" came with the Stack-100 #3 app-page lane (Oct 24 2026):
   the public /app download home (Android APK / Chrome extension /
   iPhone-iPad / desktop web-app cards, install guides, the update
   story) was born translated ×10 in the same lane — all 46 leaves —
   so the namespace is pinned here from day one, together with the
   nav.getTheApp sidebar label. Its only digit-bearing leaf is
   checksumLabel ("SHA-256", byte-identical in every catalog — the
   numeric-parity suite judges it a fact, not copy); version/size ride
   in {{placeholders}} only. The namespace carries no array leaves,
   so the plain string checks below judge it as-is. */
const WHOLE_NAMESPACES = ["tutorials", "command", "djSets", "smartClips", "socialProof", "playlistPitch", "liveGuests", "moveHome", "catalogImport", "playlist", "paidSeries", "proFinishing", "videoExport", "outOfCredits", "showcasePublish", "share", "review", "videoEditor", "settings", "dashboard", "myShop", "nav", "retention", "wave8", "wave9", "podcast", "outreach", "press-kit", "admin", "analyticsHub", "contentIntelligence", "hubSpine", "captionSuite", "world", "wallpapers", "appPage"] as const;
/* Block prefixes inside older, larger namespaces. */
const BLOCK_PREFIXES = [
  "artistVault.identity",
  "beats.template",
  "myShop.discount",
] as const;
/* The wave-3 email block: tags + segments + campaign send + automations
   (migration-era keys under email-list, added after the base catalog). */
const EMAIL_LIST_BLOCK = [
  "tags", "add_tag", "tag_name_placeholder",
  "segments", "segment_name_placeholder", "create_segment",
  "manual_tags_all", "automatic_tags_all", "sources_any",
  "engagement_label", "eng_any", "eng_opened", "eng_clicked",
  "eng_engaged", "eng_none",
  "at_presave", "at_member", "at_buyer", "at_opened", "at_clicked",
  "at_engaged", "members_word", "segments_suppression_note",
  "send_a_campaign", "audience", "whole_list", "use_ai_draft",
  "send_campaign_btn", "campaign_history",
  "automations", "automations_intro", "automations_loading",
  "automation_on", "automation_off", "automation_off_note",
  "automation_save", "automation_saved", "automations_delay_label",
  "automations_last_checked", "automations_never_checked",
  "automations_sent_word", "automations_skipped_word",
  "automations_no_provider_word",
  "no_campaigns_yet", "delivered_word", "opens_word", "clicks_word",
  "opens_total", "clicks_total", "save_tags",
  "campaign_sent_msg", "campaign_failed_msg", "tag_subscribers_hint",
  /* Stack-29 One Fan Graph fill: the unified fan view's 20 keys,
     translated in all 10 catalogs the day the tab shipped. */
  "fan_graph", "fan_graph_intro", "fan_graph_search",
  "fan_graph_sort_recent", "fan_graph_sort_spent", "fan_graph_sort_name",
  "fan_graph_empty", "fan_graph_total_fans", "fan_graph_followers",
  "fan_graph_buyers", "fan_graph_follows_badge", "fan_graph_subscribed_badge",
  "fan_graph_unsubscribed_badge", "fan_graph_member_badge",
  "fan_graph_members_label", "fan_graph_spent_label", "fan_graph_last_active",
  "fan_graph_prev", "fan_graph_next", "fan_graph_error",
  /* Fan-graph phase 2 fill: the fan segments panel's 33 keys,
     translated in all 10 catalogs the day the panel shipped. */
  "fan_seg_title", "fan_seg_intro", "fan_seg_presets", "fan_seg_saved",
  "fan_seg_saved_unavailable", "fan_seg_empty_saved", "fan_seg_custom_title",
  "fan_seg_name_placeholder", "fan_seg_follows", "fan_seg_subscribed",
  "fan_seg_buyer", "fan_seg_member", "fan_seg_member_active",
  "fan_seg_member_any_member", "fan_seg_member_none", "fan_seg_min_spent",
  "fan_seg_min_purchases", "fan_seg_active_within", "fan_seg_has_email",
  "fan_seg_preview_btn", "fan_seg_save_btn", "fan_seg_send_title",
  "fan_seg_list_label", "fan_seg_send_btn", "fan_seg_sent_result",
  "fan_seg_send_failed", "fan_seg_count_fans", "fan_seg_preview_empty",
  "fan_seg_error", "fan_seg_any", "fan_seg_yes", "fan_seg_no", "fan_seg_delete",
] as const;
/* One-off newest-surface keys in older namespaces. */
const SINGLES = [
  "academy.tabTutorials",
  "stems.midi",
  "stems.midiTitle",
  "stems.errorMidi",
  "repurpose.modeSmart",
  "myProjects.failedOpenHubProject",
  "presave.tracklistTitle",
  "beats.customLicensesHeading",
  "beats.retry",
] as const;

function requiredKeys(): string[] {
  const keys = new Set<string>();
  for (const k of Object.keys(EN)) {
    if (WHOLE_NAMESPACES.some((ns) => k === ns || k.startsWith(`${ns}.`))) keys.add(k);
    if (BLOCK_PREFIXES.some((p) => k.startsWith(p))) keys.add(k);
  }
  for (const k of EMAIL_LIST_BLOCK) keys.add(`email-list.${k}`);
  for (const k of SINGLES) keys.add(k);
  return [...keys].sort();
}

const REQUIRED = requiredKeys();
const tokens = (s: string): string[] => [...s.matchAll(/\{\{[^}]+\}\}/g)].map((m) => m[0]).sort();
/* Array leaves (wave8.calendar.dayNames) flatten to the array itself;
   judge their placeholder shape by the joined element text. */
const leafText = (v: unknown): string =>
  Array.isArray(v) ? v.map((x) => String(x)).join("\n") : typeof v === "string" ? v : "";
const MAY_BE_EMPTY = new Set(["socialProof.headlinePrefix"]);

describe("wave-3/4 newest surfaces — full parity in all 10 catalogs", () => {
  it("the required set is the size the joined Stack-20 tree derives, plus the Stack-21 older-namespace fill, the Stack-22 wave8 fill, the Stack-23 wave9 fill, the Stack-23 plural split, the Stack-24 podcast fill, the Stack-24 outreach fill, the Stack-24 press-kit fill, the Stack-24 admin fill, the Stack-24 analyticsHub fill, the Stack-24 contentIntelligence fill, the Stack-24 hubSpine fill, the Stack-24 captionSuite fill, the Stack-26 world lock-cards fill, the Wallpapers & Themes desk fill, the King's Set starter-pack fill, the Stack-29 One Fan Graph fill, the Stack-29 podcast RSS publish fill, plus the Stack-100 #3 provenance fill, the Stack-100 #3 editor opening-hook fill and the Stack-100 #3 more-provenance aiUnknown key, plus the Stack-100 #3 appPage fill and the fan-graph phase 2 Fan Segments fill, plus the Stack-200 findability nav.contracts key, plus the Stack-200 signature-sounds settings.sounds fill (4462 keys)", () => {
    /* The plural split: Stack-23 lane 2 split the 12 {{plural}} keys in
       videoEditor/catalogImport/liveGuests/playlist into six CLDR
       plural-suffixed keys each (−12 base + 72 suffixed = +60). */
    /* Stack-100 #3 lane F7: +14 provenance keys — videoEditor.myLibrary
       (madeWith/madeBy/aiBadge/licence/saveLicence/licenceSaved/
       licenceSaveFailed/certificate/certificateFailed/history/
       disclosureNote), videoExport (aiDisclosure/aiDisclosureHint),
       wallpapers (aiDisclosure) — in all ten catalogs. Plus the editor
       lane's +2 opening-hook keys. Joined Stack-100 #3 total:
       4358 (fan graph + podcast RSS + provenance) + 2 = 4360.
       Plus wave-2 more-provenance: +1 aiUnknown key = 4361.
       Plus the app-page lane: +47 appPage keys = 4408.
       Plus the fan-segments lane: +33 fanSegments keys = 4441.
       Plus Stack-200 lane 1 (findability closure): +1 nav.contracts
       key — the back-office trio's sidebar door needed the label in
       all ten catalogs = 4442.
       Plus Stack-200 UPGRADES 183 (signature sounds): +20
       settings.sounds keys — the SOUNDS section's copy (master +
       per-kind switches, device-mute note, save/load states) in all
       ten catalogs = 4462. */
    expect(REQUIRED.length).toBe(4462);
  });

  it.each(ALL)("%s carries every newest-surface key", (locale) => {
    const cat = CATALOGS[locale]!;
    const missing = REQUIRED.filter((k) => !(k in cat));
    expect(missing, `${locale} is missing: ${missing.slice(0, 10).join(", ")}`).toEqual([]);
  });

  it.each(ALL)("%s values are non-empty (headlinePrefix word-order slot aside)", (locale) => {
    const cat = CATALOGS[locale]!;
    const empty = REQUIRED.filter((k) => {
      const v: unknown = cat[k];
      if (Array.isArray(v)) return v.length === 0 || v.some((x) => typeof x !== "string" || x.trim() === "");
      return typeof v !== "string" || (v.trim() === "" && !MAY_BE_EMPTY.has(k));
    });
    expect(empty, `${locale} has empty values: ${empty.slice(0, 10).join(", ")}`).toEqual([]);
  });

  it.each(ALL)("%s preserves the en placeholder shape on every key", (locale) => {
    const cat = CATALOGS[locale]!;
    const bad = REQUIRED.filter(
      (k) => k in cat && JSON.stringify(tokens(leafText(cat[k]))) !== JSON.stringify(tokens(leafText(EN[k]))),
    );
    expect(bad, `${locale} placeholder drift: ${bad.slice(0, 10).join(", ")}`).toEqual([]);
  });

  it("playlistPitch exists in the five catalogs that once had none of it (full 121-key set, incl. packetPresaveLabel)", () => {
    for (const locale of ["hi", "it", "ja", "ko", "pt"] as const) {
      const count = Object.keys(CATALOGS[locale]!).filter((k) => k.startsWith("playlistPitch.")).length;
      expect(count, `${locale} playlistPitch count`).toBe(121);
    }
  });
});

/* Legit-identical playlistPitch values per locale — keys whose correct
   value in that language IS the en string, so the residue check below
   must not flag them. Everything not listed here has to differ from en.
   - copyDmLabel "DM": the universal abbreviation for a direct message;
     it is also the ONLY en-identical value in hi/ja/ko.
   - de: "Genre" (packetGenre/statGenre) and "Links" (packetLinks) are
     spelled identically in German; "Artwork" (missingArtwork) is the
     German music-industry term this catalog keeps elsewhere; "Playlists"
     (tabPlaylists) is standard German (the catalog's own prose uses
     "Playlist-Name"); "Tracker" (tabTracker/tabTrackerCount) is an
     established anglicism in German app UI (the catalog also keeps
     Follower/Plays/Smartlink untranslated).
   - fr: "Description" (packetDescription) and "Genre" (packetGenre/
     statGenre) are spelled identically in French; "Playlists"
     (tabPlaylists) is standard French app usage (the catalog's own
     prose uses "la playlist").
   - it: "email" (copyEmailLabel) is the standard Italian word;
     "follow-up" (copyFollowUpLabel), "Tracker" (tabTracker/
     tabTrackerCount) and the "Playlist Pitcher" product badge
     (heroBadge) are established loanwords/kept-English in Italian.
   - pt: "follow-up" (copyFollowUpLabel), "pitches" (pitchesCount),
     "Links" (packetLinks), "Playlists" (tabPlaylists) are established
     loanwords in pt-BR music/business UI; the heroBadge product badge
     is kept in English. */
const RESIDUE_ALLOWLIST: Record<string, readonly string[]> = {
  ar: ["copyDmLabel"],
  de: [
    "copyDmLabel",
    "missingArtwork",
    "packetGenre",
    "statGenre",
    "packetLinks",
    "tabPlaylists",
    "tabTracker",
    "tabTrackerCount",
  ],
  es: ["copyDmLabel"],
  fr: ["copyDmLabel", "packetDescription", "packetGenre", "statGenre", "tabPlaylists"],
  hi: ["copyDmLabel"],
  it: ["copyDmLabel", "copyEmailLabel", "copyFollowUpLabel", "heroBadge", "tabTracker", "tabTrackerCount"],
  ja: ["copyDmLabel"],
  ko: ["copyDmLabel"],
  pt: ["copyDmLabel", "copyFollowUpLabel", "heroBadge", "packetLinks", "pitchesCount", "tabPlaylists"],
};

describe("playlistPitch — no untranslated English residue", () => {
  const NON_EN = ALL.filter((l) => l !== "en");
  const PP_KEYS = Object.keys(EN).filter((k) => k.startsWith("playlistPitch."));

  it.each(NON_EN)("%s playlistPitch values differ from en outside the allowlist", (locale) => {
    const cat = CATALOGS[locale]!;
    const allow = new Set((RESIDUE_ALLOWLIST[locale] ?? []).map((k) => `playlistPitch.${k}`));
    const residue = PP_KEYS.filter((k) => k in cat && cat[k] === EN[k] && !allow.has(k));
    expect(
      residue,
      `${locale} has untranslated playlistPitch values: ${residue.slice(0, 10).join(", ")}`,
    ).toEqual([]);
  });

  it("the residue allowlist names only keys still identical to en (no stale entries)", () => {
    for (const [locale, keys] of Object.entries(RESIDUE_ALLOWLIST)) {
      const cat = CATALOGS[locale]!;
      for (const k of keys) {
        const fk = `playlistPitch.${k}`;
        expect(cat[fk], `${locale} allowlist entry ${fk} no longer matches en — drop it`).toBe(EN[fk]);
      }
    }
  });
});

/* Legit-identical outreach values per locale — keys whose correct
   value in that language IS the en string, so the residue check below
   must not flag them. Everything not listed here has to differ from
   en. The seven shared entries are example/placeholder content, kept
   byte-identical in every catalog by the same convention the older
   namespaces already use (cf. auth.emailPlaceholder staying
   "you@example.com" in ar):
   - creatorNamePlaceholder "King Shark": the house character's name.
   - audiencePlaceholder "50K": the universal compact figure format.
   - brandNamePlaceholder "Wave Energy" and productPlaceholder
     "Wave Energy Drink": the fictional example brand/product names.
   - contactPlaceholder "Alex Rivera": the example contact name.
   - invoice.brandEmailPlaceholder "billing@brand.com" and
     invoice.creatorEmailPlaceholder "you@example.com": example
     e-mail addresses.
   Locale-specific entries:
   - de: "Engagement (optional)" — both words are spelled identically
     in German (Engagement is the standard marketing term and
     "(optional)" is German UI spelling); heroTitleAccent "Outreach"
     and sponsorReadHook "Hook" are established anglicisms in German
     marketing (the catalog keeps Follower/Plays/Tracker likewise).
   - es: invoice.total "Total" is the Spanish word, spelled
     identically; sponsorReadToneCasual "Casual" is the standard
     Spanish tone word.
   - fr: invoice.total "Total" and nicheLabel "Niche" are the French
     words, spelled identically.
   - it: heroTitleAccent "Outreach" is the established marketing
     loanword; sponsorReadCta "Call to action" is the standard term
     in Italian marketing, kept in English.
   - pt: invoice.total "Total" is the Portuguese word, spelled
     identically; sponsorReadToneCasual "Casual" is the standard
     pt-BR tone word. */
const OUTREACH_RESIDUE_ALLOWLIST: Record<string, readonly string[]> = {
  ar: [
    "audiencePlaceholder",
    "brandNamePlaceholder",
    "contactPlaceholder",
    "creatorNamePlaceholder",
    "invoice.brandEmailPlaceholder",
    "invoice.creatorEmailPlaceholder",
    "productPlaceholder",
  ],
  de: [
    "audiencePlaceholder",
    "brandNamePlaceholder",
    "contactPlaceholder",
    "creatorNamePlaceholder",
    "engagementLabel",
    "heroTitleAccent",
    "invoice.brandEmailPlaceholder",
    "invoice.creatorEmailPlaceholder",
    "productPlaceholder",
    "sponsorReadHook",
  ],
  es: [
    "audiencePlaceholder",
    "brandNamePlaceholder",
    "contactPlaceholder",
    "creatorNamePlaceholder",
    "invoice.brandEmailPlaceholder",
    "invoice.creatorEmailPlaceholder",
    "invoice.total",
    "productPlaceholder",
    "sponsorReadToneCasual",
  ],
  fr: [
    "audiencePlaceholder",
    "brandNamePlaceholder",
    "contactPlaceholder",
    "creatorNamePlaceholder",
    "invoice.brandEmailPlaceholder",
    "invoice.creatorEmailPlaceholder",
    "invoice.total",
    "nicheLabel",
    "productPlaceholder",
  ],
  hi: [
    "audiencePlaceholder",
    "brandNamePlaceholder",
    "contactPlaceholder",
    "creatorNamePlaceholder",
    "invoice.brandEmailPlaceholder",
    "invoice.creatorEmailPlaceholder",
    "productPlaceholder",
  ],
  it: [
    "audiencePlaceholder",
    "brandNamePlaceholder",
    "contactPlaceholder",
    "creatorNamePlaceholder",
    "heroTitleAccent",
    "invoice.brandEmailPlaceholder",
    "invoice.creatorEmailPlaceholder",
    "productPlaceholder",
    "sponsorReadCta",
  ],
  ja: [
    "audiencePlaceholder",
    "brandNamePlaceholder",
    "contactPlaceholder",
    "creatorNamePlaceholder",
    "invoice.brandEmailPlaceholder",
    "invoice.creatorEmailPlaceholder",
    "productPlaceholder",
  ],
  ko: [
    "audiencePlaceholder",
    "brandNamePlaceholder",
    "contactPlaceholder",
    "creatorNamePlaceholder",
    "invoice.brandEmailPlaceholder",
    "invoice.creatorEmailPlaceholder",
    "productPlaceholder",
  ],
  pt: [
    "audiencePlaceholder",
    "brandNamePlaceholder",
    "contactPlaceholder",
    "creatorNamePlaceholder",
    "invoice.brandEmailPlaceholder",
    "invoice.creatorEmailPlaceholder",
    "invoice.total",
    "productPlaceholder",
    "sponsorReadToneCasual",
  ],
};

describe("outreach — no untranslated English residue", () => {
  const NON_EN = ALL.filter((l) => l !== "en");
  const OUT_KEYS = Object.keys(EN).filter((k) => k.startsWith("outreach."));

  it.each(NON_EN)("%s outreach values differ from en outside the allowlist", (locale) => {
    const cat = CATALOGS[locale]!;
    const allow = new Set((OUTREACH_RESIDUE_ALLOWLIST[locale] ?? []).map((k) => `outreach.${k}`));
    const residue = OUT_KEYS.filter((k) => k in cat && cat[k] === EN[k] && !allow.has(k));
    expect(
      residue,
      `${locale} has untranslated outreach values: ${residue.slice(0, 10).join(", ")}`,
    ).toEqual([]);
  });

  it("the outreach residue allowlist names only keys still identical to en (no stale entries)", () => {
    for (const [locale, keys] of Object.entries(OUTREACH_RESIDUE_ALLOWLIST)) {
      const cat = CATALOGS[locale]!;
      for (const k of keys) {
        const fk = `outreach.${k}`;
        expect(cat[fk], `${locale} allowlist entry ${fk} no longer matches en — drop it`).toBe(EN[fk]);
      }
    }
  });
});

/* Legit-identical press-kit values per locale — keys whose correct value
   in that language IS the en string, so the residue check below must not
   flag them. Everything not listed here has to differ from en.
   Shared by all nine: pdf (the universal format abbreviation);
   placeholders.artistName "Thy Cheat Code" (the house artist's name —
   a proper-noun example); placeholders.bookingEmail and
   pressRelease.placeholders.contactEmail (example email addresses are
   not translated); placeholders.handle "shark-king" (a URL-slug
   example — slugs stay Latin); placeholders.url "https://…" (a URL
   stub) and pressRelease.placeholders.contactPhone "555-0100" (a
   fictional phone-number example).
   - de: "Genre" (form.genre), "Tagline" (form.tagline) and "Website"
     (form.website) are established anglicisms spelled identically in
     German; sections.bio "Bio", pressRelease.optional "optional",
     types.single "Single" and types.album "Album" are spelled
     identically in German; placeholders.location is the US place-name
     example, kept as written.
   - es: sections.bio "Bio" and placeholders.genre "Hip-hop" are spelled
     identically in Spanish; placeholders.location as for de.
   - fr: form.genre "Genre", sections.bio "Bio", sections.photos
     "Photos" and placeholders.source "Source…" are spelled identically
     in French; types.single "Single" and types.album "Album" are
     French music-industry usage; placeholders.genre/location as above.
   - it: form.tagline "Tagline" and tabs.kit "Press Kit" are established
     loanwords (cf. the playlistPitch it loanwords above); sections.bio
     "Bio", types.album "Album" and types.tour "Tour" are spelled
     identically in Italian; placeholders.genre/location as above.
   - pt: sections.bio "Bio" is spelled identically in Portuguese;
     types.single "Single" is the pt-BR music-industry loanword;
     placeholders.genre/location as above.
   - ko: form.socialUrl "{{platform}} URL" — Korean keeps the trailing
     Latin "URL" after the noun (cf. artistVault.imageUrlPlaceholder
     "이미지 URL (https://…)"). */
const PRESSKIT_RESIDUE_ALLOWLIST: Record<string, readonly string[]> = {
  ar: ["pdf", "placeholders.artistName", "placeholders.bookingEmail", "placeholders.handle", "placeholders.url", "pressRelease.placeholders.contactEmail", "pressRelease.placeholders.contactPhone"],
  de: [
    "pdf", "placeholders.artistName", "placeholders.bookingEmail", "placeholders.handle", "placeholders.url",
    "pressRelease.placeholders.contactEmail", "pressRelease.placeholders.contactPhone",
    "form.genre", "form.tagline", "form.website", "sections.bio", "placeholders.location",
    "pressRelease.optional", "pressRelease.types.single", "pressRelease.types.album",
  ],
  es: [
    "pdf", "placeholders.artistName", "placeholders.bookingEmail", "placeholders.handle", "placeholders.url",
    "pressRelease.placeholders.contactEmail", "pressRelease.placeholders.contactPhone",
    "sections.bio", "placeholders.genre", "placeholders.location",
  ],
  fr: [
    "pdf", "placeholders.artistName", "placeholders.bookingEmail", "placeholders.handle", "placeholders.url",
    "pressRelease.placeholders.contactEmail", "pressRelease.placeholders.contactPhone",
    "form.genre", "sections.bio", "sections.photos", "placeholders.genre", "placeholders.location",
    "placeholders.source", "pressRelease.types.single", "pressRelease.types.album",
  ],
  hi: ["pdf", "placeholders.artistName", "placeholders.bookingEmail", "placeholders.handle", "placeholders.url", "pressRelease.placeholders.contactEmail", "pressRelease.placeholders.contactPhone"],
  it: [
    "pdf", "placeholders.artistName", "placeholders.bookingEmail", "placeholders.handle", "placeholders.url",
    "pressRelease.placeholders.contactEmail", "pressRelease.placeholders.contactPhone",
    "form.tagline", "sections.bio", "tabs.kit", "placeholders.genre", "placeholders.location",
    "pressRelease.types.album", "pressRelease.types.tour",
  ],
  ja: ["pdf", "placeholders.artistName", "placeholders.bookingEmail", "placeholders.handle", "placeholders.url", "pressRelease.placeholders.contactEmail", "pressRelease.placeholders.contactPhone"],
  ko: [
    "pdf", "placeholders.artistName", "placeholders.bookingEmail", "placeholders.handle", "placeholders.url",
    "pressRelease.placeholders.contactEmail", "pressRelease.placeholders.contactPhone",
    "form.socialUrl",
  ],
  pt: [
    "pdf", "placeholders.artistName", "placeholders.bookingEmail", "placeholders.handle", "placeholders.url",
    "pressRelease.placeholders.contactEmail", "pressRelease.placeholders.contactPhone",
    "sections.bio", "placeholders.genre", "placeholders.location", "pressRelease.types.single",
  ],
};

describe("press-kit — no untranslated English residue", () => {
  const NON_EN = ALL.filter((l) => l !== "en");
  const PK_KEYS = Object.keys(EN).filter((k) => k.startsWith("press-kit."));

  it.each(NON_EN)("%s press-kit values differ from en outside the allowlist", (locale) => {
    const cat = CATALOGS[locale]!;
    const allow = new Set((PRESSKIT_RESIDUE_ALLOWLIST[locale] ?? []).map((k) => `press-kit.${k}`));
    const residue = PK_KEYS.filter((k) => k in cat && cat[k] === EN[k] && !allow.has(k));
    expect(
      residue,
      `${locale} has untranslated press-kit values: ${residue.slice(0, 10).join(", ")}`,
    ).toEqual([]);
  });

  it("the press-kit residue allowlist names only keys still identical to en (no stale entries)", () => {
    for (const [locale, keys] of Object.entries(PRESSKIT_RESIDUE_ALLOWLIST)) {
      const cat = CATALOGS[locale]!;
      for (const k of keys) {
        const fk = `press-kit.${k}`;
        expect(cat[fk], `${locale} press-kit allowlist entry ${fk} no longer matches en — drop it`).toBe(EN[fk]);
      }
    }
  });

  it("ar carries the full six-form CLDR sets for the three press-kit count families", () => {
    const cat = CATALOGS.ar!;
    for (const fam of ["press-kit.generateKit", "press-kit.refreshBio", "press-kit.pressRelease.generateRelease"]) {
      for (const form of ["zero", "one", "two", "few", "many", "other"]) {
        expect(typeof cat[`${fam}_${form}`], `ar missing ${fam}_${form}`).toBe("string");
      }
    }
  });

  it("es/fr/it/pt carry the _many form for the three press-kit count families", () => {
    for (const locale of ["es", "fr", "it", "pt"] as const) {
      const cat = CATALOGS[locale]!;
      for (const fam of ["press-kit.generateKit", "press-kit.refreshBio", "press-kit.pressRelease.generateRelease"]) {
        expect(typeof cat[`${fam}_many`], `${locale} missing ${fam}_many`).toBe("string");
      }
    }
  });
});

/* Legit-identical admin values per locale — keys whose correct value
   in that language IS the en string, so the residue check below must
   not flag them. Everything not listed here has to differ from en.
   Shared by all nine: users.credits "Visual Bucs" — the house
   currency brand; every catalog keeps it in Latin throughout this
   namespace (cf. currentBalance "{{balance}} Visual Bucs" in all ten
   catalogs).
   Example e-mail placeholders: friendEmailPlaceholder
   "friend@email.com", planEmailPlaceholder "user@email.com" and
   users.emailPlaceholder "customer@email.com" stay byte-identical in
   ar/hi/ja/ko/pt, the five catalogs that keep the en example
   addresses throughout this namespace (de/es/fr/it localize theirs —
   de "freund@email.com"/"nutzer@email.com"/"kunde@email.com" — by
   the same convention the outreach lane pinned for its example
   addresses).
   Locale-specific entries:
   - pageTitle "Admin" (de/es/fr/it/pt): the standard short form for
     the admin console in those UIs; all five catalogs keep it while
     translating everything around it, pageDescription included.
   - de jackpot.codeLabel "Code:": "Code" is the German word,
     spelled identically (fr writes "Code :" and differs).
   - de jackpot.eventsTitle "Events": an established anglicism in
     German event/marketing UI — the de catalog keeps such terms
     (cf. the playlistPitch Tracker/Playlists entries).
   - jackpot.phaseLive "LIVE" (de/it/ja) and removal.liveLabel
     "Live" (de/it): the universal on-air badge spelling.
   - tiers.tier3 "Gangster" (de/fr/it): the word is spelled
     identically in German, French and Italian.
   - removal.reasons.spam "Spam" (de/es/fr/it/pt): the standard
     moderation term, spelled identically in all five languages.
   - users.plan "Plan" (de/es): the word is spelled identically in
     German and Spanish.
   - it reports.target.post and removal.kindPost "Post": "Post" is
     the standard Italian term for a social post, spelled identically. */
const ADMIN_RESIDUE_ALLOWLIST: Record<string, readonly string[]> = {
  ar: ["friendEmailPlaceholder", "planEmailPlaceholder", "users.credits", "users.emailPlaceholder"],
  de: [
    "jackpot.codeLabel",
    "jackpot.eventsTitle",
    "jackpot.phaseLive",
    "pageTitle",
    "removal.liveLabel",
    "removal.reasons.spam",
    "tiers.tier3",
    "users.credits",
    "users.plan",
  ],
  es: ["pageTitle", "removal.reasons.spam", "users.credits", "users.plan"],
  fr: ["pageTitle", "removal.reasons.spam", "tiers.tier3", "users.credits"],
  hi: ["friendEmailPlaceholder", "planEmailPlaceholder", "users.credits", "users.emailPlaceholder"],
  it: [
    "jackpot.phaseLive",
    "pageTitle",
    "removal.kindPost",
    "removal.liveLabel",
    "removal.reasons.spam",
    "reports.target.post",
    "tiers.tier3",
    "users.credits",
  ],
  ja: [
    "friendEmailPlaceholder",
    "jackpot.phaseLive",
    "planEmailPlaceholder",
    "users.credits",
    "users.emailPlaceholder",
  ],
  ko: ["friendEmailPlaceholder", "planEmailPlaceholder", "users.credits", "users.emailPlaceholder"],
  pt: [
    "friendEmailPlaceholder",
    "pageTitle",
    "planEmailPlaceholder",
    "removal.reasons.spam",
    "users.credits",
    "users.emailPlaceholder",
  ],
};

describe("admin — full parity, no untranslated English residue, single-brace tokens intact", () => {
  const NON_EN = ALL.filter((l) => l !== "en");
  const ADMIN_KEYS = Object.keys(EN).filter((k) => k.startsWith("admin."));
  const singleTokens = (s: string): string[] =>
    [...s.replace(/\{\{[^}]+\}\}/g, "").matchAll(/\{[^{}]+\}/g)].map((m) => m[0]).sort();

  it("the admin namespace is 189 leaves in en and every catalog carries all of them", () => {
    expect(ADMIN_KEYS.length).toBe(189);
    for (const locale of ALL) {
      const count = Object.keys(CATALOGS[locale]!).filter((k) => k.startsWith("admin.")).length;
      expect(count, `${locale} admin leaf count`).toBe(189);
    }
  });

  it.each(NON_EN)("%s preserves the single-brace placeholder shape on every admin key", (locale) => {
    const cat = CATALOGS[locale]!;
    const bad = ADMIN_KEYS.filter(
      (k) => k in cat && JSON.stringify(singleTokens(cat[k]!)) !== JSON.stringify(singleTokens(EN[k]!)),
    );
    expect(bad, `${locale} single-brace placeholder drift: ${bad.slice(0, 10).join(", ")}`).toEqual([]);
  });

  it.each(NON_EN)("%s admin values differ from en outside the allowlist", (locale) => {
    const cat = CATALOGS[locale]!;
    const allow = new Set((ADMIN_RESIDUE_ALLOWLIST[locale] ?? []).map((k) => `admin.${k}`));
    const residue = ADMIN_KEYS.filter((k) => k in cat && cat[k] === EN[k] && !allow.has(k));
    expect(
      residue,
      `${locale} has untranslated admin values: ${residue.slice(0, 10).join(", ")}`,
    ).toEqual([]);
  });

  it("the admin residue allowlist names only keys still identical to en (no stale entries)", () => {
    for (const [locale, keys] of Object.entries(ADMIN_RESIDUE_ALLOWLIST)) {
      const cat = CATALOGS[locale]!;
      for (const k of keys) {
        const fk = `admin.${k}`;
        expect(cat[fk], `${locale} allowlist entry ${fk} no longer matches en — drop it`).toBe(EN[fk]);
      }
    }
  });
});

/* Legit-identical analyticsHub values per locale — keys whose correct
   value in that language IS the en string, so the residue check below
   must not flag them. Everything not listed here has to differ from en.
   - milestones.loggedFrom (all nine): the en value IS the bare
     {{source}} placeholder — the rendered text is the source value
     itself (manual entry / an import label), so there is literally
     nothing to translate.
   - hookStudio (ar/de/hi/it/ja/ko): the Hook Studio product-surface
     name, kept in its Latin form in these catalogs — the same
     kept-name pattern as the playlistPitch "Playlist Pitcher" badge
     (es/pt render it descriptively instead: "Estudio de Hooks" /
     "Estúdio de Ganchos").
   - heroTitle (de/it/ja): the surface's product name "Analytics Hub";
     the de/it/ja pageTitle values keep it in Latin too and translate
     only the descriptive tail ("Analytics Hub — …").
   - tabDashboard (de/it): these catalogs' own nav.dashboard is
     "Dashboard" — the global chrome keeps the word, so the tab does.
   - fields.engagementRate + statEngagement (de/fr/it): "Engagement" is
     the established marketing term in all three languages — the word
     the platforms' own interfaces use for this metric. (fr carried the
     MT error "Fiançailles" until the Stack-24 fr-corrections lane
     replaced it with the same established term.)
   - trendLabel (de/it): "Trend" is spelled identically in German and
     is an established, identically-spelled loanword in Italian.
   - focus (it): the "Focus:" label is the established loanword
     heading in Italian business UI — same kept-loan family as
     Engagement/Trend in this catalog.
   - fr tabIntelligence "Intelligence" and competitor.notesLabel
     "Notes": spelled identically in French (the same class as fr
     playlistPitch's "Description" / "Genre"). */
const AH_RESIDUE_ALLOWLIST: Record<string, readonly string[]> = {
  ar: ["hookStudio", "milestones.loggedFrom"],
  de: [
    "fields.engagementRate",
    "heroTitle",
    "statEngagement",
    "trendLabel",
    "hookStudio",
    "tabDashboard",
    "milestones.loggedFrom",
  ],
  es: ["milestones.loggedFrom"],
  fr: [
    "fields.engagementRate",
    "statEngagement",
    "tabIntelligence",
    "competitor.notesLabel",
    "milestones.loggedFrom",
  ],
  hi: ["hookStudio", "milestones.loggedFrom"],
  it: [
    "fields.engagementRate",
    "heroTitle",
    "statEngagement",
    "trendLabel",
    "focus",
    "hookStudio",
    "tabDashboard",
    "milestones.loggedFrom",
  ],
  ja: ["hookStudio", "milestones.loggedFrom"],
  ko: ["hookStudio", "milestones.loggedFrom"],
  pt: ["milestones.loggedFrom"],
};

describe("analyticsHub — no untranslated English residue", () => {
  const NON_EN = ALL.filter((l) => l !== "en");
  const AH_KEYS = Object.keys(EN).filter((k) => k.startsWith("analyticsHub."));

  it.each(NON_EN)("%s analyticsHub values differ from en outside the allowlist", (locale) => {
    const cat = CATALOGS[locale]!;
    const allow = new Set((AH_RESIDUE_ALLOWLIST[locale] ?? []).map((k) => `analyticsHub.${k}`));
    const residue = AH_KEYS.filter((k) => k in cat && cat[k] === EN[k] && !allow.has(k));
    expect(
      residue,
      `${locale} has untranslated analyticsHub values: ${residue.slice(0, 10).join(", ")}`,
    ).toEqual([]);
  });

  it("the analyticsHub allowlist names only keys still identical to en (no stale entries)", () => {
    for (const [locale, keys] of Object.entries(AH_RESIDUE_ALLOWLIST)) {
      const cat = CATALOGS[locale]!;
      for (const k of keys) {
        const fk = `analyticsHub.${k}`;
        expect(cat[fk], `${locale} allowlist entry ${fk} no longer matches en — drop it`).toBe(EN[fk]);
      }
    }
  });
});

/* Legit-identical contentIntelligence values per locale — keys whose
   correct value in that language IS the en string (Stack-24 lane,
   Oct 22 2026). Everything not listed here has to differ from en.
   Shared by all nine:
   - platformTikTok / platformInstagram / platformYouTube / platformX:
     the platform brand names — functional destination names, spelled
     identically in every language.
   - compUrlPlaceholder "https://…": a URL placeholder literal, not
     prose; there is nothing to translate.
   - calendarFrom "{{from}} → {{to}}": a pure template of two
     placeholders and an arrow — no words at all.
   Per locale:
   - de: heroBadge "Content Intelligence" is the product feature name,
     kept in English in this catalog like its other feature badges;
     nav6 "Plan" and alternative "Alternative" are spelled identically
     in German (true cognates).
   - es: nav6 "Plan" is spelled identically in Spanish.
   - fr: nav6 "Plan", verdictLabel "Verdict" and alternative
     "Alternative" are spelled identically in French. */
const CI_PLATFORM_KEYS = [
  "platformTikTok",
  "platformInstagram",
  "platformYouTube",
  "platformX",
  "compUrlPlaceholder",
  "calendarFrom",
] as const;
const CI_RESIDUE_ALLOWLIST: Record<string, readonly string[]> = {
  ar: [...CI_PLATFORM_KEYS],
  de: [...CI_PLATFORM_KEYS, "heroBadge", "nav6", "alternative"],
  es: [...CI_PLATFORM_KEYS, "nav6"],
  fr: [...CI_PLATFORM_KEYS, "nav6", "verdictLabel", "alternative"],
  hi: [...CI_PLATFORM_KEYS],
  it: [...CI_PLATFORM_KEYS],
  ja: [...CI_PLATFORM_KEYS],
  ko: [...CI_PLATFORM_KEYS],
  pt: [...CI_PLATFORM_KEYS],
};

describe("contentIntelligence — no untranslated English residue", () => {
  const NON_EN = ALL.filter((l) => l !== "en");
  const CI_KEYS = Object.keys(EN).filter((k) => k.startsWith("contentIntelligence."));

  it("the namespace derives the full 146-key set from en", () => {
    expect(CI_KEYS.length).toBe(146);
  });

  it.each(NON_EN)("%s contentIntelligence values differ from en outside the allowlist", (locale) => {
    const cat = CATALOGS[locale]!;
    const allow = new Set((CI_RESIDUE_ALLOWLIST[locale] ?? []).map((k) => `contentIntelligence.${k}`));
    const residue = CI_KEYS.filter((k) => k in cat && cat[k] === EN[k] && !allow.has(k));
    expect(
      residue,
      `${locale} has untranslated contentIntelligence values: ${residue.slice(0, 10).join(", ")}`,
    ).toEqual([]);
  });

  it("the residue allowlist names only keys still identical to en (no stale entries)", () => {
    for (const [locale, keys] of Object.entries(CI_RESIDUE_ALLOWLIST)) {
      const cat = CATALOGS[locale]!;
      for (const k of keys) {
        const fk = `contentIntelligence.${k}`;
        expect(cat[fk], `${locale} allowlist entry ${fk} no longer matches en — drop it`).toBe(EN[fk]);
      }
    }
  });
});
/* Legit-identical hubSpine values per locale — keys whose correct
   value in that language IS the en string, so the residue check below
   must not flag them. Everything not listed here has to differ from en.
   - madeWith + attributionTitle (all nine): the en value IS the brand
     attribution lockup "Made with Bow Down Visuals" — the literal text
     stamped on exports in every market (promoCards.attributionLabel
     quotes it verbatim inside translated prose), so there is nothing
     to translate.
   - handoffs.resultLabel "{{tool}} · {{source}}" and
     promoCards.historyForRelease "{{title}} — {{artist}}" (all nine):
     the values are placeholders joined by a separator only — the same
     nothing-to-translate class as analyticsHub's milestones.loggedFrom.
   - promoCards.sizeHint.16x9 "YouTube" (all nine): the platform name.
   - handoffs.meme.label "Meme" (de/es/fr/it/pt): the established,
     identically-spelled loanword in all five languages.
   - fr clipDescription.resultLabel "Description · {{topic}}":
     "Description" is spelled identically in French (the same class as
     fr playlistPitch's packetDescription); the rest is placeholders.
   - fr promoCards.priceBadge: "pack" is the established French
     commerce loanword for a bundle of cards (the same kept-loan class
     as fr playlistPitch's "Playlists"). */
const HS_RESIDUE_ALLOWLIST: Record<string, readonly string[]> = {
  ar: [
    "madeWith",
    "attributionTitle",
    "handoffs.resultLabel",
    "promoCards.historyForRelease",
    "promoCards.sizeHint.16x9",
  ],
  de: [
    "madeWith",
    "attributionTitle",
    "handoffs.resultLabel",
    "handoffs.meme.label",
    "promoCards.historyForRelease",
    "promoCards.sizeHint.16x9",
  ],
  es: [
    "madeWith",
    "attributionTitle",
    "handoffs.resultLabel",
    "handoffs.meme.label",
    "promoCards.historyForRelease",
    "promoCards.sizeHint.16x9",
  ],
  fr: [
    "madeWith",
    "attributionTitle",
    "handoffs.resultLabel",
    "handoffs.meme.label",
    "clipDescription.resultLabel",
    "promoCards.historyForRelease",
    "promoCards.priceBadge",
    "promoCards.sizeHint.16x9",
  ],
  hi: [
    "madeWith",
    "attributionTitle",
    "handoffs.resultLabel",
    "promoCards.historyForRelease",
    "promoCards.sizeHint.16x9",
  ],
  it: [
    "madeWith",
    "attributionTitle",
    "handoffs.resultLabel",
    "handoffs.meme.label",
    "promoCards.historyForRelease",
    "promoCards.sizeHint.16x9",
  ],
  ja: [
    "madeWith",
    "attributionTitle",
    "handoffs.resultLabel",
    "promoCards.historyForRelease",
    "promoCards.sizeHint.16x9",
  ],
  ko: [
    "madeWith",
    "attributionTitle",
    "handoffs.resultLabel",
    "promoCards.historyForRelease",
    "promoCards.sizeHint.16x9",
  ],
  pt: [
    "madeWith",
    "attributionTitle",
    "handoffs.resultLabel",
    "handoffs.meme.label",
    "promoCards.historyForRelease",
    "promoCards.sizeHint.16x9",
  ],
};

describe("hubSpine — no untranslated English residue", () => {
  const NON_EN = ALL.filter((l) => l !== "en");
  const HS_KEYS = Object.keys(EN).filter((k) => k.startsWith("hubSpine."));

  it.each(NON_EN)("%s hubSpine values differ from en outside the allowlist", (locale) => {
    const cat = CATALOGS[locale]!;
    const allow = new Set((HS_RESIDUE_ALLOWLIST[locale] ?? []).map((k) => `hubSpine.${k}`));
    const residue = HS_KEYS.filter((k) => k in cat && cat[k] === EN[k] && !allow.has(k));
    expect(
      residue,
      `${locale} has untranslated hubSpine values: ${residue.slice(0, 10).join(", ")}`,
    ).toEqual([]);
  });

  it("the hubSpine allowlist names only keys still identical to en (no stale entries)", () => {
    for (const [locale, keys] of Object.entries(HS_RESIDUE_ALLOWLIST)) {
      const cat = CATALOGS[locale]!;
      for (const k of keys) {
        const fk = `hubSpine.${k}`;
        expect(cat[fk], `${locale} allowlist entry ${fk} no longer matches en — drop it`).toBe(EN[fk]);
      }
    }
  });
});
/* Legit-identical captionSuite values per locale — keys whose correct
   value in that language IS the en string, so the residue check below
   must not flag them. Everything not listed here has to differ from en.
   - credits / generateCost / burnModeHint (all nine): the strings are
     the currency's brand name alone ("Visual Bucs" — common.visualBucs
     carries the identical string in every catalog), a bare number plus
     that name ("300 Visual Bucs"), and a bare placeholder plus that
     name ("{{cost}} Visual Bucs") — there is nothing else to translate.
   - endCardText (all nine): the literal branded outro line that gets
     burned into videos; every locale's endCardDesc quotes it verbatim
     in English, so the rendered line stays the brand line everywhere.
   - share_facebook / share_whatsapp / share_telegram (all nine): the
     platforms' proper names — functional destination names stay.
   - positionLabel (de/fr): "Position" is spelled identically in
     German and in French.
   - stepStyle (fr): "Style" is the French noun, spelled identically
     (the same class as fr playlistPitch's "Description" / "Genre").
   - brandBadge (it): "Brand" is the established Italian marketing
     term — the same kept-loan family as it playlistPitch's
     "follow-up" and analyticsHub's "Focus". */
const CS_RESIDUE_ALLOWLIST: Record<string, readonly string[]> = {
  ar: ["credits", "generateCost", "burnModeHint", "endCardText", "share_facebook", "share_whatsapp", "share_telegram"],
  de: ["credits", "generateCost", "burnModeHint", "endCardText", "share_facebook", "share_whatsapp", "share_telegram", "positionLabel"],
  es: ["credits", "generateCost", "burnModeHint", "endCardText", "share_facebook", "share_whatsapp", "share_telegram"],
  fr: ["credits", "generateCost", "burnModeHint", "endCardText", "share_facebook", "share_whatsapp", "share_telegram", "positionLabel", "stepStyle"],
  hi: ["credits", "generateCost", "burnModeHint", "endCardText", "share_facebook", "share_whatsapp", "share_telegram"],
  it: ["credits", "generateCost", "burnModeHint", "endCardText", "share_facebook", "share_whatsapp", "share_telegram", "brandBadge"],
  ja: ["credits", "generateCost", "burnModeHint", "endCardText", "share_facebook", "share_whatsapp", "share_telegram"],
  ko: ["credits", "generateCost", "burnModeHint", "endCardText", "share_facebook", "share_whatsapp", "share_telegram"],
  pt: ["credits", "generateCost", "burnModeHint", "endCardText", "share_facebook", "share_whatsapp", "share_telegram"],
};

describe("captionSuite — no untranslated English residue", () => {
  const NON_EN = ALL.filter((l) => l !== "en");
  const CS_KEYS = Object.keys(EN).filter((k) => k.startsWith("captionSuite."));

  it.each(NON_EN)("%s captionSuite values differ from en outside the allowlist", (locale) => {
    const cat = CATALOGS[locale]!;
    const allow = new Set((CS_RESIDUE_ALLOWLIST[locale] ?? []).map((k) => `captionSuite.${k}`));
    const residue = CS_KEYS.filter((k) => k in cat && cat[k] === EN[k] && !allow.has(k));
    expect(
      residue,
      `${locale} has untranslated captionSuite values: ${residue.slice(0, 10).join(", ")}`,
    ).toEqual([]);
  });

  it("the captionSuite allowlist names only keys still identical to en (no stale entries)", () => {
    for (const [locale, keys] of Object.entries(CS_RESIDUE_ALLOWLIST)) {
      const cat = CATALOGS[locale]!;
      for (const k of keys) {
        const fk = `captionSuite.${k}`;
        expect(cat[fk], `${locale} allowlist entry ${fk} no longer matches en — drop it`).toBe(EN[fk]);
      }
    }
  });
});
