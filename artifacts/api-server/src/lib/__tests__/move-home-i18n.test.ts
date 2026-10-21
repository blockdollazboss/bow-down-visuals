/**
 * Move Home copy catalog (lib/move-home-i18n).
 *
 * Pins:
 *  - the en entry is BYTE-IDENTICAL to the copy Move Home shipped
 *    with (the literals below are the pre-catalog source of truth —
 *    if someone edits English copy, it happens here on purpose,
 *    never by accident), and MOVE_HOME_STEPS derives from it;
 *  - every locale carries every string, non-empty;
 *  - no non-English locale quietly serves English — the only
 *    byte-identical values allowed are established loanwords on the
 *    explicit allowlist (and a stale allowlist entry fails);
 *  - placeholder parity: whatever {tokens} en carries per string,
 *    every locale carries the same multiset.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, db: {} };
});
vi.mock("../ai-clients", () => ({
  getOpenAI: () => { throw new Error("no ai in tests"); },
  getTextModel: () => "test-model",
  getPlainTranscribeModel: () => "test-model",
}));

import { SERVER_LOCALES } from "../server-i18n";
import { MOVE_HOME_COPY, moveHomeCopyFor, type MoveHomeCopy } from "../move-home-i18n";
import { MOVE_HOME_STEPS } from "../move-home";

const EN: MoveHomeCopy = {
  steps: {
    profile: {
      title: "Your Grand Stage profile",
      blurb:
        "Your home page — name, bio, lane, and the social links from the accounts you've actually connected.",
    },
    store: {
      title: "Your starter store",
      blurb:
        "Your first products, drafted from your own catalog — live in your store the moment you approve them.",
    },
    press_kit: {
      title: "Your press kit",
      blurb:
        "A shareable EPK — bio, top tracks, and your connected socials — drafted from your profile.",
    },
    email_list: {
      title: "Your email list + welcome",
      blurb:
        "The audience you own. A fan list with a welcome email, ready before your first fan lands.",
    },
    launch_posts: {
      title: "Your launch posts",
      blurb:
        "Announcement drafts for each connected social, saved to your Post Scheduler as drafts — you pick when they fire.",
    },
  },
  defaultCreatorName: "New Creator",
  laneNouns: {
    music: "artist",
    video: "video creator",
    gaming: "streamer",
    podcast: "podcaster",
    film: "filmmaker",
    tv: "show creator",
    influencer: "creator",
    education: "educator",
    other: "creator",
  },
  bioIntro: "{displayName} is a {genre}{laneNoun} building a home for everything they make{location}.",
  bioLocationClause: " — based in {location}",
  bioKnownFrom: "You may know the work from {platforms} — now it all lives in one place.",
  bioEverythingHere:
    "Everything lives here now — music, videos, store, and memberships, straight from the source.",
  productDescription: "Official download of \"{title}\" by {displayName} — yours from the source.",
  starterProductTitle: "{displayName} — Supporter Pack",
  starterProductDescription:
    "Starter product — edit this description to say exactly what buyers get before you approve it. Nothing goes on sale until you say so.",
  taglineGenre: "{genre}{laneNoun} — official press kit",
  taglinePlain: "{displayName} — official press kit",
  listName: "{displayName} — Inner Circle",
  listDescription:
    "First to hear new drops, shows, and exclusives from {displayName}. No noise — just the good stuff.",
  welcomeSubject: "You're in — welcome to {displayName}'s inner circle",
  welcomeBody:
    "Welcome home.\n\nYou just joined the list that hears everything first — new {genre}drops, videos, shows, and store exclusives from {displayName}, before anywhere else.\n\nStart here: bowdownvisuals.com{homePath}\n\n— {displayName}",
  announcementMusic:
    "I moved home. 🏠 Everything I make — music, videos, store, memberships — now lives in one place I own: bowdownvisuals.com{homePath}. No algorithm between us. Come see the new home.",
  announcementOther:
    "I moved home. 🏠 Everything I make — videos, work, store, memberships — now lives in one place I own: bowdownvisuals.com{homePath}. No algorithm between us. Come see the new home.",
  tiktokCaption:
    "I moved home 🏠 Everything I make now lives in one place I own — link in bio. bowdownvisuals.com{homePath}",
  facebookPageLabel: "Facebook Page",
};

/* Loanwords that ARE the correct word in the locale — byte-identical
   to en on purpose. Anything else identical to en is untranslated
   residue and fails. An entry that stops being identical is stale
   and also fails, so the list can't quietly grow cover. */
