/**
 * Stack 400 world parity, census B-11 + B-15 — the Live Desk
 * benches seam. These pins keep the in-World Show Finder /
 * Guest Questions benches riding the 2D twins' registry
 * prices and payload shapes byte-for-byte, so the World can
 * never charge a different price or send a different body
 * than the pages do.
 *
 * Prices pinned against the credit registry (the twins'
 * hardcoded costs and the registry must agree — drift on
 * either side turns this red): Show Finder hunt 200, pitch
 * 100, Guest Questions 75.
 */
import { describe, expect, it } from "vitest";
import { getCreditCost } from "../credit-costs";
import {
  GUEST_QUESTIONS_PATH,
  GUEST_QUESTION_SECTIONS,
  SHOW_DATE_WINDOWS,
  SHOW_FINDER_PATH,
  SHOW_FINDER_PITCH_PATH,
  SHOW_GENRE_PRESETS,
  SHOW_OPPORTUNITY_TYPES,
  SHOW_TYPE_TO_KEY,
  buildGuestQuestionsPayload,
  buildShowFinderPayload,
  buildShowPitchPayload,
  guestQuestionsCost,
  guestQuestionsOf,
  guestQuestionsPlainText,
  showFinderCost,
  showFinderGenre,
  showFinderPitchCost,
  showOpportunitiesOf,
  showPitchOf,
  type ShowOpportunity,
} from "./live-benches";

const OPP: ShowOpportunity = {
  title: " Friday Night Showcase ",
  type: "Open Mic",
  organizer: "City Venue",
  location: "Atlanta, GA",
  dateWindow: "next-90-days",
  whyFit: "Fits the sound",
  howToApply: "DM the organizer",
  verifyNote: "check the page",
};

describe("live benches — registry prices (census B-11 + B-15)", () => {
  it("pins the three paths as constants", () => {
    expect(SHOW_FINDER_PATH).toBe("/api/show-finder");
    expect(SHOW_FINDER_PITCH_PATH).toBe("/api/show-finder/pitch");
    expect(GUEST_QUESTIONS_PATH).toBe("/api/guest-questions");
  });

  it("Show Finder hunt = registry 200 (B-11)", () => {
    expect(getCreditCost(SHOW_FINDER_PATH)?.cost).toBe(200);
    expect(showFinderCost()).toBe(getCreditCost(SHOW_FINDER_PATH)?.cost);
  });

  it("Show Finder pitch = registry 100 (B-11)", () => {
    expect(getCreditCost(SHOW_FINDER_PITCH_PATH)?.cost).toBe(100);
    expect(showFinderPitchCost()).toBe(getCreditCost(SHOW_FINDER_PITCH_PATH)?.cost);
  });

  it("Guest Questions = registry 75 (B-15)", () => {
    expect(getCreditCost(GUEST_QUESTIONS_PATH)?.cost).toBe(75);
    expect(guestQuestionsCost()).toBe(getCreditCost(GUEST_QUESTIONS_PATH)?.cost);
  });
});

describe("live benches — Show Finder enums (the page's own)", () => {
  it("keeps the six opportunity types in the page's order", () => {
    expect([...SHOW_OPPORTUNITY_TYPES]).toEqual([
      "open-mic",
      "showcase",
      "festival",
      "venue-gig",
      "radio",
      "podcast",
    ]);
  });

  it("keeps the three date windows and ten genre presets", () => {
    expect([...SHOW_DATE_WINDOWS]).toEqual(["next-30-days", "next-90-days", "next-6-months"]);
    expect([...SHOW_GENRE_PRESETS]).toEqual([
      "Hip-Hop", "R&B", "Pop", "Afrobeats", "Latin", "EDM", "Rock", "Country", "Jazz", "Gospel",
    ]);
  });

  it("maps the model's display labels back to the request enum (TYPE_TO_KEY)", () => {
    expect(SHOW_TYPE_TO_KEY["Open Mic"]).toBe("open-mic");
    expect(SHOW_TYPE_TO_KEY.Showcase).toBe("showcase");
    expect(SHOW_TYPE_TO_KEY.Festival).toBe("festival");
    expect(SHOW_TYPE_TO_KEY["Venue Gig"]).toBe("venue-gig");
    expect(SHOW_TYPE_TO_KEY["Radio Spot"]).toBe("radio");
    expect(SHOW_TYPE_TO_KEY["Podcast Guest"]).toBe("podcast");
  });
});

