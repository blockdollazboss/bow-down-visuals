/**
 * Stack 1600 locale wave — item 37 (Create core): source-contract pins
 * for the Create-core World desk family's move onto the site's i18n
 * system (the `worldCreateDesk` catalog namespace, the same pattern
 * the Gift Cards / Plans / Treasury desks already use).
 *
 * The family is the manifest's six Create-core files:
 *   components/world/native/CreateDesks.tsx       (Song / Song+Video /
 *     Song-Video Wizard / Video / Cover Art / Thumbnail desks)
 *   components/world/native/CreateDeskPanel.tsx   (pure dispatch —
 *     verified: no user-facing strings, nothing to extract)
 *   components/world/native/CreateDeskLeaf.tsx    (shared leaf chrome)
 *   components/world/native/CreateDeskRunner.tsx  (shared run chrome —
 *     also consumed by the Audio / Business desks, whose own strings
 *     are their units' work; only the runner's chrome moved here)
 *   components/world/native/CreateDeskShared.tsx  (the finisher chips)
 *   components/world/native/CreateResultLeaf.tsx  (result leaves: clip
 *     model picker, song audio rail, published reward, quest chip)
 * plus the family's lib seam src/lib/world/create-desks.ts, whose one
 * user-facing composer (questChipLine) takes its templates as an
 * optional parameter defaulting to the exported English pair.
 *
 * Deliberately NOT extracted (registry-verbatim data — the Plans Desk
 * plan-names precedent): the genre / mood / length / platform /
 * art-style option vocabularies whose label IS the posted value,
 * COVER_ART_PRESETS labels + moods (the cover-art page's own
 * registry), COVER_ART_STYLES / COVER_ART_RATIOS labels (the shared
 * lib/cover-art registry), ARTIST_IMAGE_MODELS labels (only the
 * "{{label}} · {{credits}} Visual Bucs" frame is a key), the
 * SONG_PRESET_GROUPS / preset labels + emoji (the lib/song-presets
 * registry), and payload / data defaults (project types, draft
 * titles, scene clip-save titles, the platform format placeholder).
 *
 * Money honesty (the standing locale law — price copy is never
 * agent-drafted): prices ride as {{cost}} / {{total}} / {{credits}} /
 * {{pct}} interpolation tokens everywhere; the three strings that ARE
 * price-schedule prose (songOnePrice, audioCoveredNote,
 * thumbnailPriceNote) carry the ENGLISH VERBATIM in all ten catalogs,
 * the Gift Cards Desk precedent, pinned below. One more money string
 * could not be safely tokenized and stays English inline BY DESIGN:
 * the transcribeCostLabel() upload labels (the Song Desk + wizard
 * compose the lib's own price-schedule sentence; that lib string is
 * pinned verbatim by src/lib/transcribe-cost-tier.test.ts).
 *
 * TRANSLATION STATUS: the en values are the desks' original wording,
 * verbatim (final). The other nine catalogs' values for this
 * namespace are AGENT-DRAFTED and UNREVIEWED — the same state as the
 * catalogs' other namespaces; a native review pass is owed before
 * launch.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { QUEST_CHIP_LINE_EN, questChipLine } from "./create-desks";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const DESKS = read("../../components/world/native/CreateDesks.tsx");
const PANEL = read("../../components/world/native/CreateDeskPanel.tsx");
const LEAF = read("../../components/world/native/CreateDeskLeaf.tsx");
const RUNNER = read("../../components/world/native/CreateDeskRunner.tsx");
const SHARED = read("../../components/world/native/CreateDeskShared.tsx");
const RESULT = read("../../components/world/native/CreateResultLeaf.tsx");
const SEAM = read("./create-desks.ts");
const FAMILY = [DESKS, LEAF, RUNNER, SHARED, RESULT].join("\n");

const LOCALES = ["en", "es", "fr", "de", "it", "pt", "ar", "hi", "ja", "ko"] as const;
type Catalog = Record<string, Record<string, string>>;
const catalogs = Object.fromEntries(
  LOCALES.map((loc) => [
    loc,
    (JSON.parse(read(`../../locales/${loc}.json`)) as Catalog).worldCreateDesk,
  ]),
) as Record<(typeof LOCALES)[number], Record<string, string>>;
const EN = catalogs.en;
const EN_KEYS = Object.keys(EN).sort();

/** Price-schedule prose — English verbatim in every catalog, never
 *  agent-drafted (the Gift Cards Desk precedent). */
const MONEY_KEYS = ["songOnePrice", "audioCoveredNote", "thumbnailPriceNote"];

