/**
 * live-desk-copilot — Live Wave IV (stack100 B10): Stream Copilot +
 * Live Stage automation in the hall Screen panel.
 *
 * Pins:
 * - the Copilot rails are StreamCopilotSection's verbatim
 *   (/api/stream-copilot/prep + /clip-plan), the request bodies are
 *   the page's (trimmed streamTitle/topic/platform; recap/topic),
 *   the form gates are the API schemas' (title 1–200, topic 1–300,
 *   recap 1–3000), and the response normalizers mirror the rail's
 *   own parsers (string lists; a clip moment needs title AND
 *   description);
 * - prices come from the credit-costs registry by derivation —
 *   prep 100 / clip-plan 100 with the registry's own feature words —
 *   never re-typed numbers; the highlight-cut confirm override is
 *   LiveStageDesk's verbatim 200 VB / "Auto-Highlights clip cut";
 * - the stage automation rides LiveStageDesk's rails verbatim:
 *   GET/PATCH /api/live-prefs (switches + link rules, RuleAdder's
 *   readiness rule and 10-rule form cap), GET /api/live-streams/mine,
 *   the per-stream stage-manager state/mute/unpin, the highlights
 *   list/approve/dismiss/refresh and the class roster;
 * - honesty: both Copilot spends go through the confirmed door
 *   (null = declined, nothing charged), a 402 / out_of_credits
 *   answer becomes the not-enough-Bucs state with the balance
 *   refreshed, approving a cut carries the 2D desk's cancelled /
 *   402 / failure notes, and the co-host's peace law is stated on
 *   the desk (flags are the creator's call; it never kicks, mutes
 *   or locks anyone);
 * - placement: the desk is its own native file docked in the
 *   members-only LiveDesksPanel — LiveDesk.tsx (waves I–III, free
 *   rails pinned as charging nothing) stays untouched, and no flow
 *   completes by linking out to /go-live.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { getCreditCost } from "../credit-costs";
import {
  COPILOT_PREP_PATH, COPILOT_CLIP_PLAN_PATH,
  COPILOT_PREP_COST, COPILOT_PREP_FEATURE,
  COPILOT_CLIP_PLAN_COST, COPILOT_CLIP_PLAN_FEATURE,
  COPILOT_PLATFORMS,
  copilotPrepReady, copilotClipPlanReady,
  buildCopilotPrepBody, buildCopilotClipPlanBody,
  normalizeCopilotPrep, normalizeCopilotMoments,
  LIVE_PREFS_PATH, MY_STREAMS_PATH,
  STAGE_MANAGER_PATH, STAGE_MANAGER_MUTE_PATH, STAGE_MANAGER_UNPIN_PATH,
  HIGHLIGHTS_PATH, HIGHLIGHT_APPROVE_PATH, HIGHLIGHT_DISMISS_PATH, HIGHLIGHT_REFRESH_PATH,
  CLASS_ROSTER_PATH,
  HIGHLIGHT_CUT_COST_VB, HIGHLIGHT_CUT_FEATURE,
  normalizeLivePrefs, buildLivePrefsPatch,
  linkRuleReady, buildLinkRule, LINK_RULES_UI_MAX,
  normalizeMyStreams, initialStageStreamId,
  normalizeStageState, normalizeHighlightProposals, normalizeClassRoster,
  highlightClock,
  LIVE_WAVE4_PROMOTIONS,
} from "./live-desk";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const deskSrc = read("../../components/world/native/LiveCopilotDesk.tsx");
const liveDeskSrc = read("../../components/world/native/LiveDesk.tsx");
const livePanelSrc = read("../../components/world/native/LiveDesksPanel.tsx");
const copilot2dSrc = read("../../components/go-live/StreamCopilotSection.tsx");
const stage2dSrc = read("../../components/go-live/LiveStageDesk.tsx");

describe("copilot rails — the 2D section's verbatim doors", () => {
  it("pins every wave-IV path verbatim", () => {
    expect(COPILOT_PREP_PATH).toBe("/api/stream-copilot/prep");
    expect(COPILOT_CLIP_PLAN_PATH).toBe("/api/stream-copilot/clip-plan");
    expect(LIVE_PREFS_PATH).toBe("/api/live-prefs");
    expect(MY_STREAMS_PATH).toBe("/api/live-streams/mine");
    expect(STAGE_MANAGER_PATH("s 1")).toBe("/api/live-streams/s%201/stage-manager");
    expect(STAGE_MANAGER_MUTE_PATH("s1")).toBe("/api/live-streams/s1/stage-manager/mute");
    expect(STAGE_MANAGER_UNPIN_PATH("s1")).toBe("/api/live-streams/s1/stage-manager/unpin");
    expect(HIGHLIGHTS_PATH("s1")).toBe("/api/live-streams/s1/highlights");
    expect(HIGHLIGHT_APPROVE_PATH("s1", "p 2")).toBe("/api/live-streams/s1/highlights/p%202/approve");
    expect(HIGHLIGHT_DISMISS_PATH("s1", "p2")).toBe("/api/live-streams/s1/highlights/p2/dismiss");
    expect(HIGHLIGHT_REFRESH_PATH("s1", "p2")).toBe("/api/live-streams/s1/highlights/p2/refresh");
    expect(CLASS_ROSTER_PATH("s1")).toBe("/api/live-streams/s1/class-roster");
  });

  it("the 2D sources ride the same rails the desk mirrors", () => {
    expect(copilot2dSrc).toContain('"/api/stream-copilot/prep"');
    expect(copilot2dSrc).toContain('"/api/stream-copilot/clip-plan"');
    expect(stage2dSrc).toContain('"/api/live-prefs"');
    expect(stage2dSrc).toContain('"/api/live-streams/mine"');
    expect(stage2dSrc).toContain("/stage-manager/mute");
    expect(stage2dSrc).toContain("/stage-manager/unpin");
    expect(stage2dSrc).toContain("/highlights/");
    expect(stage2dSrc).toContain("/class-roster");
  });

  it("the platform menu is StreamCopilotSection's verbatim chips", () => {
    expect([...COPILOT_PLATFORMS]).toEqual(["TikTok", "YouTube", "Twitch", "Instagram"]);
    expect(copilot2dSrc).toContain('["TikTok", "YouTube", "Twitch", "Instagram"]');
  });
});

describe("prices — registry-derived, never re-typed", () => {
  it("prep and clip-plan derive 100 VB each from the registry rows", () => {
    expect(getCreditCost(COPILOT_PREP_PATH)).toEqual({ cost: 100, feature: "Stream Copilot Prep" });
    expect(getCreditCost(COPILOT_CLIP_PLAN_PATH)).toEqual({ cost: 100, feature: "Stream Copilot Clip Plan" });
    expect(COPILOT_PREP_COST).toBe(100);
    expect(COPILOT_CLIP_PLAN_COST).toBe(100);
    expect(COPILOT_PREP_COST).toBe(getCreditCost(COPILOT_PREP_PATH)?.cost);
    expect(COPILOT_CLIP_PLAN_COST).toBe(getCreditCost(COPILOT_CLIP_PLAN_PATH)?.cost);
    expect(COPILOT_PREP_FEATURE).toBe("Stream Copilot Prep");
    expect(COPILOT_CLIP_PLAN_FEATURE).toBe("Stream Copilot Clip Plan");
  });

  it("the highlight-cut override is LiveStageDesk's verbatim 200 VB", () => {
    expect(HIGHLIGHT_CUT_COST_VB).toBe(200);
    expect(HIGHLIGHT_CUT_FEATURE).toBe("Auto-Highlights clip cut");
    expect(stage2dSrc).toContain("overrideCost: 200");
    expect(stage2dSrc).toContain('overrideFeature: "Auto-Highlights clip cut"');
    expect(stage2dSrc).toContain("Cut it · 200 VB");
  });

  it("the desk shows the seam's prices on its buttons", () => {
    expect(deskSrc).toContain("Build My Prep ({COPILOT_PREP_COST} VB)");
    expect(deskSrc).toContain("Spot the Clips ({COPILOT_CLIP_PLAN_COST} VB)");
    expect(deskSrc).toContain("`Cut it · ${HIGHLIGHT_CUT_COST_VB} VB`");
  });
});

describe("copilot request shapes — the page's bodies, the schemas' gates", () => {
  it("builds the prep body trimmed, platform verbatim", () => {
    expect(buildCopilotPrepBody({ streamTitle: "  Launch night  ", topic: "  ranked grind ", platform: "Twitch" }))
      .toEqual({ streamTitle: "Launch night", topic: "ranked grind", platform: "Twitch" });
    expect(buildCopilotClipPlanBody({ recap: "  12:40 — clutch  ", topic: "  finals " }))
      .toEqual({ recap: "12:40 — clutch", topic: "finals" });
    expect(buildCopilotClipPlanBody({ recap: "recap", topic: "" })).toEqual({ recap: "recap", topic: "" });
  });

  it("the prep gate is prepSchema's: title 1–200, topic 1–300, trimmed", () => {
    expect(copilotPrepReady("Show", "Topic")).toBe(true);
    expect(copilotPrepReady("   ", "Topic")).toBe(false);
    expect(copilotPrepReady("Show", "  ")).toBe(false);
    expect(copilotPrepReady("x".repeat(200), "y".repeat(300))).toBe(true);
    expect(copilotPrepReady("x".repeat(201), "Topic")).toBe(false);
    expect(copilotPrepReady("Show", "y".repeat(301))).toBe(false);
  });

  it("the clip-plan gate is clipPlanSchema's: recap 1–3000 trimmed", () => {
    expect(copilotClipPlanReady(" 12:40 — clutch ")).toBe(true);
    expect(copilotClipPlanReady("   ")).toBe(false);
    expect(copilotClipPlanReady("x".repeat(3000))).toBe(true);
    expect(copilotClipPlanReady("x".repeat(3001))).toBe(false);
  });

  it("normalizes the prep pack the rail's way: strings only, trimmed, capped", () => {
    expect(normalizeCopilotPrep({
      checklist: ["  Check mic ", "", 42, "Post announcement"],
      talkingPoints: ["Intro"],
      clipWatchFors: [null, "Hot takes"],
    })).toEqual({ checklist: ["Check mic", "Post announcement"], talkingPoints: ["Intro"], clipWatchFors: ["Hot takes"] });
    expect(normalizeCopilotPrep(null)).toEqual({ checklist: [], talkingPoints: [], clipWatchFors: [] });
    expect(normalizeCopilotPrep({ checklist: Array.from({ length: 20 }, (_, i) => `c${i}`) }).checklist).toHaveLength(15);
  });

  it("normalizes clip moments on the rail's parseMoment rule: title AND description, max 7", () => {
    const moments = normalizeCopilotMoments({
      moments: [
        { timestampHint: "12:40", title: " The clutch ", description: " Comeback ", whyItWorks: "Payoff" },
        { timestampHint: "1:00", title: "No description" },
        { description: "No title" },
        "junk",
        { title: "Second", description: "Also real" },
      ],
    });
    expect(moments).toEqual([
      { timestampHint: "12:40", title: "The clutch", description: "Comeback", whyItWorks: "Payoff" },
      { timestampHint: "", title: "Second", description: "Also real", whyItWorks: "" },
    ]);
    expect(normalizeCopilotMoments({ moments: "nope" })).toEqual([]);
    expect(normalizeCopilotMoments(null)).toEqual([]);
  });
});

describe("the confirmed-spend door — the desk's honesty wiring", () => {
  it("both Copilot spends ride confirmedFetch on the seam paths at the seam prices", () => {
    /* The desk's post() helper is StreamCopilotSection's own shape:
       the call sites name the seam path, body builder, cost and
       feature; the helper hands them to the confirmed door. */
    expect(deskSrc).toContain("post(COPILOT_PREP_PATH, buildCopilotPrepBody({ streamTitle, topic, platform }), COPILOT_PREP_COST, COPILOT_PREP_FEATURE)");
    expect(deskSrc).toContain("post(COPILOT_CLIP_PLAN_PATH, buildCopilotClipPlanBody({ recap, topic }), COPILOT_CLIP_PLAN_COST, COPILOT_CLIP_PLAN_FEATURE)");
    expect(deskSrc).toContain("confirmedFetch(url, {");
    expect(deskSrc).toContain("overrideCost: cost");
    expect(deskSrc).toContain("overrideFeature: feature");
  });

  it("a declined confirmation spends nothing; a 402 reads as not-enough-Bucs with a balance refresh", () => {
    expect(deskSrc).toContain("if (!res) return null");
    expect(deskSrc).toContain('res.status === 402 || data.error === "out_of_credits"');
    expect(deskSrc).toContain("setOutOfCredits(true)");
    expect(deskSrc).toContain("refreshProfile()");
    expect(deskSrc).toContain('data-testid="world-live-copilot-ooc"');
    expect(deskSrc).toContain("nothing was charged");
  });

  it("approving a highlight cut rides the same door at the 200 VB override, with the 2D notes", () => {
    expect(deskSrc).toContain("confirmedFetch(HIGHLIGHT_APPROVE_PATH(streamId, p.id)");
    expect(deskSrc).toContain("overrideCost: HIGHLIGHT_CUT_COST_VB");
    expect(deskSrc).toContain("overrideFeature: HIGHLIGHT_CUT_FEATURE");
    expect(deskSrc).toContain("Cut cancelled — nothing was charged.");
    expect(deskSrc).toContain("Not enough Visual Bucs for that cut — the proposal stays right here.");
    expect(deskSrc).toContain("That cut didn't start. Try again in a moment.");
  });
});

