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
   separately because the shared token check only sees {{...}}. */
const WHOLE_NAMESPACES = ["tutorials", "command", "djSets", "smartClips", "socialProof", "playlistPitch", "liveGuests", "moveHome", "catalogImport", "playlist", "paidSeries", "proFinishing", "videoExport", "outOfCredits", "showcasePublish", "share", "review", "videoEditor", "settings", "dashboard", "myShop", "nav", "retention", "admin"] as const;
/* Block prefixes inside older, larger namespaces. */
const BLOCK_PREFIXES = [
  "wave9.cameraMovePlanner.",
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
const MAY_BE_EMPTY = new Set(["socialProof.headlinePrefix"]);

describe("wave-3/4 newest surfaces — full parity in all 10 catalogs", () => {
  it("the required set is the size the joined Stack-20 tree derives, plus the Stack-21 older-namespace fill and the Stack-24 admin fill (2658 keys)", () => {
    expect(REQUIRED.length).toBe(2658);
  });

  it.each(ALL)("%s carries every newest-surface key", (locale) => {
    const cat = CATALOGS[locale]!;
    const missing = REQUIRED.filter((k) => !(k in cat));
    expect(missing, `${locale} is missing: ${missing.slice(0, 10).join(", ")}`).toEqual([]);
  });

  it.each(ALL)("%s values are non-empty (headlinePrefix word-order slot aside)", (locale) => {
    const cat = CATALOGS[locale]!;
    const empty = REQUIRED.filter(
      (k) => typeof cat[k] !== "string" || (cat[k]!.trim() === "" && !MAY_BE_EMPTY.has(k)),
    );
    expect(empty, `${locale} has empty values: ${empty.slice(0, 10).join(", ")}`).toEqual([]);
  });

  it.each(ALL)("%s preserves the en placeholder shape on every key", (locale) => {
    const cat = CATALOGS[locale]!;
    const bad = REQUIRED.filter(
      (k) => k in cat && JSON.stringify(tokens(cat[k]!)) !== JSON.stringify(tokens(EN[k]!)),
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