describe("live benches — Show Finder payload (byte-identical to ShowFinder.tsx)", () => {
  it("genre rule: a typed custom genre wins, both sliced to 80", () => {
    expect(showFinderGenre({ genre: "Hip-Hop", customGenre: "  Trap Soul " })).toBe("Trap Soul");
    expect(showFinderGenre({ genre: "Jazz", customGenre: "   " })).toBe("Jazz");
    expect(showFinderGenre({ genre: "x".repeat(100), customGenre: "" })).toHaveLength(80);
  });

  it("hunt body: location trimmed to 120, bio trimmed to 600, key order kept", () => {
    const payload = buildShowFinderPayload({
      location: `  ${"A".repeat(130)}  `,
      genre: "Hip-Hop",
      customGenre: "",
      opportunityTypes: ["open-mic", "showcase"],
      dateWindow: "next-90-days",
      artistBio: `  ${"B".repeat(700)}  `,
    });
    expect(Object.keys(payload)).toEqual([
      "location", "genre", "opportunityTypes", "dateWindow", "artistBio",
    ]);
    expect(payload.location).toHaveLength(120);
    expect(payload.genre).toBe("Hip-Hop");
    expect(payload.opportunityTypes).toEqual(["open-mic", "showcase"]);
    expect(payload.dateWindow).toBe("next-90-days");
    expect(payload.artistBio).toHaveLength(600);
    // The route's hunt schema ceiling (600) is exactly what the
    // payload is shaped to — anything longer must never ship.
    expect(payload.artistBio.length).toBeLessThanOrEqual(600);
  });

  it("pitch body: typed name wins, profile name next, Independent Artist last", () => {
    const base = {
      opportunity: OPP,
      genre: "Hip-Hop",
      customGenre: "",
      artistBio: " bio ",
      location: " Atlanta ",
    };
    expect(buildShowPitchPayload({ ...base, creatorName: "  Thy Cheat Code ", profileName: "Other" })).toMatchObject({
      opportunityTitle: " Friday Night Showcase ",
      opportunityType: "open-mic",
      organizer: "City Venue",
      creatorName: "Thy Cheat Code",
      genre: "Hip-Hop",
      artistBio: "bio",
      location: "Atlanta",
    });
    expect(buildShowPitchPayload({ ...base, creatorName: " ", profileName: "Profile Name" }).creatorName).toBe("Profile Name");
    expect(buildShowPitchPayload({ ...base, creatorName: "", profileName: null }).creatorName).toBe("Independent Artist");
    expect(buildShowPitchPayload({ ...base, creatorName: "", profileName: undefined }).creatorName).toBe("Independent Artist");
  });

  it("pitch body: an unmapped model label falls back to showcase, name sliced to 100", () => {
    const payload = buildShowPitchPayload({
      opportunity: { ...OPP, type: "Mystery Slot" },
      creatorName: "N".repeat(120),
      profileName: null,
      genre: "Pop",
      customGenre: "",
      artistBio: "",
      location: "",
    });
    expect(payload.opportunityType).toBe("showcase");
    expect(payload.creatorName).toHaveLength(100);
  });
});

