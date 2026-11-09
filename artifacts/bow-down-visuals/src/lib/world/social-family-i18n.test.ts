/**
 * Social-family i18n pins (stack100 locale unit 43, manifest item 43).
 *
 * The World's Social desk family — SocialDesk (PostOfficeDesk +
 * CommunityHallBoard), SocialWave2 (ExploreDesk, ModerationBench,
 * MyProfileDesk), SocialProofDesk, GroupsDesk, CollabsDesk,
 * EventsDesk, WinnersCirclePanel, and PostAssist (the Hall
 * composer's assist block, also docked in the Promote Room's
 * BusinessDesks) — rendered hard-coded English inside a 10-locale
 * product. Their own copy now lives in the locale catalogs under
 * worldSocialDesk.*, extracted key-for-key (the en values are the
 * desks' original wording, verbatim). These pins hold:
 *
 *  - extraction: every family component renders through
 *    useTranslation, and every catalog key in the namespace is
 *    actually referenced by the components (no orphan keys, no
 *    unextracted remainder in the namespace);
 *  - parity: all 10 locales carry the full extracted key set,
 *    values non-empty, with identical interpolation-token sets
 *    per key;
 *  - the MONEY LAW: every line that states a specific price, fee
 *    or Bucs amount (enumerated in MONEY_KEYS below — the collab
 *    match price + credit lines, the Post Assist price, the Hall
 *    scan prices, the reply-bench cost suffix + batch cost line,
 *    and the winners' no-Bucs honesty line) carries the English
 *    source VERBATIM in every catalog. Money copy is never
 *    agent-drafted; figures reach the line by interpolation;
 *  - platform names: social platform names are proper names —
 *    they ride rail records (COLLAB_PLATFORM_OPTIONS, the proof
 *    desk's platform rows) and render verbatim in every language;
 *    no platform name is ever routed through the catalog;
 *  - formatting: numbers/dates in the family format with
 *    i18n.language — no hard-coded "en-US", no bare toLocale*()
 *    calls in the components.
 *
 * Seams: threadToggleLabel (social-desk), eventWhenLabel
 * (events-desk) and the contests copy bundle (contestDeadlineLine,
 * contestErrorCopy, hostContest/enterContestWork/
 * nameContestWinners) take OPTIONAL string bundles whose defaults
 * are the English lines verbatim, so an unbundled call renders
 * exactly as before; the desks pass their catalog strings in.
 * Label tables the seams own (dmWorkLabel, collabNicheLabel,
 * removalReasonLabel, contestPhaseLabel, requestStatusLabel,
 * event kind labels) stay the fallback — the desks map known
 * tokens to catalog keys and fall back to the seam word.
 *
 * Anti-drift reuse (NOT re-keyed into this namespace): strings
 * the desks share verbatim with the same feature's 2D surface
 * ride that surface's existing catalog keys — the proof desk's
 * refresh/retry words ride social-proof.* (refreshing, retry);
 * the events card title rides nav.events; the winners panel's
 * close rides common.close; the collabs desk's request verbs,
 * bio label, followers placeholder, anonymous-creator fallback,
 * copied confirmation and display-name field ride collabs.*
 * (accept, decline, bioLabel, followersPlaceholder,
 * anonymousCreator, copied) and the desk's own
 * worldSocialDesk.collabsDisplayNameField.
 *
 * Deliberately NOT extracted (documented in the unit report):
 * rail-provided copy rendered verbatim (post why-labels, drop
 * why-labels, card nicheLabel/lockedReason, contest server
 * messages, profile block definitions, theme colorway/font
 * names, sentiment themes); enum/rail tokens themselves
 * (viewer_role, report statuses, removal-reason tokens, work
 * kinds); overrideFeature rail labels (COLLAB_MATCH_FEATURE);
 * platform proper names; filed member-data fallbacks the seams
 * own ("Creator"/"Untitled work"/"Contest" normalizer defaults —
 * the desks' OWN "Creator" fallback IS extracted as
 * hallCreatorFallback); the shared guest-honest pitch strings
 * (World chrome owned by no single unit); the shared
 * social-proof-display formatProofValue seam's en-US formatting
 * (shared lib, join follow-on candidate).
 *
 * TRANSLATION STATUS: en is final. The other nine catalogs' values
 * are AGENT-DRAFTED and UNREVIEWED (standing stack600 practice);
 * the MONEY_KEYS values are exempt from drafting by the money
 * law — they are the English source in every catalog.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) =>
  readFileSync(new URL(rel, import.meta.url), "utf8");
const readJson = (rel: string) => JSON.parse(read(rel)) as Record<string, any>;

const LOCALES = ["en", "ar", "de", "es", "fr", "hi", "it", "ja", "ko", "pt"];
const NS = "worldSocialDesk";

const COMPONENTS: Record<string, string> = {
  SocialDesk: read("../../components/world/native/SocialDesk.tsx"),
  SocialWave2: read("../../components/world/native/SocialWave2.tsx"),
  SocialProofDesk: read("../../components/world/native/SocialProofDesk.tsx"),
  GroupsDesk: read("../../components/world/native/GroupsDesk.tsx"),
  CollabsDesk: read("../../components/world/native/CollabsDesk.tsx"),
  EventsDesk: read("../../components/world/native/EventsDesk.tsx"),
  WinnersCirclePanel: read("../../components/world/native/WinnersCirclePanel.tsx"),
  PostAssist: read("../../components/world/native/PostAssist.tsx"),
};
const SEAMS: Record<string, string> = {
  socialDesk: read("./social-desk.ts"),
  eventsDesk: read("./events-desk.ts"),
  contests: read("./contests.ts"),
};
const ALL_SOURCES = { ...COMPONENTS, ...SEAMS };
const JOINED = Object.values(COMPONENTS).join("\n");

const en = readJson("../../locales/en.json");
const enNs = (en[NS] ?? {}) as Record<string, string>;
const enKeys = Object.keys(enNs).sort();
const CATALOGS: Record<string, Record<string, string>> = {};
for (const loc of LOCALES) {
  CATALOGS[loc] = (readJson(`../../locales/${loc}.json`)[NS] ?? {}) as Record<string, string>;
}

const MONEY_KEYS = [
  "assistButton",
  "collabsCreditsLine",
  "collabsMatchButton",
  "collabsOutOfCredits",
  "hallBenchCostPart",
  "hallBenchCostSuffix",
  "hallScanSentiment",
  "hallScanSuperfans",
  "winnersJudgingIntro",
];

const tokensOf = (value: string): string[] =>
  [...value.matchAll(/\{\{\s*[^{}]+\s*\}\}/g)].map((m) => m[0].replace(/\s+/g, "")).sort();

const digitsOf = (value: string): string[] => value.match(/\d+/g) ?? [];

describe("Social-family extraction (unit 43)", () => {
  it("every family component renders through useTranslation", () => {
    for (const [name, src] of Object.entries(COMPONENTS)) {
      expect(src, name).toContain('import { useTranslation } from "react-i18next"');
      expect(src, name).toContain("useTranslation()");
    }
  });

  it("the namespace holds the family's full extracted key set", () => {
    /* 648 + assistReplayNote (Stack400 C-36: the Post Assist replay
       helper line, keyed in all 10 catalogs). */
    expect(enKeys.length).toBe(649);
  });

  it("every catalog key is referenced by a component (no orphans, no remainder)", () => {
    const referenced = new Set<string>();
    for (const m of JOINED.matchAll(/worldSocialDesk\.([A-Za-z0-9_]+)/g)) {
      referenced.add(m[1]!);
    }
    expect([...referenced].sort()).toEqual(enKeys);
  });

  it("seam bundles are optional with byte-identical English defaults", () => {
    expect(SEAMS.socialDesk).toContain('replies: "Replies"');
    expect(SEAMS.socialDesk).toContain("THREAD_TOGGLE_EN");
    expect(SEAMS.eventsDesk).toContain("eventWhenLabel(startsAt: string, locale?: string)");
    expect(SEAMS.contests).toContain("FALLBACK_COPY");
  });

  it("numbers and dates format in the walker's language — never hard-coded en-US, never bare", () => {
    for (const [name, src] of Object.entries(COMPONENTS)) {
      expect(src, name).not.toContain('"en-US"');
      expect(src, name).not.toContain(".toLocaleDateString()");
      expect(src, name).not.toContain(".toLocaleString()");
      expect(src, name).not.toContain(".toLocaleDateString(undefined");
      expect(src, name).not.toContain(".toLocaleString(undefined");
    }
    expect(COMPONENTS.SocialWave2).toContain("toLocaleString(i18n.language)");
    expect(COMPONENTS.SocialDesk).toContain("toLocaleDateString(i18n.language");
    expect(COMPONENTS.WinnersCirclePanel).toContain("Intl.DateTimeFormat(i18n.language");
  });

  it("platform names stay literal — rail records render verbatim, never through the catalog", () => {
    expect(COMPONENTS.CollabsDesk).toContain("COLLAB_PLATFORM_OPTIONS");
    for (const key of enKeys) {
      for (const name of ["YouTube", "TikTok", "Instagram", "Twitch", "Spotify"]) {
        expect(enNs[key], key).not.toContain(name);
      }
    }
  });

  it("the desks reuse the 2D surfaces' own catalog keys where the words are shared (anti-drift)", () => {
    expect(COMPONENTS.SocialProofDesk).toContain('t("social-proof.refreshing")');
    expect(COMPONENTS.SocialProofDesk).toContain('t("social-proof.retry")');
    expect(COMPONENTS.EventsDesk).toContain('t("nav.events")');
    expect(COMPONENTS.WinnersCirclePanel).toContain('t("common.close")');
    expect(COMPONENTS.CollabsDesk).toContain('t("collabs.accept")');
    expect(COMPONENTS.CollabsDesk).toContain('t("collabs.anonymousCreator")');
    expect(COMPONENTS.SocialDesk).toContain('t("collabs.accept")');
    expect(COMPONENTS.SocialDesk).toContain('t("collabs.decline")');
    expect(COMPONENTS.SocialWave2).toContain('t("collabs.bioLabel")');
    expect(COMPONENTS.SocialWave2).toContain('t("collabs.copied")');
  });

  it("en copy is the desks' original wording, verbatim (representative pins)", () => {
    expect(enNs.hallScanSuperfans).toBe("Superfan radar · 100 VB");
    expect(enNs.collabsMatchButton).toBe("Match us — {{cost}} Bucs");
    expect(enNs.assistButton).toBe("Write it for me · {{cost}} VB");
    expect(enNs.dmSearchScopeLine).toBe(
      "{{visible}} of {{total}} loaded messages match — search covers the latest 50 messages in this thread.",
    );
    expect(enNs.hallThreadHide).toBe("Hide {{count}} {{noun}}");
    expect(enNs.hallBenchCostPart).toBe(" — one batch costs {{cost}} VB, charged when you draft");
    expect(enNs.winnersJudgingIntro).toContain("no Visual Bucs move.");
  });
});

