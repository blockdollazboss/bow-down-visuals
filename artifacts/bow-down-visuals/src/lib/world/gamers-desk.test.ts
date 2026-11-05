/**
 * gamers-desk — Gamers Hub desk in-World (manifest item 20 / B7).
 *
 * Pins:
 * - the rail is the 2D Gamers page's verbatim door
 *   (POST /api/gamers/ideas) and the page itself rides the same
 *   door through confirmedFetch — no endpoint is invented;
 * - the price chain is unbroken: rail default (re-derived from
 *   API source) == credit-costs registry row == GAMERS_IDEAS_COST
 *   from lib/gamers-prices == the desk's displayed cost — and
 *   neither the seam nor the component carries a price literal;
 * - spend-confirm rides useConfirmedApi with NO overrideCost
 *   (the registry row exists — unlike Academy's named gap), so
 *   the confirm quotes the registry exactly as the page's does;
 * - the form gate + body builder mirror gamersIdeasSchema
 *   (game 1–120 trimmed, niche ≤120, exact body keys, trimmed);
 * - the normalizer enforces the page's success rule (non-empty
 *   titles AND video ideas, caps 5/5/10) and the out-of-credits
 *   read is the page's (402 or the body marker);
 * - the toolkit is the page's six cards carried as browse data —
 *   no href, no link-out anywhere in the desk (World law);
 * - the desk docks in the members-only Screen panel via
 *   LiveDesksPanel, after the Live Shopping desk (palace guests
 *   gain no voice; the world-perf order pin keeps its sequence).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  GAMERS_IDEAS_PATH, GAMERS_DESK_COST,
  GAMERS_CONTENT_TYPES, GAMERS_GAME_MAX, GAMERS_NICHE_MAX,
  gamersDraftReady, buildGamersIdeasBody,
  GAMERS_TRENDING_GAMES,
  normalizeGamersPack, gamersOutOfCredits, GAMERS_OUT_OF_CREDITS_LINE,
  GAMERS_SAMPLE_PACK, GAMERS_TOOL_CARDS,
  GAMERS_DESK_PROMOTION, GAMERS_DESK_FOLLOW_ONS,
} from "./gamers-desk";
import { GAMERS_IDEAS_COST } from "../gamers-prices";
import { getCreditCost } from "../credit-costs";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const deskSrc = read("../../components/world/native/GamersDesk.tsx");
const seamSrc = read("./gamers-desk.ts");
const livePanelSrc = read("../../components/world/native/LiveDesksPanel.tsx");
const pageSrc = read("../../pages/gamers.tsx");
const railSrc = readFileSync(
  new URL("../../../../api-server/src/routes/generate/gamers.ts", import.meta.url),
  "utf8",
);

/** Re-derive a server constant's default from its API source file
 *  (the gamers-prices.test.ts pattern). */
function deriveRailDefault(constant: string): number {
  const re = new RegExp(
    `(?:export\\s+)?const\\s+${constant}\\s*(?::\\s*number)?\\s*=\\s*(?:Number\\(process\\.env\\[["'][A-Z0-9_]+["']\\]\\)\\s*\\|\\|\\s*)?(\\d+)\\b`,
  );
  const m = railSrc.match(re);
  expect(m, `${constant} in routes/generate/gamers.ts`).toBeTruthy();
  return Number(m![1]);
}

describe("rails — the 2D page's verbatim door", () => {
  it("pins the gamers ideas path verbatim", () => {
    expect(GAMERS_IDEAS_PATH).toBe("/api/gamers/ideas");
  });

  it("the 2D page rides the same door through confirmedFetch", () => {
    expect(pageSrc).toContain('confirmedFetch("/api/gamers/ideas"');
    expect(railSrc).toContain('router.post("/gamers/ideas"');
  });

  it("the desk rides the rail through the seam's constant + confirmedFetch", () => {
    expect(deskSrc).toContain("GAMERS_IDEAS_PATH");
    expect(deskSrc).toContain("useConfirmedApi");
    expect(deskSrc).toContain("confirmedFetch(GAMERS_IDEAS_PATH");
    expect(deskSrc).toContain("buildGamersIdeasBody");
    /* the request body is the seam's builder output, verbatim */
    expect(deskSrc).toContain("body: JSON.stringify(buildGamersIdeasBody({ game, niche, contentType }))");
  });

  it("no endpoint is hard-coded in the component", () => {
    expect(deskSrc).not.toContain("/api/gamers/ideas");
    expect(deskSrc).not.toContain("fetch(");
  });
});

