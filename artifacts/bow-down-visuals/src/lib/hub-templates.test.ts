/**
 * Hub project starters — the registry pins (stack200 upgrade
 * group 6, extended by the stack300 hub-starters lane, then by
 * the stack400 shelf-hub lane).
 *
 * Pinned:
 * - the learn and business shelves carry the stack200 additions
 *   `skill-sprint` (learn) and `client-welcome-kit` (business),
 *   plus the stack300 additions `analytics-literacy` (learn) and
 *   `invoice-and-tax-kit` (business) — resolved through the same
 *   getTemplates / getTemplate seam the Hub module renders from;
 * - the release, grow, and monetize shelves carry the stack300
 *   additions `mixtape-drop`, `flagship-series`, and
 *   `digital-product-launch` — one per shelf, so the five
 *   thinnest shelves (release / grow / monetize / learn /
 *   business) each stand at four starters and the registry at
 *   72 total;
 * - every starter on those shelves is well-formed in the
 *   family's own shape: a name, a blurb, an icon, a preloaded
 *   project name, a real creative brief, and at least one
 *   preloaded per-step hint with both halves filled.
 */
import { describe, it, expect } from "vitest";
import { getTemplate, getTemplates, type HubTemplate } from "./hub-templates";
import type { HubProjectType } from "./hub-project";

function expectWellFormed(t: HubTemplate) {
  expect(t.key).toBeTruthy();
  expect(t.name).toBeTruthy();
  expect(t.blurb).toBeTruthy();
  expect(t.icon).toBeTruthy();
  expect(t.projectName).toBeTruthy();
  expect(t.concept.length).toBeGreaterThan(40);
  expect(t.preload.length).toBeGreaterThan(0);
  for (const p of t.preload) {
    expect(p.step).toBeTruthy();
    expect(p.hint).toBeTruthy();
  }
}

describe("the release shelf", () => {
  it("carries four starters: the three commercial formats plus mixtape-drop", () => {
    expect(getTemplates("release").map((t) => t.key)).toEqual([
      "single-drop",
      "ep-launch",
      "album-rollout",
      "mixtape-drop",
    ]);
  });

  it("mixtape-drop is the free street-tape rollout preloaded into protect, distribute, and promos", () => {
    const tape = getTemplate("release", "mixtape-drop")!;
    expectWellFormed(tape);
    expect(tape.name).toBe("Mixtape Drop");
    expect(tape.concept).toContain("free and everywhere");
    expect(tape.preload.map((p) => p.step)).toEqual([
      "protect",
      "distribute",
      "promos",
    ]);
  });
});

describe("the grow shelf", () => {
  it("carries four starters: the three engines plus flagship-series", () => {
    expect(getTemplates("grow").map((t) => t.key)).toEqual([
      "growth-sprint",
      "clip-engine",
      "collab-ladder",
      "flagship-series",
    ]);
  });

  it("flagship-series is the recurring anchor show preloaded into hooks, calendar, and analytics", () => {
    const flagship = getTemplate("grow", "flagship-series")!;
    expectWellFormed(flagship);
    expect(flagship.name).toBe("Flagship Series");
    expect(flagship.concept).toContain("same day, every week");
    expect(flagship.preload.map((p) => p.step)).toEqual([
      "hooks",
      "calendar",
      "analytics",
    ]);
  });
});

describe("the monetize shelf", () => {
  it("carries four starters: sponsors, merch, fan payments plus digital-product-launch", () => {
    expect(getTemplates("monetize").map((t) => t.key)).toEqual([
      "sponsor-blitz",
      "merch-drop",
      "fan-stack",
      "digital-product-launch",
    ]);
  });

  it("digital-product-launch sells an owned product, preloaded into strategy and the calculator", () => {
    const launch = getTemplate("monetize", "digital-product-launch")!;
    expectWellFormed(launch);
    expect(launch.name).toBe("Digital Product Launch");
    expect(launch.concept).toContain("your own digital product");
    expect(launch.preload.map((p) => p.step)).toEqual([
      "strategy",
      "calculator",
    ]);
  });
});

