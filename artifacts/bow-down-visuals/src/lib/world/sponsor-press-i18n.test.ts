import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import en from "../../locales/en.json";
import es from "../../locales/es.json";
import fr from "../../locales/fr.json";
import pt from "../../locales/pt.json";
import de from "../../locales/de.json";
import itJson from "../../locales/it.json";
import ar from "../../locales/ar.json";
import hi from "../../locales/hi.json";
import ja from "../../locales/ja.json";
import ko from "../../locales/ko.json";
import {
  SPONSOR_ERROR_STRINGS_EN,
  SPONSOR_POST_FORM_STRINGS_EN,
  SPONSOR_REVIEW_STRINGS_EN,
  sponsorErrorStrings,
  sponsorPostFormStrings,
  sponsorReviewStrings,
} from "./sponsor-depth";
import {
  PACKET_MISSING_LABELS,
  PACKET_TEXT_STRINGS_EN,
  packetMissingStrings,
  packetTextStrings,
} from "./label-pitch-desk";
import {
  RELEASE_TEXT_STRINGS_EN,
  releaseTextStrings,
} from "./press-release-writer";

/* ─── Stack100 locale unit 47 — Sponsor/Press desk family ─────────
   The six World desks of the Sponsor/Press family (SponsorDepthDesk,
   LabelPitchDesk, GrantsDesk, PressReleaseWriter, InterviewDesk,
   ShoutoutsDesk) ride the i18n catalogs: their own flat namespace
   worldSponsorPress (407 keys) plus REUSED catalog keys where the
   2D pages already carry the same words byte-for-byte
   (sponsorDealDetail.* / sponsorsPost.* for the sponsor desk,
   labelPitch.* / playlistPitch.* for the pitch desk,
   communityGrants.* for grants, press-kit.pressRelease.* for the
   writer, interviewPrep.* for the coach, shoutouts.* for the
   shoutout form labels, common.free / common.delete).

   LOCALE HONESTY: the non-English worldSponsorPress values are
   agent-drafted and UNREVIEWED — a native pass is still owed.
   The 47 MONEY lines below state a price / fee / charge /
   no-charge fact: they carry the English source verbatim in
   EVERY catalog, figures by interpolation, never translated.

   FEE TRUTH, verified against the rails before extraction (no
   lies found): sponsor post 500 VB (SPONSOR_POST_COST_VB) ·
   pitch writer 100 VB (SPONSOR_PITCH_COST_VB) · escrow fee 15%
   (SPONSOR_PLATFORM_FEE_BPS_DEFAULT = 1500 — settled figures
   render from the rail's stamped cents, never a stated % in
   copy) · label demo kit 300 / playlist kit 200 VB (registry-
   read in the seam) · press release 100 VB (registry-pinned) ·
   interview session 200 / feedback 100 VB (registry-read) ·
   shoutouts flat 5% (SHOUTOUT_PLATFORM_FEE_PCT; the settings
   line interpolates 100 − fee as the creator's keep).

   Deliberately NOT extracted:
   - lib/sponsors.ts formatBudgetRange ("en-US" grouping) and
     daysLeftLabel ("No deadline / Closed / Ends today / N days
     left") — shared with the 2D sponsor pages; a shared-lib
     pass owns them.
   - lib/community-grants.ts monthLabel (English month names)
     and formatVb ("en-US" grouping) — shared with the 2D
     grants page; same follow-on.
   - The shared NativeStates / NativeCard / NativeBoard
     primitive copy — unit 51 (shared primitives).
   - Rail/enum tokens rendered humanized in place (sponsor
     lifecycle steps, escrow status, application status, grant
     phase/result seam records stay the pinned EN mirrors
     behind the desk key-maps), genre filter tokens (rail
     data), directory entries and rail-provided notices
     (labelNotice / curatorNotice are the rail's own words).
   - The kit-save chain's stored release text
     (buildKitReleaseEntry) composes through the seam's EN
     default — the same words the 2D panel stores. */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const COMPONENTS = [
  "../../components/world/native/SponsorDepthDesk.tsx",
  "../../components/world/native/LabelPitchDesk.tsx",
  "../../components/world/native/GrantsDesk.tsx",
  "../../components/world/native/PressReleaseWriter.tsx",
  "../../components/world/native/InterviewDesk.tsx",
  "../../components/world/native/ShoutoutsDesk.tsx",
];
const SEAMS = [
  "./sponsor-depth.ts",
  "./label-pitch-desk.ts",
  "./grants-desk.ts",
  "./press-release-writer.ts",
  "./interview-desk.ts",
  "./shoutouts-desk.ts",
];

