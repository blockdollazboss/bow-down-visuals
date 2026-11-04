/**
 * movies-desk.test.ts — stack1400 world parity wave #2, item 4:
 * the Movies Desk, Movies & Web Series' native desk in the
 * Create Wing.
 *
 * Traced from the 2D surface: /movies posts to
 * POST /api/movies/concept (400 Visual Bucs — the page's
 * CONCEPT_CREDITS and the route's CONCEPT_CREDITS agree) and
 * POST /api/movies/clip-detect (300 — CLIP_DETECT_CREDITS on both
 * sides). Neither endpoint has a credit-costs registry row, so
 * both the page and the desk ride explicit override costs. These
 * tests pin the desk's seam to those rails: the pinned prices,
 * the routes' enums/bounds/defaults, page-mirrored payloads,
 * strict response guards, the hub script-asset landing (the
 * page's only durable step — the rails persist nothing), and the
 * source contracts (confirmedFetch confirmation law, the
 * CreateDeskPanel dispatch, the station registry entry).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MOVIES_CLIP_CATEGORIES,
  MOVIES_CLIP_COUNT_DEFAULT,
  MOVIES_CLIP_DETECT_COST_VISUAL_BUCS,
  MOVIES_CLIP_DETECT_PATH,
  MOVIES_CONCEPT_COST_VISUAL_BUCS,
  MOVIES_CONCEPT_PATH,
  MOVIES_DESK_MODES,
  MOVIES_DESK_STATION_ID,
  MOVIES_EPISODE_COUNT_DEFAULT,
  MOVIES_FORMATS,
  MOVIES_HISTORY_LIMIT,
  MOVIES_STREAM_LENGTH_DEFAULT,
  buildClipDetectPayload,
  buildConceptHubAsset,
  buildConceptPayload,
  clampClipCount,
  clampEpisodeCount,
  clampStreamLengthMin,
  conceptOfResponse,
  detectionOfResponse,
  moviesDeskInputReady,
  moviesDeskModeCost,
  moviesDeskModeFeature,
  moviesDeskModePath,
  pushMoviesHistory,
  type MoviesHistoryEntry,
} from "./movies-desk";
import { getCreditCost } from "../credit-costs";
import { STATION_BY_ID } from "./stations";
import { CREATE_DESK_IDS, isCreateDeskId } from "./create-desks";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const deskSrc = read("../../components/world/native/MoviesDesk.tsx");
const panelSrc = read("../../components/world/native/CreateDeskPanel.tsx");
const pageSrc = read("../../pages/movies.tsx");

describe("prices — the page's and the route's constants, pinned", () => {
  it("concept is 400 VB, clip-detect is 300 VB, on the movies rails", () => {
    expect(MOVIES_CONCEPT_PATH).toBe("/api/movies/concept");
    expect(MOVIES_CLIP_DETECT_PATH).toBe("/api/movies/clip-detect");
    expect(MOVIES_CONCEPT_COST_VISUAL_BUCS).toBe(400);
    expect(MOVIES_CLIP_DETECT_COST_VISUAL_BUCS).toBe(300);
    for (const mode of MOVIES_DESK_MODES) {
      expect(moviesDeskModeCost(mode), mode).toBe(mode === "concept" ? 400 : 300);
      expect(moviesDeskModePath(mode), mode).toBe(
        mode === "concept" ? MOVIES_CONCEPT_PATH : MOVIES_CLIP_DETECT_PATH,
      );
      expect(moviesDeskModeFeature(mode), mode).toBe(
        mode === "concept" ? "Movie/Series Concept" : "Stream Clip Detection",
      );
    }
  });

  it("the registry rows landed (stack1400 join #2 flip) — the desk's costs read them, the override carries the registry's own values", () => {
    /* The registry lane added both rows at the page/route prices;
       the seam constants derive from them, so the confirmation the
       override shows IS the registered price. */
    expect(getCreditCost("/api/movies/concept")?.cost).toBe(400);
    expect(getCreditCost("/api/movies/clip-detect")?.cost).toBe(300);
  });

  it("the 2D page's own constants still say 400 / 300 (source pin)", () => {
    expect(pageSrc).toContain("const CONCEPT_CREDITS = 400;");
    expect(pageSrc).toContain("const CLIP_DETECT_CREDITS = 300;");
  });
});

describe("enums + bounds — the routes' own, verbatim", () => {
  it("formats and clip categories match the server", () => {
    expect(MOVIES_FORMATS).toEqual(["movie", "web-series", "limited-series"]);
    expect(MOVIES_CLIP_CATEGORIES).toEqual([
      "funny-moment",
      "big-play",
      "reaction",
      "fail",
      "wholesome",
      "rant",
      "clutch",
    ]);
  });

  it("Advanced clamps sit inside the zod ranges; defaults are the schema defaults", () => {
    expect(MOVIES_EPISODE_COUNT_DEFAULT).toBe(8);
    expect(MOVIES_STREAM_LENGTH_DEFAULT).toBe(120);
    expect(MOVIES_CLIP_COUNT_DEFAULT).toBe(8);
    expect(clampEpisodeCount(0)).toBe(1);
    expect(clampEpisodeCount(99)).toBe(24);
    expect(clampEpisodeCount(Number.NaN)).toBe(8);
    expect(clampStreamLengthMin(0)).toBe(1);
    expect(clampStreamLengthMin(99999)).toBe(1440);
    expect(clampClipCount(0)).toBe(1);
    expect(clampClipCount(21)).toBe(20);
  });
});