describe("the learn shelf", () => {
  it("carries four starters: the two originals plus skill-sprint and analytics-literacy", () => {
    expect(getTemplates("learn").map((t) => t.key)).toEqual([
      "creator-basics",
      "copyright-crash",
      "skill-sprint",
      "analytics-literacy",
    ]);
  });

  it("skill-sprint is a 7-day course starter preloaded into Academy + Guides", () => {
    const sprint = getTemplate("learn", "skill-sprint")!;
    expectWellFormed(sprint);
    expect(sprint.name).toBe("Skill Sprint");
    expect(sprint.concept).toContain("7-day");
    expect(sprint.preload.map((p) => p.step)).toEqual(["academy", "guides"]);
  });

  it("analytics-literacy is the read-your-numbers curriculum preloaded into Academy + Guides", () => {
    const literacy = getTemplate("learn", "analytics-literacy")!;
    expectWellFormed(literacy);
    expect(literacy.name).toBe("Analytics Literacy");
    expect(literacy.concept).toContain("retention");
    expect(literacy.preload.map((p) => p.step)).toEqual(["academy", "guides"]);
  });
});

describe("the business shelf", () => {
  it("carries four starters: the two originals plus client-welcome-kit and invoice-and-tax-kit", () => {
    expect(getTemplates("business").map((t) => t.key)).toEqual([
      "llc-pack",
      "presskit-build",
      "client-welcome-kit",
      "invoice-and-tax-kit",
    ]);
  });

  it("client-welcome-kit preloads the welcome video, the press kit, and the booking paperwork", () => {
    const kit = getTemplate("business", "client-welcome-kit")!;
    expectWellFormed(kit);
    expect(kit.name).toBe("Client Welcome Kit");
    expect(kit.preload.map((p) => p.step)).toEqual(["video", "presskit", "contracts"]);
    expect(kit.preload[0]!.hint).toContain("welcome");
    expect(kit.preload[2]!.hint).toContain("Booking");
  });

  it("invoice-and-tax-kit preloads the invoicing rhythm, payment terms, and the tax set-aside", () => {
    const kit = getTemplate("business", "invoice-and-tax-kit")!;
    expectWellFormed(kit);
    expect(kit.name).toBe("Invoice + Tax Kit");
    expect(kit.preload.map((p) => p.step)).toEqual([
      "llc",
      "contracts",
      "calculator",
    ]);
    expect(kit.preload[2]!.hint).toContain("taxes");
  });
});

describe("the game shelf (stack400 D-23)", () => {
  it("carries five starters with speedrun-channel-launch appended last", () => {
    expect(getTemplates("game").map((t) => t.key)).toEqual([
      "retro-platformer",
      "horror-game",
      "rpg-adventure",
      "speedrun-channel-launch",
      "mobile-puzzle",
    ]);
  });

  it("speedrun-channel-launch is the timer-first gaming channel preloaded into story, characters, art, and promote", () => {
    const launch = getTemplate("game", "speedrun-channel-launch")!;
    expectWellFormed(launch);
    expect(launch.name).toBe("Speedrun Channel Launch");
    expect(launch.concept).toContain("timer on screen");
    expect(launch.preload.map((p) => p.step)).toEqual([
      "story",
      "characters",
      "art",
      "promote",
    ]);
  });
});

describe("the movie shelf (stack400 D-24)", () => {
  it("carries five starters with short-film-premiere on the shelf", () => {
    expect(getTemplates("movie").map((t) => t.key)).toEqual([
      "scifi-short",
      "horror-short",
      "comedy-short",
      "short-film-premiere",
      "drama-short",
    ]);
  });

  it("short-film-premiere is the finished-film launch preloaded into premiere, score, and promo", () => {
    const premiere = getTemplate("movie", "short-film-premiere")!;
    expectWellFormed(premiere);
    expect(premiere.name).toBe("Short Film Premiere");
    expect(premiere.concept).toContain("opening night");
    expect(premiere.preload.map((p) => p.step)).toEqual([
      "premiere",
      "score",
      "promo",
    ]);
  });
});