describe("live prefs — the automation switches on their own rail", () => {
  const fullPrefs = {
    auto_highlights_enabled: true,
    stage_manager_enabled: true,
    stage_manager_pin_enabled: false,
    stage_manager_links_enabled: true,
    stage_manager_sting_enabled: false,
    stage_manager_flags_enabled: true,
    stage_manager_link_rules: [
      { keyword: "merch", label: "Merch store", url: "https://example.com/shop" },
      { keyword: 42, label: "broken", url: "https://example.com" },
      "junk",
    ],
  };

  it("normalizes the prefs DTO: booleans strict, broken rules dropped", () => {
    expect(normalizeLivePrefs(fullPrefs)).toEqual({
      auto_highlights_enabled: true,
      stage_manager_enabled: true,
      stage_manager_pin_enabled: false,
      stage_manager_links_enabled: true,
      stage_manager_sting_enabled: false,
      stage_manager_flags_enabled: true,
      stage_manager_link_rules: [{ keyword: "merch", label: "Merch store", url: "https://example.com/shop" }],
    });
    expect(normalizeLivePrefs(null).stage_manager_link_rules).toEqual([]);
    expect(normalizeLivePrefs({ stage_manager_enabled: "yes" }).stage_manager_enabled).toBe(false);
  });

  it("the PATCH body is the view verbatim (a copy, never the live state object)", () => {
    const view = normalizeLivePrefs(fullPrefs);
    const patch = buildLivePrefsPatch(view);
    expect(patch).toEqual(view);
    expect(patch).not.toBe(view);
    expect(patch.stage_manager_link_rules).not.toBe(view.stage_manager_link_rules);
  });

  it("RuleAdder's readiness rule and add-shape are the 2D desk's verbatim", () => {
    expect(linkRuleReady("merch", "Merch store", "https://example.com")).toBe(true);
    expect(linkRuleReady("m", "Merch store", "https://example.com")).toBe(false);
    expect(linkRuleReady("merch", "  ", "https://example.com")).toBe(false);
    expect(linkRuleReady("merch", "Merch store", "ftp://example.com")).toBe(false);
    expect(linkRuleReady(" merch ", " Label ", " http://example.com ")).toBe(true);
    expect(buildLinkRule("  MERCH ", " Merch store ", " https://example.com/shop "))
      .toEqual({ keyword: "merch", label: "Merch store", url: "https://example.com/shop" });
    expect(LINK_RULES_UI_MAX).toBe(10);
    expect(stage2dSrc).toContain("stage_manager_link_rules.length < 10");
  });

  it("the desk reads and saves prefs on the rail, switches wired to the view's fields", () => {
    expect(deskSrc).toContain("fetch(LIVE_PREFS_PATH");
    expect(deskSrc).toContain('method: "PATCH"');
    expect(deskSrc).toContain("JSON.stringify(buildLivePrefsPatch(prefs))");
    for (const field of [
      "stage_manager_enabled", "stage_manager_links_enabled", "stage_manager_pin_enabled",
      "stage_manager_sting_enabled", "stage_manager_flags_enabled", "auto_highlights_enabled",
    ]) {
      expect(deskSrc).toContain(`patchPrefs({ ${field}: !prefs.${field} })`);
    }
    expect(deskSrc).toContain("Co-host settings saved.");
    expect(deskSrc).toContain('data-testid="world-live-stage-save-prefs"');
  });
});