describe("price — registry-derived, never a desk literal", () => {
  it("rail default == registry row == shared seam == desk display", () => {
    const railDefault = deriveRailDefault("GAMERS_CREDIT_COST");
    expect(railDefault).toBe(100);
    expect(getCreditCost("/api/gamers/ideas")?.cost).toBe(railDefault);
    expect(getCreditCost("/api/gamers/ideas")?.feature).toBe("Gamer Content Ideas");
    expect(GAMERS_IDEAS_COST).toBe(railDefault);
    expect(GAMERS_DESK_COST).toBe(GAMERS_IDEAS_COST);
  });

  it("the component imports the price from the shared seam, like the fixed page", () => {
    expect(deskSrc).toContain('from "@/lib/gamers-prices"');
    expect(deskSrc).toContain("GAMERS_IDEAS_COST");
    expect(seamSrc).toContain('from "../gamers-prices"');
  });

  it("no price literal lives in the seam or the component", () => {
    for (const src of [seamSrc, deskSrc]) {
      expect(src).not.toMatch(/CREDIT_COST\s*=\s*\d+/);
      expect(src).not.toMatch(/=\s*100\s*;/);
      expect(src).not.toContain("100 Visual Bucs");
      expect(src).not.toMatch(/cost:\s*100/);
    }
  });

  it("the spend-confirm takes NO override — the registry row prices it", () => {
    expect(deskSrc).not.toContain("overrideCost");
    expect(deskSrc).not.toContain("overrideFeature");
  });

  it("the generate button renders its price from the derived constant", () => {
    expect(deskSrc).toContain("worldDeskRemainder.gamGenerate");
  });
});

describe("form — gamersIdeasSchema mirrored", () => {
  it("the content types are the page's three, in order", () => {
    expect(GAMERS_CONTENT_TYPES.map((c) => c.key)).toEqual(["stream", "video", "shorts"]);
    expect(GAMERS_CONTENT_TYPES.map((c) => c.label)).toEqual(["Stream", "Video", "Shorts"]);
    for (const c of GAMERS_CONTENT_TYPES) {
      expect(pageSrc).toContain(`key: "${c.key}", label: "${c.label}", blurb: "${c.blurb}"`);
    }
    /* and the rail's enum is the same three */
    expect(railSrc).toContain('["stream", "video", "shorts"]');
  });

  it("the draft gate mirrors the schema (game 1–120, niche ≤120, trimmed)", () => {
    expect(GAMERS_GAME_MAX).toBe(120);
    expect(GAMERS_NICHE_MAX).toBe(120);
    expect(gamersDraftReady("", "")).toBe(false);
    expect(gamersDraftReady("   ", "")).toBe(false);
    expect(gamersDraftReady("Valorant", "")).toBe(true);
    expect(gamersDraftReady("x".repeat(120), "")).toBe(true);
    expect(gamersDraftReady("x".repeat(121), "")).toBe(false);
    expect(gamersDraftReady("Valorant", "x".repeat(120))).toBe(true);
    expect(gamersDraftReady("Valorant", "x".repeat(121))).toBe(false);
    expect(gamersDraftReady("  Valorant  ", "  ranked grind  ")).toBe(true);
  });

  it("the body builder emits the rail's exact keys, trimmed", () => {
    const body = buildGamersIdeasBody({ game: "  Valorant ", niche: " ranked ", contentType: "shorts" });
    expect(Object.keys(body)).toEqual(["game", "niche", "contentType"]);
    expect(body).toEqual({ game: "Valorant", niche: "ranked", contentType: "shorts" });
    expect(buildGamersIdeasBody({ game: "Valorant", niche: "", contentType: "stream" }).niche).toBe("");
  });

  it("the trending shelf mirrors the page's ten games", () => {
    expect(GAMERS_TRENDING_GAMES).toHaveLength(10);
    for (const g of GAMERS_TRENDING_GAMES) {
      expect(pageSrc).toContain(`{ name: "${g.name}", tag: "${g.tag}" }`);
    }
    expect(deskSrc).toContain("GAMERS_TRENDING_GAMES");
  });
});