describe("the series shelf (stack400 D-25)", () => {
  it("carries five starters with weekly-web-series on the shelf", () => {
    expect(getTemplates("series").map((t) => t.key)).toEqual([
      "comedy-series",
      "drama-miniseries",
      "ai-adventure",
      "weekly-web-series",
      "reality-style",
    ]);
  });

  it("weekly-web-series is the same-day-every-week habit preloaded into arc, cast, episodes, and premiere", () => {
    const series = getTemplate("series", "weekly-web-series")!;
    expectWellFormed(series);
    expect(series.name).toBe("Weekly Web Series");
    expect(series.concept).toContain("same release day");
    expect(series.preload.map((p) => p.step)).toEqual([
      "arc",
      "cast",
      "episodes",
      "premiere",
    ]);
  });
});

describe("the clipper shelf (stack400 D-26)", () => {
  it("carries five starters with clip-farm-system on the shelf", () => {
    expect(getTemplates("clipper").map((t) => t.key)).toEqual([
      "stream-clipper",
      "podcast-clipper",
      "sports-clipper",
      "clip-farm-system",
      "drama-clipper",
    ]);
  });

  it("clip-farm-system is the multi-account clipping operation preloaded into niche, brand, clip, post, and deals", () => {
    const farm = getTemplate("clipper", "clip-farm-system")!;
    expectWellFormed(farm);
    expect(farm.name).toBe("Clip Farm System");
    expect(farm.concept).toContain("run as a system");
    expect(farm.preload.map((p) => p.step)).toEqual([
      "niche",
      "brand",
      "clip",
      "post",
      "deals",
    ]);
  });
});

describe("the visual shelf (stack400 D-27)", () => {
  it("carries five starters with brand-identity-sprint appended last", () => {
    expect(getTemplates("visual").map((t) => t.key)).toEqual([
      "artist-identity",
      "channel-rebrand",
      "single-pack",
      "streamer-overhaul",
      "brand-identity-sprint",
    ]);
  });

  it("brand-identity-sprint is the one-pass identity kit preloaded into logo, brand, and test", () => {
    const sprint = getTemplate("visual", "brand-identity-sprint")!;
    expectWellFormed(sprint);
    expect(sprint.name).toBe("Brand Identity Sprint");
    expect(sprint.concept).toContain("identity sprint");
    expect(sprint.preload.map((p) => p.step)).toEqual([
      "logo",
      "brand",
      "test",
    ]);
  });
});

describe("the registry as a whole", () => {
  it("stands at 77 starters across the 16 shelves", () => {
    const shelves: HubProjectType[] = [
      "song",
      "video",
      "visual",
      "movie",
      "series",
      "game",
      "podcast",
      "ai-producer",
      "ai-influencer",
      "influencer",
      "release",
      "grow",
      "monetize",
      "learn",
      "business",
      "clipper",
    ];
    const total = shelves.reduce(
      (sum, shelf) => sum + getTemplates(shelf).length,
      0,
    );
    expect(total).toBe(77);
  });

  it("holds the untouched shelves at their pre-stack400 sizes", () => {
    expect(getTemplates("song").length).toBe(6);
    expect(getTemplates("video").length).toBe(5);
    expect(getTemplates("influencer").length).toBe(5);
    expect(getTemplates("release").length).toBe(4);
    expect(getTemplates("grow").length).toBe(4);
    expect(getTemplates("monetize").length).toBe(4);
    expect(getTemplates("learn").length).toBe(4);
    expect(getTemplates("business").length).toBe(4);
    expect(getTemplates("podcast").length).toBe(5);
    expect(getTemplates("ai-producer").length).toBe(5);
    expect(getTemplates("ai-influencer").length).toBe(6);
  });
});

describe("every starter on the five grown shelves is well-formed", () => {
  it("no blank briefs, no empty preloads, no missing icons", () => {
    for (const t of [
      ...getTemplates("release"),
      ...getTemplates("grow"),
      ...getTemplates("monetize"),
      ...getTemplates("learn"),
      ...getTemplates("business"),
    ]) {
      expectWellFormed(t);
    }
  });
});