describe("payloads — the /movies page's posts, field for field", () => {
  it("concept: { idea, format, genre, episodeCount } trimmed + clamped", () => {
    expect(
      buildConceptPayload({ idea: "  a heist crew of retired dancers  ", format: "web-series", genre: " drama ", episodeCount: 8 }),
    ).toEqual({ idea: "a heist crew of retired dancers", format: "web-series", genre: "drama", episodeCount: 8 });
    expect(buildConceptPayload({ idea: "x".repeat(60), format: "movie", genre: "", episodeCount: 30 }).episodeCount).toBe(24);
  });

  it("clip-detect: { streamUrl, description, streamLengthMin, clipCount }", () => {
    expect(
      buildClipDetectPayload({ streamUrl: " https://twitch.tv/videos/1 ", description: "  big plays all night  ", streamLengthMin: 120, clipCount: 8 }),
    ).toEqual({
      streamUrl: "https://twitch.tv/videos/1",
      description: "big plays all night",
      streamLengthMin: 120,
      clipCount: 8,
    });
    /* The page's blank-URL shape rides as "" (the schema's optional default). */
    expect(buildClipDetectPayload({ streamUrl: " ", description: "d".repeat(60), streamLengthMin: 120, clipCount: 8 }).streamUrl).toBe("");
  });

  it("input readiness mirrors the routes' 50-char minimums (the page's gates)", () => {
    expect(moviesDeskInputReady("concept", { idea: "x".repeat(49), description: "" })).toBe(false);
    expect(moviesDeskInputReady("concept", { idea: ` ${"x".repeat(50)} `, description: "" })).toBe(true);
    expect(moviesDeskInputReady("clips", { idea: "", description: "y".repeat(49) })).toBe(false);
    expect(moviesDeskInputReady("clips", { idea: "", description: "y".repeat(50) })).toBe(true);
  });
});

describe("response guards — drift is null, never dressed-up rows", () => {
  const conceptBody = {
    concept: {
      title: " Last Set ",
      tagline: "One more show.",
      logline: "A retired dancer assembles her old crew for one final heist.",
      synopsis: "They steal the show, literally.",
      genre: "Heist drama",
      targetAudience: "Dance-film fans",
      episodes: [{ number: 1, title: " The Reunion ", summary: " The crew comes home. " }],
      characters: [{ name: " Mara ", role: "protagonist", description: "Ex-lead dancer.", arc: "Learns to lead again." }],
      pilotHook: "The audition is a robbery.",
      comparables: ["Ocean's Eight meets Step Up"],
    },
    format: "web-series",
    creditsCharged: 400,
  };

  it("concept: a real package lands whole, trimmed", () => {
    const c = conceptOfResponse(conceptBody);
    expect(c).not.toBeNull();
    expect(c!.title).toBe("Last Set");
    expect(c!.episodes).toEqual([{ number: 1, title: "The Reunion", summary: "The crew comes home." }]);
    expect(c!.characters[0]!.name).toBe("Mara");
    expect(c!.comparables).toEqual(["Ocean's Eight meets Step Up"]);
  });

  it("concept: no title or no logline is a failed read", () => {
    expect(conceptOfResponse({ concept: { logline: "x" } })).toBeNull();
    expect(conceptOfResponse({ concept: { title: "x" } })).toBeNull();
    expect(conceptOfResponse({})).toBeNull();
    expect(conceptOfResponse(null)).toBeNull();
    expect(conceptOfResponse({ concept: "nope" })).toBeNull();
  });

  it("detection: clips land with numbers clamped to the prompt's scales; the note rides", () => {
    const out = detectionOfResponse({
      detection: {
        clips: [
          {
            title: "INSANE clutch",
            timestamp: "1:23:45",
            timestampSeconds: 5025.4,
            durationSec: 45.6,
            category: "clutch",
            hook: "Wait for the last second",
            caption: "clutch or kick #gaming",
            viralityScore: 14,
          },
          { title: "  ", timestamp: "0:01:00" },
        ],
        streamSummary: "A night of clutches.",
        postingStrategy: "Post the clutch first.",
      },
      note: "Timestamps are AI estimates — scrub the VOD to confirm exact moments before cutting.",
    });
    expect(out).not.toBeNull();
    expect(out!.detection.clips).toHaveLength(1);
    expect(out!.detection.clips[0]).toEqual({
      title: "INSANE clutch",
      timestamp: "1:23:45",
      timestampSeconds: 5025,
      durationSec: 46,
      category: "clutch",
      hook: "Wait for the last second",
      caption: "clutch or kick #gaming",
      viralityScore: 10,
    });
    expect(out!.note).toContain("AI estimates");
  });

  it("detection: zero usable clips is a failed read", () => {
    expect(detectionOfResponse({ detection: { clips: [] } })).toBeNull();
    expect(detectionOfResponse({ detection: {} })).toBeNull();
    expect(detectionOfResponse({})).toBeNull();
  });
});