describe("the per-stream stage desk — state, proposals, roster", () => {
  it("normalizes my streams and picks the live one first, like the 2D picker", () => {
    const rows = normalizeMyStreams({
      streams: [
        { id: "a", title: "Old show", status: "ended", is_class: false, ticket_price_vb: null, class_course_product_id: null, has_vod: true },
        { id: "b", title: "On air", status: "live", is_class: true, ticket_price_vb: 500, class_course_product_id: "prod1", has_vod: false },
        { title: "no id" },
      ],
    });
    expect(rows).toEqual([
      { id: "a", title: "Old show", status: "ended", isClass: false, ticketPriceVb: null, classCourseProductId: null, hasVod: true },
      { id: "b", title: "On air", status: "live", isClass: true, ticketPriceVb: 500, classCourseProductId: "prod1", hasVod: false },
    ]);
    expect(initialStageStreamId(rows)).toBe("b");
    expect(initialStageStreamId([rows[0]!])).toBe("a");
    expect(initialStageStreamId([])).toBe("");
  });

  it("normalizes the stage state: muted, the active pin, the trouble flags", () => {
    expect(normalizeStageState({
      muted: true,
      stagePinned: { message: { body: "Big tip thanks!", author: { displayName: "Fan One" } }, pinnedUntil: "2026-11-04T10:00:00.000Z" },
      flags: [
        { at: "2026-11-04T09:00:00.000Z", reason: "Spam burst", messageId: "m1" },
        { at: "2026-11-04T09:05:00.000Z", reason: "Slur in chat", messageId: null },
        { reason: "no timestamp" },
      ],
    })).toEqual({
      muted: true,
      stagePinned: { body: "Big tip thanks!", authorName: "Fan One", pinnedUntil: "2026-11-04T10:00:00.000Z" },
      flags: [
        { at: "2026-11-04T09:00:00.000Z", reason: "Spam burst", messageId: "m1" },
        { at: "2026-11-04T09:05:00.000Z", reason: "Slur in chat", messageId: null },
      ],
    });
    expect(normalizeStageState(null)).toEqual({ muted: false, stagePinned: null, flags: [] });
  });

  it("normalizes proposals: unknown statuses read as proposed, the clock is the 2D fmtClock", () => {
    expect(normalizeHighlightProposals({
      proposals: [
        { id: "p1", start_sec: 65, end_sec: 125, title: "Clutch", reason: "Chat spike", status: "posted", output_url: "https://cdn.example/clip.mp4" },
        { id: "p2", start_sec: 0, end_sec: 30, title: "Intro pop", reason: "Tips", status: "weird", output_url: null },
        { start_sec: 1 },
      ],
    })).toEqual([
      { id: "p1", startSec: 65, endSec: 125, title: "Clutch", reason: "Chat spike", status: "posted", outputUrl: "https://cdn.example/clip.mp4" },
      { id: "p2", startSec: 0, endSec: 30, title: "Intro pop", reason: "Tips", status: "proposed", outputUrl: null },
    ]);
    expect(highlightClock(0)).toBe("0:00");
    expect(highlightClock(65)).toBe("1:05");
    expect(highlightClock(600)).toBe("10:00");
  });

  it("normalizes the class roster on its ticket ids", () => {
    expect(normalizeClassRoster({
      roster: [
        { user_id: "u1", display_name: "Student One", ticket_id: "t1", price_vb: 500, purchased_at: "2026-11-01T12:00:00.000Z" },
        { user_id: "u2", display_name: "No ticket id" },
      ],
    })).toEqual([
      { userId: "u1", displayName: "Student One", ticketId: "t1", priceVb: 500, purchasedAt: "2026-11-01T12:00:00.000Z" },
    ]);
    expect(normalizeClassRoster(null)).toEqual([]);
  });

  it("the desk wires every per-stream rail and carries the desk's testids", () => {
    expect(deskSrc).toContain("fetch(MY_STREAMS_PATH");
    expect(deskSrc).toContain("fetch(STAGE_MANAGER_PATH(streamId)");
    expect(deskSrc).toContain("fetch(STAGE_MANAGER_MUTE_PATH(streamId)");
    expect(deskSrc).toContain("JSON.stringify({ muted: !stage.muted })");
    expect(deskSrc).toContain("fetch(STAGE_MANAGER_UNPIN_PATH(streamId)");
    expect(deskSrc).toContain("fetch(HIGHLIGHTS_PATH(streamId)");
    expect(deskSrc).toContain("fetch(HIGHLIGHT_DISMISS_PATH(streamId, p.id)");
    expect(deskSrc).toContain("fetch(HIGHLIGHT_REFRESH_PATH(streamId, p.id)");
    expect(deskSrc).toContain("fetch(CLASS_ROSTER_PATH(streamId)");
    /* The two card testids ride the DeskCard testId prop; the mode
       tabs ride a template, exactly as the wave-III pins treat the
       bg pickers' per-option testids. */
    expect(deskSrc).toContain('testId="world-live-copilot"');
    expect(deskSrc).toContain('testId="world-live-stage"');
    expect(deskSrc).toContain("`world-live-copilot-tab-${key}`");
    for (const testid of [
      "world-live-copilot-prep-go", "world-live-copilot-clips-go",
      "world-live-stage-stream", "world-live-stage-flags",
      "world-live-stage-proposals", "world-live-stage-roster", "world-live-stage-note",
    ]) {
      expect(deskSrc).toContain(`data-testid="${testid}"`);
    }
  });

  it("states the peace law on the desk: flags are the creator's call, the co-host never acts on a person", () => {
    expect(deskSrc).toContain("flags trouble for YOUR call");
    expect(deskSrc).toContain("It never kicks, mutes, or locks anyone");
    expect(deskSrc).toContain("Trouble flags — your call");
  });
});