const LEGIT_IDENTICAL = new Set([
  "es:laneNouns.gaming", // streamer
  "es:laneNouns.podcast", // podcaster
  "fr:laneNouns.gaming", // streamer
  "pt:laneNouns.gaming", // streamer
  "pt:laneNouns.podcast", // podcaster
  "it:laneNouns.gaming", // streamer
  "it:laneNouns.podcast", // podcaster
  "it:laneNouns.influencer", // creator
  "it:laneNouns.other", // creator
]);

function flatten(value: unknown, path = ""): Array<[string, string]> {
  if (typeof value === "string") return [[path, value]];
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => flatten(v, path ? `${path}.${k}` : k));
  }
  return [];
}

const tokens = (s: string): string[] => [...s.matchAll(/\{[a-zA-Z]+\}/g)].map((m) => m[0]).sort();

describe("Move Home copy catalog — en is byte-identical", () => {
  it("the en entry matches the shipped English exactly", () => {
    expect(MOVE_HOME_COPY.en).toEqual(EN);
    expect(moveHomeCopyFor("en")).toEqual(EN);
  });

  it("MOVE_HOME_STEPS derives from the en catalog entry, in step order", () => {
    expect(MOVE_HOME_STEPS.map((s) => s.key)).toEqual([
      "profile", "store", "press_kit", "email_list", "launch_posts",
    ]);
    for (const step of MOVE_HOME_STEPS) {
      expect({ title: step.title, blurb: step.blurb }).toEqual(EN.steps[step.key]);
    }
  });

  it("carries exactly the ten site locales", () => {
    expect(Object.keys(MOVE_HOME_COPY).sort()).toEqual([...SERVER_LOCALES].sort());
  });
});

describe("Move Home copy catalog — every locale complete", () => {
  const enFlat = flatten(EN);

  it("every locale carries every key, non-empty", () => {
    for (const locale of SERVER_LOCALES) {
      const flat = flatten(MOVE_HOME_COPY[locale]);
      expect(flat.map(([p]) => p).sort(), locale).toEqual(enFlat.map(([p]) => p).sort());
      for (const [path, value] of flat) {
        expect(value.trim().length, `${locale}:${path}`).toBeGreaterThan(0);
      }
    }
  });

  it("no untranslated English residue beyond the loanword allowlist", () => {
    const enByPath = new Map(enFlat);
    for (const locale of SERVER_LOCALES) {
      if (locale === "en") continue;
      for (const [path, value] of flatten(MOVE_HOME_COPY[locale])) {
        if (LEGIT_IDENTICAL.has(`${locale}:${path}`)) continue;
        expect(value, `${locale}:${path}`).not.toBe(enByPath.get(path));
      }
    }
  });

  it("the loanword allowlist carries no stale entries", () => {
    const enByPath = new Map(enFlat);
    for (const entry of LEGIT_IDENTICAL) {
      const [locale, ...rest] = entry.split(":");
      const path = rest.join(":");
      const flat = new Map(flatten(MOVE_HOME_COPY[locale as keyof typeof MOVE_HOME_COPY]));
      expect(flat.get(path), entry).toBe(enByPath.get(path));
    }
  });

  it("placeholder parity: every locale carries en's token multiset per string", () => {
    for (const [path, enValue] of enFlat) {
      const want = tokens(enValue);
      for (const locale of SERVER_LOCALES) {
        const flat = new Map(flatten(MOVE_HOME_COPY[locale]));
        expect(tokens(flat.get(path)!), `${locale}:${path}`).toEqual(want);
      }
    }
  });
});