describe("Social-family catalog parity (unit 43)", () => {
  it("all 10 locales carry exactly the extracted key set", () => {
    for (const loc of LOCALES) {
      expect(Object.keys(CATALOGS[loc]!).sort(), loc).toEqual(enKeys);
    }
  });

  it("no locale's value is empty or an untranslated copy of the key name", () => {
    for (const loc of LOCALES) {
      for (const key of enKeys) {
        const value = CATALOGS[loc]![key];
        expect(typeof value, `${loc}.${key}`).toBe("string");
        expect(value.trim().length, `${loc}.${key}`).toBeGreaterThan(0);
        expect(value, `${loc}.${key}`).not.toBe(key);
      }
    }
  });

  it("interpolation tokens survive identically in every locale, key for key", () => {
    for (const loc of LOCALES) {
      for (const key of enKeys) {
        expect(tokensOf(CATALOGS[loc]![key]!), `${loc}.${key}`).toEqual(tokensOf(enNs[key]!));
      }
    }
  });

  it("numeric facts survive identically in every locale, key for key", () => {
    for (const loc of LOCALES) {
      for (const key of enKeys) {
        expect(digitsOf(CATALOGS[loc]![key]!), `${loc}.${key}`).toEqual(digitsOf(enNs[key]!));
      }
    }
  });

  it("MONEY LAW: every money line is the English source verbatim in all 10 catalogs", () => {
    expect(MONEY_KEYS.length).toBe(9);
    for (const key of MONEY_KEYS) {
      expect(enNs[key], `en missing money key ${key}`).toBeDefined();
      for (const loc of LOCALES) {
        expect(CATALOGS[loc]![key], `${loc}.${key}`).toBe(enNs[key]);
      }
    }
  });
});