describe("pack — the page's success rule + the rail's shapes", () => {
  const full = {
    titles: ["t1", "t2", "t3", "t4", "t5", "t6"],
    videoIdeas: ["v1", "v2", "v3", "v4", "v5", "v6"],
    tags: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"],
    creditsUsed: 100,
    creditsRemaining: 4200,
  };

  it("normalizes a full pack with the rail's caps (5 / 5 / 10)", () => {
    const pack = normalizeGamersPack(full);
    expect(pack?.titles).toHaveLength(5);
    expect(pack?.videoIdeas).toHaveLength(5);
    expect(pack?.tags).toHaveLength(10);
    expect(pack?.creditsUsed).toBe(100);
    expect(pack?.creditsRemaining).toBe(4200);
  });

  it("a pack needs non-empty titles AND video ideas (the page throws otherwise)", () => {
    expect(normalizeGamersPack({ videoIdeas: ["v"] })).toBeNull();
    expect(normalizeGamersPack({ titles: ["t"] })).toBeNull();
    expect(normalizeGamersPack({ titles: [], videoIdeas: ["v"] })).toBeNull();
    expect(normalizeGamersPack(null)).toBeNull();
    expect(normalizeGamersPack("nope")).toBeNull();
  });

  it("non-string rows are dropped, missing tags read as an empty shelf", () => {
    const pack = normalizeGamersPack({ titles: ["t", 7, null], videoIdeas: ["v", {}] });
    expect(pack?.titles).toEqual(["t"]);
    expect(pack?.videoIdeas).toEqual(["v"]);
    expect(pack?.tags).toEqual([]);
    expect(pack?.creditsUsed).toBeNull();
    expect(pack?.creditsRemaining).toBeNull();
  });

  it("out-of-credits reads exactly like the page's (402 or the body marker)", () => {
    expect(gamersOutOfCredits(402, {})).toBe(true);
    expect(gamersOutOfCredits(200, { error: "out_of_credits" })).toBe(true);
    expect(gamersOutOfCredits(200, {})).toBe(false);
    expect(gamersOutOfCredits(500, { error: "boom" })).toBe(false);
    expect(pageSrc).toContain('data.error === "out_of_credits"');
  });

  it("the out-of-credits line is the rail's own 402 message", () => {
    expect(railSrc).toContain(GAMERS_OUT_OF_CREDITS_LINE);
    expect(deskSrc).toContain("worldDeskRemainder.gamOutOfCredits");
  });

  it("the sample pack is the page's labeled sample, in the rail's shapes", () => {
    expect(GAMERS_SAMPLE_PACK.titles).toHaveLength(5);
    expect(GAMERS_SAMPLE_PACK.videoIdeas).toHaveLength(5);
    expect(GAMERS_SAMPLE_PACK.tags).toHaveLength(10);
    for (const s of [...GAMERS_SAMPLE_PACK.titles, ...GAMERS_SAMPLE_PACK.videoIdeas, ...GAMERS_SAMPLE_PACK.tags]) {
      expect(pageSrc).toContain(`"${s}"`);
    }
    expect(deskSrc).toContain("GAMERS_SAMPLE_PACK");
    expect(deskSrc).toContain("Sample");
  });
});

describe("toolkit — the page's six cards, browse-only in-world", () => {
  it("carries the page's six tool cards with their own words", () => {
    expect(GAMERS_TOOL_CARDS).toHaveLength(6);
    for (const card of GAMERS_TOOL_CARDS) {
      expect(pageSrc).toContain(`label: "${card.label}"`);
      expect(pageSrc).toContain(card.blurb);
    }
    /* the page's stat was corrected by the core lane: 6 tool cards */
    expect(GAMERS_TOOL_CARDS.map((c) => c.label)).toEqual([
      "Stream Overlays & Alerts",
      "Gaming Thumbnails",
      "Clip Highlights",
      "Gaming Intros & Outros",
      "Gaming Hook Generator",
      "Go Live Multistream",
    ]);
  });

  it("no card carries a door — no href, no Link, no page pull-up", () => {
    for (const card of GAMERS_TOOL_CARDS) {
      expect(Object.keys(card).sort()).toEqual(["blurb", "label"]);
    }
    expect(deskSrc).not.toContain("href");
    expect(deskSrc).not.toContain("wouter");
    expect(deskSrc).not.toContain('"/gamers"');
    expect(deskSrc).toContain("GAMERS_TOOL_CARDS");
  });
});

describe("docking — the members-only Screen panel", () => {
  it("the desk mounts in LiveDesksPanel, after Live Shopping", () => {
    expect(livePanelSrc).toContain('import { GamersDesk } from "./GamersDesk";');
    expect(livePanelSrc).toContain("<GamersDesk");
    expect(livePanelSrc.indexOf("<GamersDesk")).toBeGreaterThan(livePanelSrc.indexOf("<LiveShoppingDesk"));
    /* the panel itself is the members-only wrapper (world.tsx gates it) */
    expect(livePanelSrc).toContain('data-testid="world-live-desks"');
  });

  it("the desk carries its own testid and the panel's card chrome", () => {
    expect(deskSrc).toContain('data-testid="world-gamers-desk"');
    expect(deskSrc).toContain("world-gamers-generate");
    expect(deskSrc).toContain("isLight");
  });

  it("the board names the desk, its number and its rail", () => {
    expect(GAMERS_DESK_PROMOTION).toContain("#96");
    expect(GAMERS_DESK_PROMOTION).toContain("/api/gamers/ideas");
    expect(GAMERS_DESK_FOLLOW_ONS.length).toBeGreaterThan(0);
  });
});
