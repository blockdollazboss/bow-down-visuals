/**
 * hook-desk.test.ts — Stack-100 item 97 (closing part): the Hook
 * Desk, Hook Studio's native desk in the Create Wing.
 *
 * Traced from the 2D surface: /hooks posts mode "hooks" /
 * "captions" / "preflight" to POST /api/hook-studio (100 Visual
 * Bucs, all modes — the route's HOOK_STUDIO_CREDITS and the credit
 * registry agree) and its CTA tab to POST /api/generate-cta
 * (50 Visual Bucs — CTA_GENERATOR_CREDITS + registry). These tests
 * pin the desk's seam to those rails: registry prices, the routes'
 * enums, page-mirrored payloads, strict response guards, the
 * site's template libraries as prefills, and the source contracts
 * (confirmedFetch confirmation law, the CreateDeskPanel dispatch,
 * the station registry entry).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CAPTION_PLATFORMS,
  CTA_GOALS,
  CTA_PATH,
  CTA_PLACEMENTS,
  HOOK_DESK_MODES,
  HOOK_DESK_STATION_ID,
  HOOK_HISTORY_LIMIT,
  HOOK_STUDIO_PATH,
  HOOK_VIDEO_TYPES,
  buildCaptionPayload,
  buildCtaPayload,
  buildHookPayload,
  buildPreflightPayload,
  captionPackPrefill,
  captionsOfResponse,
  ctaCost,
  ctasOfResponse,
  hookDeskInputReady,
  hookDeskModeCost,
  hookDeskModePath,
  hookStudioCost,
  hookTemplatePrefill,
  hooksOfResponse,
  preflightOfResponse,
  pushHookHistory,
  type HookHistoryEntry,
} from "./hook-desk";
import { getCreditCost } from "../credit-costs";
import { STATION_BY_ID } from "./stations";
import { isCreateDeskId, CREATE_DESK_IDS } from "./create-desks";
import { HOOK_TEMPLATES } from "../../data/hook-templates";
import { CAPTION_PACKS } from "../../data/caption-templates";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const deskSrc = read("../../components/world/native/HookDesk.tsx");
const panelSrc = read("../../components/world/native/CreateDeskPanel.tsx");

describe("prices — the registry's, matching the routes' defaults", () => {
  it("hook studio is 100 VB for every mode; CTA is 50 VB", () => {
    expect(HOOK_STUDIO_PATH).toBe("/api/hook-studio");
    expect(CTA_PATH).toBe("/api/generate-cta");
    expect(hookStudioCost()).toBe(100);
    expect(ctaCost()).toBe(50);
    expect(hookStudioCost()).toBe(getCreditCost("/api/hook-studio")!.cost);
    expect(ctaCost()).toBe(getCreditCost("/api/generate-cta")!.cost);
    for (const mode of HOOK_DESK_MODES) {
      expect(hookDeskModeCost(mode), mode).toBe(mode === "cta" ? 50 : 100);
      expect(hookDeskModePath(mode), mode).toBe(mode === "cta" ? CTA_PATH : HOOK_STUDIO_PATH);
    }
  });
});

describe("enums — the routes' own, verbatim", () => {
  it("video types, platforms, goals and placements match the servers", () => {
    expect(HOOK_VIDEO_TYPES).toEqual(["music-promo", "behind-the-scenes", "tutorial", "announcement"]);
    expect(CAPTION_PLATFORMS).toEqual(["tiktok", "instagram", "youtube", "twitter"]);
    expect(CTA_GOALS).toEqual(["subscribe", "comment", "share", "follow", "buy", "stream"]);
    expect(CTA_PLACEMENTS).toEqual(["opener", "mid-roll", "closer", "pinned-comment"]);
  });
});

describe("payloads — the /hooks page's posts, field for field", () => {
  it("hooks: { mode, videoType, topic } with the topic trimmed", () => {
    expect(buildHookPayload("tutorial", "  mixing tips ")).toEqual({
      mode: "hooks",
      videoType: "tutorial",
      topic: "mixing tips",
    });
    expect(buildHookPayload("music-promo", "")).toEqual({
      mode: "hooks",
      videoType: "music-promo",
      topic: "",
    });
  });

  it("captions: { mode, topic, platform, tone }", () => {
    expect(buildCaptionPayload({ topic: " new single ", platform: "instagram", tone: " hype " })).toEqual({
      mode: "captions",
      topic: "new single",
      platform: "instagram",
      tone: "hype",
    });
  });

  it("preflight: { mode, title, caption, hashtags, description }", () => {
    expect(
      buildPreflightPayload({ title: " My Title ", caption: " c ", hashtags: " #a ", description: " d " }),
    ).toEqual({ mode: "preflight", title: "My Title", caption: "c", hashtags: "#a", description: "d" });
  });

  it("cta: { videoTopic, ctaGoal, platform, tone } on the CTA rail's names", () => {
    expect(buildCtaPayload({ videoTopic: " drop day ", ctaGoal: "stream", platform: "tiktok", tone: "" })).toEqual({
      videoTopic: "drop day",
      ctaGoal: "stream",
      platform: "tiktok",
      tone: "",
    });
  });

  it("input readiness mirrors the routes' zod minimums", () => {
    expect(hookDeskInputReady("hooks", { topic: "", title: "" })).toBe(true);
    expect(hookDeskInputReady("captions", { topic: "  ", title: "" })).toBe(false);
    expect(hookDeskInputReady("captions", { topic: "x", title: "" })).toBe(true);
    expect(hookDeskInputReady("cta", { topic: "", title: "" })).toBe(false);
    expect(hookDeskInputReady("preflight", { topic: "", title: " " })).toBe(false);
    expect(hookDeskInputReady("preflight", { topic: "", title: "T" })).toBe(true);
  });
});

describe("response guards — drift is null, never dressed-up rows", () => {
  it("hooks: a real list lands; blanks and drift do not", () => {
    expect(hooksOfResponse({ hooks: [" Stop scrolling ", "Wait for it"] })).toEqual([
      "Stop scrolling",
      "Wait for it",
    ]);
    expect(hooksOfResponse({ hooks: [] })).toBeNull();
    expect(hooksOfResponse({ hooks: ["  "] })).toBeNull();
    expect(hooksOfResponse({})).toBeNull();
    expect(hooksOfResponse(null)).toBeNull();
  });

  it("captions: captions + tiers + cta; missing tiers read empty", () => {
    const full = captionsOfResponse({
      captions: ["cap one"],
      hashtags: { niche: ["indie"], broad: ["music"], trending: ["fyp"] },
      cta: "Stream it now",
    });
    expect(full).toEqual({
      captions: ["cap one"],
      hashtags: { niche: ["indie"], broad: ["music"], trending: ["fyp"] },
      cta: "Stream it now",
    });
    expect(captionsOfResponse({ captions: ["only"] })).toEqual({
      captions: ["only"],
      hashtags: { niche: [], broad: [], trending: [] },
      cta: "",
    });
    expect(captionsOfResponse({ captions: [] })).toBeNull();
  });

  it("preflight: checks are the payload; scores clamp 0–100 like the route", () => {
    const card = preflightOfResponse({
      score: 140,
      verdict: "Close.",
      disclaimer: "Readiness, not a guarantee.",
      checks: [{ label: "Hook strength", score: -5, fix: "Open on the drop." }],
    });
    expect(card!.score).toBe(100);
    expect(card!.checks[0]).toEqual({ label: "Hook strength", score: 0, fix: "Open on the drop." });
    expect(preflightOfResponse({ checks: [] })).toBeNull();
    expect(preflightOfResponse({ checks: [{ label: "x", score: "high", fix: "y" }] })).toBeNull();
    expect(preflightOfResponse({ score: 50 })).toBeNull();
  });

  it("ctas: placement must be a real placement; one bad variant poisons the list", () => {
    expect(
      ctasOfResponse({ ctas: [{ text: "Hit follow", placement: "closer", strength: 87.6 }] }),
    ).toEqual([{ text: "Hit follow", placement: "closer", strength: 88 }]);
    expect(ctasOfResponse({ ctas: [{ text: "x", placement: "somewhere", strength: 1 }] })).toBeNull();
    expect(ctasOfResponse({ ctas: [] })).toBeNull();
  });
});

describe("templates — the site's own libraries prefill the desk", () => {
  it("every Daily Drop hook slug resolves to a hook template prefill", () => {
    /* The drop keys ARE template slugs (retention-drops hrefs) —
       spot-pin the traced ones plus the library's first entry. */
    for (const slug of ["new-single-release-hook", "studio-session-hook", HOOK_TEMPLATES[0]!.slug]) {
      const pre = hookTemplatePrefill(slug);
      expect(pre, slug).not.toBeNull();
      expect(HOOK_VIDEO_TYPES).toContain(pre!.videoType);
      expect(pre!.topic.length).toBeGreaterThan(0);
    }
    expect(hookTemplatePrefill("no-such-template")).toBeNull();
  });

  it("every Daily Drop caption slug resolves to a caption pack prefill", () => {
    for (const slug of ["single-release-captions", "album-announcement-captions", CAPTION_PACKS[0]!.slug]) {
      const pre = captionPackPrefill(slug);
      expect(pre, slug).not.toBeNull();
      expect(CAPTION_PLATFORMS).toContain(pre!.platform);
      expect(pre!.topic.length).toBeGreaterThan(0);
    }
    expect(captionPackPrefill("no-such-pack")).toBeNull();
  });
});

