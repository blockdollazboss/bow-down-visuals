/**
 * Schedule/Release-family i18n pins (stack100 locale unit 45,
 * manifest item 45).
 *
 * The World's Schedule/Release desk family — SchedulerDesk,
 * SetlistDesk, ReleaseDesk, PalaceCalendarBlock, ShowInvitesBlock,
 * EmailListDesk — rendered hard-coded English inside a 10-locale
 * product. Their own copy now lives in the locale catalogs under
 * worldScheduleRelease.*, extracted key-for-key (the en values are
 * the desks' original wording, verbatim). These pins hold:
 *
 *  - extraction: every family component renders through
 *    useTranslation, and every catalog key in the namespace is
 *    actually referenced by the components (no orphan keys, no
 *    unextracted remainder in the namespace);
 *  - parity: all 10 locales carry the full extracted key set,
 *    values non-empty, with identical interpolation-token sets
 *    and identical digit sequences per key;
 *  - the MONEY LAW: every line that states a specific price, fee
 *    or amount (enumerated in MONEY_KEYS below — the scheduler's
 *    reserve/cancel/refund lines and best-time price, the setlist
 *    flow price, the newsletter price, the release submit price +
 *    confirm + paid line, the AI cost suffix, and the splits
 *    100%-total rule) carries the English source VERBATIM in
 *    every catalog. Money copy is never agent-drafted; figures
 *    reach the line by interpolation;
 *  - platform names: platform proper names are never translated —
 *    the connect blurbs and pixel labels keep their Latin names
 *    in every catalog, and platform labels ride the shared lib
 *    tables / rail records verbatim;
 *  - formatting: numbers/dates in the family format with
 *    i18n.language — no hard-coded "en-US", no bare toLocale*()
 *    calls in the components.
 *
 * Seams: scheduler-desk (compose validation + saved receipt +
 * month label), palace-calendar (day labels + quest reset title),
 * show-invites (load/send/answer fallbacks), email-list-desk
 * (open-rate + fan badges + fan spent formatting) and release-desk
 * (release + smartlink validation) take OPTIONAL string bundles
 * whose defaults are the English lines verbatim, so an unbundled
 * call renders exactly as before; the desks pass their catalog
 * strings in. Label tables the shared libs own (setlist
 * SLOT_LABELS/ENERGY_LABELS, distribution platform/role labels)
 * stay the fallback — the desks map known tokens to catalog keys
 * and fall back to the lib word.
 *
 * Anti-drift reuse (NOT re-keyed into this namespace): strings
 * the desks share verbatim with the same feature's 2D surface
 * ride that surface's existing catalog keys — the scheduler's
 * month controls, weekday headers, account states, composer
 * labels and standalone heading ride scheduler.* (calendar.*,
 * days.*, accounts.*, composer.*, communityPosts.scheduleThis);
 * the setlist add/artist/remove words ride setlist.* (addButton,
 * artistPlaceholder, removeSong); the release form's genre,
 * platforms, tracks, track-title, explicit, checklist and splits
 * headings and the strategy timing label ride distribute.*
 * (genre, platforms, tracks_2, trackTitle, explicit,
 * release_checklist, royalty_splits, timing); the email desk's
 * automations title and fan-graph badges/paging ride email-list.*
 * (automations, fan_graph_*); the scheduler's edit/cancel/delete
 * verbs ride common.* (edit, cancel, delete).
 *
 * Deliberately NOT extracted (documented in the unit report):
 * shared-lib formatting seams with hard-coded en-US (prettyDateTime
 * + countdownLabel in lib/scheduler, formatEventTime in
 * lib/world/objective-strip — shared with other families, join
 * follow-on candidates); the shared lib/distribution label tables
 * and lib/setlist label tables (registry data — the desks key-map
 * with the tables as fallback); seam normalizer/member-data
 * fallbacks; rail/server-provided copy (checklist labels + hints,
 * platform status detail, automation labels + trigger notes,
 * server notices); enum/rail tokens rendered raw (post status,
 * release type/status, tone + sort option tokens); platform
 * proper names; format samples ("3:30", "USABC2412345",
 * "https://…", "G-…", "%", "/join/<handle>", "/artist/<slug>").
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
const NS = "worldScheduleRelease";

const COMPONENTS: Record<string, string> = {
  SchedulerDesk: read("../../components/world/native/SchedulerDesk.tsx"),
  SetlistDesk: read("../../components/world/native/SetlistDesk.tsx"),
  ReleaseDesk: read("../../components/world/native/ReleaseDesk.tsx"),
  PalaceCalendarBlock: read("../../components/world/native/PalaceCalendarBlock.tsx"),
  ShowInvitesBlock: read("../../components/world/native/ShowInvitesBlock.tsx"),
  EmailListDesk: read("../../components/world/native/EmailListDesk.tsx"),
};
const SEAMS: Record<string, string> = {
  schedulerDesk: read("./scheduler-desk.ts"),
  setlistDesk: read("./setlist-desk.ts"),
  releaseDesk: read("./release-desk.ts"),
  palaceCalendar: read("./palace-calendar.ts"),
  showInvites: read("./show-invites.ts"),
  emailListDesk: read("./email-list-desk.ts"),
};
const JOINED = Object.values(COMPONENTS).join("\n");

const en = readJson("../../locales/en.json");
const enNs = (en[NS] ?? {}) as Record<string, string>;
const enKeys = Object.keys(enNs).sort();
const CATALOGS: Record<string, Record<string, string>> = {};
for (const loc of LOCALES) {
  CATALOGS[loc] = (readJson(`../../locales/${loc}.json`)[NS] ?? {}) as Record<string, string>;
}

const MONEY_KEYS = [
  "schedCanceledRefunded",
  "schedBestTimeIntro",
  "schedScheduleButtonMoney",
  "schedCostNoteSchedule",
  "schedCostNoteDraft",
  "setIntro",
  "setFlowButton",
  "emailWriteNewsletter",
  "relSubmitButton",
  "relSubmittedPaid",
  "relSubmitConfirm",
  "relAiCostSuffix",
  "relSplitTotal",
];

const tokensOf = (value: string): string[] =>
  [...value.matchAll(/\{\{\s*[^{}]+\s*\}\}/g)].map((m) => m[0].replace(/\s+/g, "")).sort();

const digitsOf = (value: string): string[] => value.match(/\d+/g) ?? [];

describe("Schedule/Release-family extraction (unit 45)", () => {
  it("every family component renders through useTranslation", () => {
    for (const [name, src] of Object.entries(COMPONENTS)) {
      expect(src, name).toContain('import { useTranslation } from "react-i18next"');
      expect(src, name).toContain("useTranslation()");
    }
  });

  it("the namespace holds the family's full extracted key set", () => {
    expect(enKeys.length).toBe(471);
  });

  it("every catalog key is referenced by a component (no orphans, no remainder)", () => {
    const referenced = new Set<string>();
    for (const m of JOINED.matchAll(/worldScheduleRelease\.([A-Za-z0-9_]+)/g)) {
      referenced.add(m[1]!);
    }
    expect([...referenced].sort()).toEqual(enKeys);
  });

  it("seam bundles are optional with byte-identical English defaults", () => {
    expect(SEAMS.schedulerDesk).toContain("SCHEDULER_COMPOSE_EN");
    expect(SEAMS.schedulerDesk).toContain("SCHEDULER_RECEIPT_EN");
    expect(SEAMS.palaceCalendar).toContain("CALENDAR_DAY_LABEL_EN");
    expect(SEAMS.palaceCalendar).toContain('today: "Today"');
    expect(SEAMS.showInvites).toContain("SHOW_INVITE_EN");
    expect(SEAMS.emailListDesk).toContain("OPEN_RATE_EN");
    expect(SEAMS.emailListDesk).toContain("FAN_BADGE_EN");
    expect(SEAMS.releaseDesk).toContain("RELEASE_VALIDATION_EN");
    expect(SEAMS.releaseDesk).toContain("SMARTLINK_VALIDATION_EN");
  });

  it("numbers and dates format in the walker's language — never hard-coded en-US, never bare", () => {
    for (const [name, src] of Object.entries(COMPONENTS)) {
      expect(src, name).not.toContain('"en-US"');
      expect(src, name).not.toContain(".toLocaleString()");
      expect(src, name).not.toContain(".toLocaleDateString()");
      expect(src, name).not.toContain(".toLocaleTimeString()");
      expect(src, name).not.toContain(".toLocaleDateString(undefined");
    }
    expect(COMPONENTS.SchedulerDesk).toContain("toLocaleTimeString(i18n.language");
    expect(COMPONENTS.SchedulerDesk).toContain("toLocaleDateString(i18n.language");
    expect(COMPONENTS.SetlistDesk).toContain("toLocaleString(i18n.language)");
    expect(COMPONENTS.ReleaseDesk).toContain("toLocaleString(i18n.language)");
    expect(COMPONENTS.EmailListDesk).toContain("toLocaleString(i18n.language)");
    expect(COMPONENTS.ShowInvitesBlock).toContain("showWhenLabel(invite.startsAt, i18n.language)");
  });

  it("platform proper names stay in Latin script in every catalog", () => {
    const NAME_PINS: Record<string, string> = {
      schedBlurbInstagram: "Facebook",
      schedBlurbTiktok: "TikTok",
      schedBlurbFacebook: "Facebook",
      relMetaPixelLabel: "Meta Pixel",
      relTiktokPixelLabel: "TikTok",
      relGoogleTagLabel: "Google",
    };
    for (const [key, name] of Object.entries(NAME_PINS)) {
      for (const loc of LOCALES) {
        expect(CATALOGS[loc]![key], `${loc}.${key}`).toContain(name);
      }
    }
  });

  it("the desks reuse the 2D surfaces' own catalog keys where the words are shared (anti-drift)", () => {
    expect(COMPONENTS.SchedulerDesk).toContain('t("scheduler.days.sun")');
    expect(COMPONENTS.SchedulerDesk).toContain('t("scheduler.accounts.title")');
    expect(COMPONENTS.SchedulerDesk).toContain('t("scheduler.calendar.today")');
    expect(COMPONENTS.SchedulerDesk).toContain('t("scheduler.composer.saveChanges")');
    expect(COMPONENTS.SchedulerDesk).toContain('t("scheduler.communityPosts.scheduleThis")');
    expect(COMPONENTS.SchedulerDesk).toContain('t("common.edit")');
    expect(COMPONENTS.SetlistDesk).toContain('t("setlist.addButton")');
    expect(COMPONENTS.SetlistDesk).toContain('t("setlist.artistPlaceholder")');
    expect(COMPONENTS.SetlistDesk).toContain('t("setlist.removeSong")');
    expect(COMPONENTS.ReleaseDesk).toContain('t("distribute.royalty_splits")');
    expect(COMPONENTS.ReleaseDesk).toContain('t("distribute.release_checklist")');
    expect(COMPONENTS.ReleaseDesk).toContain('t("distribute.trackTitle"');
    expect(COMPONENTS.ReleaseDesk).toContain('t("distribute.timing")');
    expect(COMPONENTS.EmailListDesk).toContain('t("email-list.automations")');
    expect(COMPONENTS.EmailListDesk).toContain('t("email-list.fan_graph_prev")');
    expect(COMPONENTS.EmailListDesk).toContain('t("email-list.fan_graph_subscribed_badge")');
  });

  it("en copy is the desks' original wording, verbatim (representative pins)", () => {
    expect(enNs.schedCardTitle).toBe("Scheduler — your calendar");
    expect(enNs.schedCostNoteDraft).toBe(
      "Drafts are free — scheduling a post reserves 100 Visual Bucs, refunded on cancel.",
    );
    expect(enNs.setIntro).toBe(
      "Build the set free; the AI flow — order, slots and stage directions — is {{cost}} Visual Bucs. The set lives for this sitting, like the website's.",
    );
    expect(enNs.relSplitTotal).toBe("Total: {{total}}% — shares must total exactly 100%.");
    expect(enNs.emailWriteNewsletter).toBe("Write my newsletter · {{cost}} VB");
    expect(enNs.calQuestResetTitle).toBe("Weekly quests reset");
    expect(enNs.relSandboxNote).toContain("Delivery runs in sandbox simulation until the distributor is connected");
    expect(enNs.relCLinePlaceholder).toBe("© 2026 Your label");
  });
});

describe("Schedule/Release-family catalog parity (unit 45)", () => {
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

  it("leading/trailing space shape survives in every locale, key for key", () => {
    for (const loc of LOCALES) {
      for (const key of enKeys) {
        const e = enNs[key]!;
        const v = CATALOGS[loc]![key]!;
        expect(v.startsWith(" "), `${loc}.${key} leading`).toBe(e.startsWith(" "));
        expect(v.endsWith(" "), `${loc}.${key} trailing`).toBe(e.endsWith(" "));
      }
    }
  });

  it("MONEY LAW: every money line is the English source verbatim in all 10 catalogs", () => {
    expect(MONEY_KEYS.length).toBe(13);
    for (const key of MONEY_KEYS) {
      expect(enNs[key], `en missing money key ${key}`).toBeDefined();
      for (const loc of LOCALES) {
        expect(CATALOGS[loc]![key], `${loc}.${key}`).toBe(enNs[key]);
      }
    }
  });
});