describe("live benches — Show Finder readers (null on drift)", () => {
  it("parses a real hunt answer", () => {
    const parsed = showOpportunitiesOf({
      opportunities: [OPP],
      disclaimer: "Results are leads, not bookings.",
      creditsUsed: 200,
      creditsRemaining: 800,
    });
    expect(parsed?.disclaimer).toBe("Results are leads, not bookings.");
    expect(parsed?.opportunities).toHaveLength(1);
    expect(parsed?.opportunities[0]).toMatchObject({ title: " Friday Night Showcase ", type: "Open Mic" });
  });

  it("an empty opportunities array is a successful zero-match hunt, NOT drift", () => {
    const parsed = showOpportunitiesOf({ opportunities: [], disclaimer: "d" });
    expect(parsed).not.toBeNull();
    expect(parsed?.opportunities).toEqual([]);
  });

  it("returns null when the opportunities array is missing or not an array", () => {
    expect(showOpportunitiesOf(null)).toBeNull();
    expect(showOpportunitiesOf({})).toBeNull();
    expect(showOpportunitiesOf({ opportunities: "nope" })).toBeNull();
  });

  it("pitch requires subject + body; tips ride along", () => {
    expect(showPitchOf({ pitch: { subject: "S", body: "B" }, tips: ["tip one", 42, "tip two"] })).toEqual({
      pitch: { subject: "S", body: "B" },
      tips: ["tip one", "tip two"],
    });
    expect(showPitchOf({ pitch: { subject: "S", body: "B" } })?.tips).toEqual([]);
    expect(showPitchOf({ pitch: { subject: "", body: "B" } })).toBeNull();
    expect(showPitchOf({ pitch: { subject: "S" } })).toBeNull();
    expect(showPitchOf({})).toBeNull();
    expect(showPitchOf(null)).toBeNull();
  });
});

describe("live benches — Guest Questions (byte-identical to GuestQuestions.tsx)", () => {
  it("payload trims all three fields, no slicing (the route owns the ceilings)", () => {
    expect(buildGuestQuestionsPayload({ guestName: "  Guest ", topic: " Rise ", bio: "  pasted " })).toEqual({
      guestName: "Guest",
      topic: "Rise",
      bio: "pasted",
    });
  });

  const SET = {
    guestName: "Guest",
    topic: "Rise",
    warmup: [{ question: "W1", why: "warm" }, { question: "W2", why: "warm2" }],
    deepDive: [{ question: "D1", why: "deep" }],
    rapidFire: [{ question: "R1", why: "fast" }],
    closer: [{ question: "C1", why: "close" }],
    total: 5,
    creditsUsed: 75,
    creditsRemaining: 425,
  };

  it("parses the question set; the reader gates on the warmup array like the page", () => {
    const parsed = guestQuestionsOf(SET);
    expect(parsed?.total).toBe(5);
    expect(parsed?.warmup).toHaveLength(2);
    expect(parsed?.closer[0]).toEqual({ question: "C1", why: "close" });
    expect(parsed?.creditsUsed).toBe(75);
    expect(parsed?.creditsRemaining).toBe(425);
    expect(guestQuestionsOf({ deepDive: [] })).toBeNull();
    expect(guestQuestionsOf(null)).toBeNull();
  });

  it("total falls back to the counted questions when the server omits it", () => {
    const { total: _t, ...rest } = SET;
    expect(guestQuestionsOf(rest)?.total).toBe(5);
  });

  it("keeps the four sections in the page's order", () => {
    expect([...GUEST_QUESTION_SECTIONS]).toEqual(["warmup", "deepDive", "rapidFire", "closer"]);
  });

  it("plain text export matches the page's layout: guest line, topic line, headed numbered sections", () => {
    const parsed = guestQuestionsOf(SET)!;
    const text = guestQuestionsPlainText(parsed, {
      forGuest: "Questions for Guest",
      aboutTopic: "About: Rise",
      sections: { warmup: "Warm-up", deepDive: "Deep dive", rapidFire: "Rapid fire", closer: "Closer" },
      whyLabel: "Why",
    });
    expect(text.split("\n").slice(0, 2)).toEqual(["QUESTIONS FOR GUEST", "About: Rise"]);
    expect(text).toContain("WARM-UP\n1. W1\n   Why: warm\n2. W2\n   Why: warm2");
    expect(text).toContain("CLOSER\n1. C1\n   Why: close");
    expect(text.indexOf("WARM-UP")).toBeLessThan(text.indexOf("DEEP DIVE"));
    expect(text.indexOf("DEEP DIVE")).toBeLessThan(text.indexOf("RAPID FIRE"));
    expect(text.indexOf("RAPID FIRE")).toBeLessThan(text.indexOf("CLOSER"));
  });
});