describe("session history — newest first, deduped, capped", () => {
  const entry = (label: string): HookHistoryEntry => ({ mode: "hooks", label, lines: [`line-${label}`] });
  it("push, dedupe and cap at HOOK_HISTORY_LIMIT", () => {
    let h: HookHistoryEntry[] = [];
    h = pushHookHistory(h, entry("a"));
    h = pushHookHistory(h, entry("b"));
    expect(h.map((e) => e.label)).toEqual(["b", "a"]);
    h = pushHookHistory(h, entry("a"));
    expect(h.map((e) => e.label)).toEqual(["a", "b"]);
    for (let i = 0; i < HOOK_HISTORY_LIMIT + 3; i++) h = pushHookHistory(h, entry(`x${i}`));
    expect(h.length).toBe(HOOK_HISTORY_LIMIT);
  });
});

describe("the station + dispatch (source pins)", () => {
  it("the Hook Desk is a Create Wing create-pattern station, members-only", () => {
    expect(HOOK_DESK_STATION_ID).toBe("hook-desk");
    const station = STATION_BY_ID.get("hook-desk")!;
    expect(station.roomId).toBe("world:create-wing");
    expect(station.panel).toEqual({ kind: "native", pattern: "create" });
    expect(station.membersOnly).toBe(true);
    expect(station.websitePath).toBe("/hooks");
    expect(isCreateDeskId("hook-desk")).toBe(true);
    expect(CREATE_DESK_IDS).toContain("hook-desk");
  });

  it("the panel dispatch mounts the Hook Desk for the station", () => {
    expect(panelSrc).toContain('case "hook-desk":');
    expect(panelSrc).toContain("<HookDesk {...props} />");
    expect(panelSrc).toContain('from "./HookDesk"');
  });

  it("the desk rides the real rails through confirmedFetch — confirmation law intact", () => {
    expect(deskSrc).toContain("useConfirmedApi");
    expect(deskSrc).toContain("confirmedFetch(path");
    expect(deskSrc).toContain("hookDeskModePath(mode)");
    expect(deskSrc).toContain("buildHookPayload");
    expect(deskSrc).toContain("buildCaptionPayload");
    expect(deskSrc).toContain("buildPreflightPayload");
    expect(deskSrc).toContain("buildCtaPayload");
    /* A declined confirmation runs nothing — the null-res guard. */
    expect(deskSrc).toContain("if (!res) return;");
    /* The price is printed before the run, from the registry seam. */
    expect(deskSrc).toContain('data-testid="world-hook-desk-cost"');
    expect(deskSrc).toContain("hookDeskModeCost(mode)");
    expect(deskSrc).toContain("shown before anything runs");
    /* Honest states: 402 reads as out-of-credits; results in-panel. */
    expect(deskSrc).toContain('data-testid="world-create-hook-desk"');
    expect(deskSrc).toContain('data-testid="world-hook-desk-result"');
    expect(deskSrc).toContain("out of Visual Bucs");
    /* Templates dock from the site's own libraries. */
    expect(deskSrc).toContain("HOOK_TEMPLATES");
    expect(deskSrc).toContain("CAPTION_PACKS");
    expect(deskSrc).toContain("hookTemplatePrefill");
    expect(deskSrc).toContain("captionPackPrefill");
  });
});