type Catalog = Record<string, unknown>;
const CATALOGS: Record<string, Catalog> = {
  en: en as Catalog,
  es: es as Catalog,
  fr: fr as Catalog,
  pt: pt as Catalog,
  de: de as Catalog,
  it: itJson as Catalog,
  ar: ar as Catalog,
  hi: hi as Catalog,
  ja: ja as Catalog,
  ko: ko as Catalog,
};

const nsOf = (cat: Catalog) =>
  (cat["worldSponsorPress"] ?? {}) as Record<string, string>;
const EN = nsOf(en as Catalog);
const EN_KEYS = Object.keys(EN);

/* The 47 money lines: en verbatim in all 10 catalogs. */
const MONEY_KEYS = [
  "spWritePitchButton",
  "spApplyButton",
  "spWorkPaid",
  "spPostToggleButton",
  "spSpendingPausedNote",
  "spPostSubmitButton",
  "spPostChargeNote",
  "spPostOutOfCredits",
  "spPitchOutOfCredits",
  "spFundTitle",
  "spFundButton",
  "spReleaseLine",
  "spReleaseFeePart",
  "spPaidOutLine",
  "spRowGrossFee",
  "lpLabelDirectoryTitle",
  "lpTrackerCardTitle",
  "lpSaveSubmission",
  "lpLabelKitError",
  "lpLabelOutOfCredits",
  "lpLabelKitButton",
  "lpLabelKitNote",
  "lpPlaylistKitError",
  "lpPlaylistOutOfCredits",
  "lpPlaylistKitButton",
  "lpPlaylistKitNote",
  "lpCuratorDirectoryTitle",
  "lpTrackerDeadlinesTitle",
  "lpSaveDeadline",
  "lpSavePitch",
  "prIntro",
  "prOutOfCredits",
  "prErrorShape",
  "prGenerateButton",
  "ivIntro",
  "ivSessionCostLine",
  "ivOutOfCredits",
  "ivBuildErrorRefunded",
  "ivBuildErrorUnusable",
  "ivFeedbackErrorRefunded",
  "ivFeedbackErrorUnusable",
  "ivPracticeButton",
  "ivScoreButton",
  "soIntro",
  "soErrorCheckoutStart",
  "soPayClose",
  "soSettingsAccepting",
];