describe("placement — its own desk in the members-only panel; waves I–III untouched", () => {
  it("docks in LiveDesksPanel after the shopping desk, inside the world-live-desks frame", () => {
    expect(livePanelSrc).toContain('import { LiveCopilotDesk } from "./LiveCopilotDesk";');
    expect(livePanelSrc).toContain("<LiveCopilotDesk");
    expect(livePanelSrc.indexOf("<LiveCopilotDesk")).toBeGreaterThan(livePanelSrc.indexOf("<LiveShoppingDesk"));
    expect(livePanelSrc).toContain('data-testid="world-live-desks"');
  });

  it("LiveDesk.tsx stays free of the charged machinery — the wave I–III pins keep their meaning", () => {
    expect(liveDeskSrc).not.toContain("confirmedFetch");
    expect(liveDeskSrc).not.toContain("stream-copilot");
    expect(liveDeskSrc).not.toContain("live-prefs");
  });

  it("no flow completes by linking out to the 2D studio", () => {
    expect(deskSrc).not.toContain('"/go-live"');
    expect(deskSrc).not.toContain('href="/go-live"');
  });

  it("the board records the wave-IV promotion", () => {
    /* Join widening (stack100 phase-2): the wave-IV board carries
       every wave-IV lane's entry — this lane's entry is found by
       containment, not by sole occupancy of the board. */
    const mine = LIVE_WAVE4_PROMOTIONS.filter((entry) => entry.includes("Copilot"));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toContain("/api/live-prefs");
  });
});