const tokens = (s: string) => (s.match(/\{\{\w+\}\}/g) ?? []).sort();

describe("Create core i18n — extraction", () => {
  it("the five string-bearing family files wire useTranslation to the namespace", () => {
    for (const src of [DESKS, LEAF, RUNNER, SHARED, RESULT]) {
      expect(src).toContain('import { useTranslation } from "react-i18next"');
      expect(src).toContain("worldCreateDesk.");
    }
  });

  it("CreateDeskPanel stays pure dispatch — no strings, no namespace", () => {
    expect(PANEL).not.toContain("worldCreateDesk");
    expect(PANEL).not.toContain("useTranslation");
  });

  it("every catalog key is referenced by the family (no orphan keys)", () => {
    const haystack = FAMILY + "\n" + SEAM;
    for (const key of EN_KEYS) {
      expect(haystack, `key ${key}`).toContain(`worldCreateDesk.${key}`);
    }
  });

  it("the desks' original user-facing literals no longer sit in the family source", () => {
    for (const literal of [
      "Send to the editor",
      "Publish on my profile",
      "Put it on the jukebox",
      "Describe the song",
      "Describe the clip",
      "Your Video Plan",
      "Your artist image",
      "What should the thumbnail shout?",
      "Open in the editor",
      "From your library",
      "Making your clip",
      "This session",
      "One-tap vibes",
      "Saved — the finished package is now a project",
    ]) {
      expect(FAMILY, literal).not.toContain(literal);
    }
  });

  it("the en source carries the desks' original wording verbatim", () => {
    expect(EN.chipEditor).toBe("Send to the editor");
    expect(EN.runnerCost).toBe("Costs {{cost}} Visual Bucs — shown before anything runs.");
    expect(EN.tabHum).toBe("Hum to Song");
    expect(EN.makeSong).toBe("Make the song");
    expect(EN.turboPicks).toBe("Turbo picks");
    expect(EN.questDone).toBe(
      "That finished your quest — “{{title}}” is complete. Claim it at the Treasury.",
    );
    expect(EN.questProgress).toBe(
      "Quest progress — “{{title}}” is now {{progress}} of {{target}}.",
    );
    expect(EN.songOnePrice).toContain("{{total}} Visual Bucs");
    /* The A/B player's gone-note spelled its apostrophes with the JSX
       &rsquo; entity — the catalog carries the rendered ’ verbatim. */
    expect(EN.abBeforeGone).toBe(
      "The original isn’t at this desk anymore — only the {{label}} version can play, so there’s nothing to compare against.",
    );
  });
});

describe("Create core i18n — the quest seam", () => {
  it("the seam's default English templates ARE the catalog's templates", () => {
    expect(QUEST_CHIP_LINE_EN.completed).toBe(EN.questDone);
    expect(QUEST_CHIP_LINE_EN.progress).toBe(EN.questProgress);
  });

  it("questChipLine substitutes the quest's own facts into the templates", () => {
    expect(
      questChipLine({
        key: "quest-create-song",
        title: "First Song",
        progress: 2,
        target: 3,
        completedNow: false,
      }),
    ).toBe("Quest progress — “First Song” is now 2 of 3.");
    expect(
      questChipLine({
        key: "quest-create-song",
        title: "First Song",
        progress: 3,
        target: 3,
        completedNow: true,
      }),
    ).toBe("That finished your quest — “First Song” is complete. Claim it at the Treasury.");
  });

  it("the desk hook hands the walker's language templates into the seam", () => {
    expect(RESULT).toContain('t("worldCreateDesk.questDone")');
    expect(RESULT).toContain('t("worldCreateDesk.questProgress")');
  });
});

describe("Create core i18n — catalog parity", () => {
  it("every catalog carries the namespace with exactly the en key set", () => {
    for (const loc of LOCALES) {
      expect(Object.keys(catalogs[loc]).sort(), loc).toEqual(EN_KEYS);
    }
  });

  it("no value is empty and interpolation tokens survive every locale", () => {
    for (const loc of LOCALES) {
      for (const key of EN_KEYS) {
        const value = catalogs[loc][key];
        expect(typeof value, `${loc}.${key}`).toBe("string");
        expect(value.trim().length, `${loc}.${key}`).toBeGreaterThan(0);
        expect(tokens(value), `${loc}.${key}`).toEqual(tokens(EN[key]));
      }
    }
  });

  it("the price-schedule prose stays English verbatim in all ten catalogs", () => {
    for (const loc of LOCALES) {
      for (const key of MONEY_KEYS) {
        expect(catalogs[loc][key], `${loc}.${key}`).toBe(EN[key]);
      }
    }
  });
});