const tokensOf = (v: string) =>
  [...v.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
const digitsOf = (v: string) => [...v.matchAll(/[0-9]+/g)].map((m) => m[0]);

const enPath = (path: string): string => {
  let node: unknown = en;
  for (const part of path.split(".")) {
    node = (node as Record<string, unknown>)?.[part];
  }
  return node as string;
};
const enT = (key: string) => enPath(key);

describe("unit 47 — the family is wired to the catalogs", () => {
  it("all six components translate through useTranslation", () => {
    for (const rel of COMPONENTS) {
      const src = read(rel);
      expect(src, rel).toContain('from "react-i18next"');
      expect(src, rel).toContain("useTranslation()");
    }
    // The two desks with a GuestGate subcomponent translate there too.
    expect(read(COMPONENTS[1]).match(/useTranslation\(\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(read(COMPONENTS[4]).match(/useTranslation\(\)/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("the namespace holds exactly 407 keys", () => {
    expect(EN_KEYS.length).toBe(407);
  });

  it("referenced keys == catalog keys (zero orphans, zero missing)", () => {
    const referenced = new Set<string>();
    for (const rel of [...COMPONENTS, ...SEAMS]) {
      const src = read(rel);
      for (const m of src.matchAll(/worldSponsorPress\.([A-Za-z0-9_]+)/g)) {
        referenced.add(m[1]);
      }
    }
    expect([...referenced].sort()).toEqual([...EN_KEYS].sort());
  });

  it("numbers and dates format with i18n.language, never bare", () => {
    for (const rel of COMPONENTS) {
      const src = read(rel);
      expect(src, rel).not.toMatch(/\.toLocaleString\(\)/);
      expect(src, rel).not.toMatch(/\.toLocaleDateString\(\)/);
      expect(src, rel).not.toMatch(/toLocaleString\("en-US"\)/);
    }
    expect(read(COMPONENTS[0])).toContain("i18n.language");
    expect(read(COMPONENTS[1])).toContain("i18n.language");
    expect(read(COMPONENTS[4])).toContain("i18n.language");
  });
});

describe("unit 47 — all 10 catalogs carry the family", () => {
  it("every catalog carries exactly the en key set, nothing empty", () => {
    for (const [loc, cat] of Object.entries(CATALOGS)) {
      const ns = nsOf(cat);
      expect(Object.keys(ns).sort(), loc).toEqual([...EN_KEYS].sort());
      for (const k of EN_KEYS) {
        expect(typeof ns[k], `${loc}.${k}`).toBe("string");
        expect(ns[k].length, `${loc}.${k}`).toBeGreaterThan(0);
      }
    }
  });

  it("interpolation tokens match en per key per locale", () => {
    for (const [loc, cat] of Object.entries(CATALOGS)) {
      if (loc === "en") continue;
      const ns = nsOf(cat);
      for (const k of EN_KEYS) {
        expect(tokensOf(ns[k]), `${loc}.${k}`).toEqual(tokensOf(EN[k]));
      }
    }
  });

  it("digit sequences match en per key per locale", () => {
    for (const [loc, cat] of Object.entries(CATALOGS)) {
      if (loc === "en") continue;
      const ns = nsOf(cat);
      for (const k of EN_KEYS) {
        expect(digitsOf(ns[k]), `${loc}.${k}`).toEqual(digitsOf(EN[k]));
      }
    }
  });

  it("the 47 money lines are byte-identical English in every catalog", () => {
    expect(MONEY_KEYS.length).toBe(47);
    for (const [loc, cat] of Object.entries(CATALOGS)) {
      const ns = nsOf(cat);
      for (const k of MONEY_KEYS) {
        expect(ns[k], `${loc}.${k}`).toBe(EN[k]);
      }
    }
  });
});

describe("unit 47 — seam bundles resolve through the catalog", () => {
  it("the sponsor form bundle's en defaults equal the catalog build", () => {
    expect(sponsorPostFormStrings(enT)).toEqual({
      ...SPONSOR_POST_FORM_STRINGS_EN,
    });
    expect(SPONSOR_POST_FORM_STRINGS_EN.description).toBe(
      enPath("sponsorsPost.errorDescription"),
    );
  });

  it("the sponsor review + error bundles agree with the catalog", () => {
    expect(sponsorReviewStrings(enT)).toEqual(SPONSOR_REVIEW_STRINGS_EN);
    expect(sponsorErrorStrings(enT)).toEqual({
      ...SPONSOR_ERROR_STRINGS_EN,
      pausedMessage: enPath("sponsorsPost.errorSpendingPaused"),
    });
    expect(SPONSOR_ERROR_STRINGS_EN.outOfCreditsMessage).toBe(EN.spOutOfCreditsFallback);
  });

  it("the packet bundles are the 2D packet's own catalog words", () => {
    expect(packetTextStrings(enT)).toEqual(PACKET_TEXT_STRINGS_EN);
    const missing = packetMissingStrings(enT);
    for (const [key, label] of Object.entries(PACKET_MISSING_LABELS)) {
      expect(missing[key as keyof typeof missing], key).toBe(label);
    }
  });

  it("the release-text bundle's en default equals the catalog build", () => {
    expect(releaseTextStrings(enT)).toEqual(RELEASE_TEXT_STRINGS_EN);
  });
});

describe("unit 47 — en fidelity pins", () => {
  it("the fee words state the ratified prices", () => {
    expect(EN.spPostToggleButton).toBe("Post a deal — {{cost}} Visual Bucs");
    expect(EN.spWritePitchButton).toBe("Write my pitch — {{cost}} Visual Bucs");
    expect(EN.lpLabelKitButton).toBe("Build my demo kit — {{cost}} Visual Bucs");
    expect(EN.lpPlaylistKitButton).toBe("Build my pitch kit — {{cost}} Visual Bucs");
    expect(EN.prGenerateButton).toBe("Write my release — {{cost}} Bucs");
    expect(EN.soIntro).toContain("flat {{fee}}% fee");
    expect(EN.soSettingsAccepting).toContain("You receive {{keep}}% of each sale");
  });

  it("the reused page keys are byte-identical to the desk's old literals", () => {
    expect(enPath("sponsorsPost.errorDescription")).toBe("Describe the deal.");
    expect(enPath("sponsorDealDetail.errorPitchFirst")).toBe("Write your pitch first.");
    expect(enPath("playlistPitch.packetIntro")).toBe(
      "Built from your release record — real data only. Anything the record doesn't have is listed as missing, never made up.",
    );
    expect(enPath("worldPlansDesk.checkoutNoPage")).toBe(
      "Checkout didn't return a payment page — nothing was charged.",
    );
  });
});