describe("the hub landing — the page's durable step, field for field", () => {
  it("buildConceptHubAsset mirrors movies.tsx's addAsset body", () => {
    const c = conceptOfResponse({
      concept: { title: "Last Set", tagline: "One more show.", logline: "The logline.", synopsis: "The synopsis.", genre: "Drama" },
    })!;
    const asset = buildConceptHubAsset(c);
    expect(asset.kind).toBe("script");
    expect(asset.label).toBe("Last Set");
    expect(asset.detail).toBe("One more show.");
    expect(asset.meta).toEqual({ text: "Last Set\n\nThe logline.\n\nThe synopsis.", logline: "The logline." });
    expect(asset.url).toBe(
      `data:text/plain;charset=utf-8,${encodeURIComponent("Last Set\n\nThe logline.\n\nThe synopsis.")}`,
    );
    /* The page falls back to genre when there is no tagline. */
    const noTag = conceptOfResponse({ concept: { title: "T", logline: "L", genre: "Drama" } })!;
    expect(buildConceptHubAsset(noTag).detail).toBe("Drama");
  });
});

describe("session history — newest first, deduped, capped", () => {
  const entry = (label: string): MoviesHistoryEntry => ({ mode: "concept", label });
  it("push, dedupe and cap at MOVIES_HISTORY_LIMIT", () => {
    let h: MoviesHistoryEntry[] = [];
    h = pushMoviesHistory(h, entry("a"));
    h = pushMoviesHistory(h, entry("b"));
    expect(h.map((e) => e.label)).toEqual(["b", "a"]);
    h = pushMoviesHistory(h, entry("a"));
    expect(h.map((e) => e.label)).toEqual(["a", "b"]);
    for (let i = 0; i < MOVIES_HISTORY_LIMIT + 3; i++) h = pushMoviesHistory(h, entry(`x${i}`));
    expect(h.length).toBe(MOVIES_HISTORY_LIMIT);
  });
});

describe("the station + dispatch (source pins)", () => {
  it("the Movies Desk is a Create Wing create-pattern station, members-only", () => {
    expect(MOVIES_DESK_STATION_ID).toBe("movies-desk");
    const station = STATION_BY_ID.get("movies-desk")!;
    expect(station.roomId).toBe("world:create-wing");
    expect(station.panel).toEqual({ kind: "native", pattern: "create" });
    expect(station.membersOnly).toBe(true);
    expect(station.websitePath).toBe("/movies");
    expect(isCreateDeskId("movies-desk")).toBe(true);
    expect(CREATE_DESK_IDS).toContain("movies-desk");
  });

  it("the panel dispatch mounts the Movies Desk for the station", () => {
    expect(panelSrc).toContain('case "movies-desk":');
    expect(panelSrc).toContain("<MoviesDesk {...props} />");
    expect(panelSrc).toContain('from "./MoviesDesk"');
  });

  it("the desk rides the real rails through confirmedFetch — confirmation law intact", () => {
    expect(deskSrc).toContain("useConfirmedApi");
    expect(deskSrc).toContain("confirmedFetch(moviesDeskModePath(mode)");
    expect(deskSrc).toContain("overrideCost: cost");
    expect(deskSrc).toContain("overrideFeature: moviesDeskModeFeature(mode)");
    expect(deskSrc).toContain("buildConceptPayload");
    expect(deskSrc).toContain("buildClipDetectPayload");
    /* A declined confirmation runs nothing — the null-res guard. */
    expect(deskSrc).toContain("if (!res) return;");
    /* The price is printed before the run, from the seam. */
    expect(deskSrc).toContain('data-testid="world-movies-desk-cost"');
    expect(deskSrc).toContain("moviesDeskModeCost(mode)");
    expect(deskSrc).toContain("worldCatalogLibrary.moviesCostLine");
    /* Honest states: 402 reads as out-of-credits; results in-panel. */
    expect(deskSrc).toContain('data-testid="world-create-movies-desk"');
    expect(deskSrc).toContain('data-testid="world-movies-desk-result"');
    expect(deskSrc).toContain("worldCatalogLibrary.moviesOutOfBucs");
    /* The hub landing rides the page's own hook. */
    expect(deskSrc).toContain("useHubProject");
    expect(deskSrc).toContain("addAsset(buildConceptHubAsset(parsed))");
    /* No exit to the 2D page: no Link, no href to /movies. */
    expect(deskSrc).not.toContain('"/movies"');
    expect(deskSrc).not.toContain("PublishToProfileButton");
  });
});
