/**
 * post-assist — Stack-100 #58.
 * "Write It For Me" in-world rides the 2D composer's own rail
 * (POST /api/posts/assist, 100 Visual Bucs past the monthly plan
 * boosts allowance, refunded on failure — stack300 plans-boosts).
 * These tests pin the shaping: the route's tone enum, its prompt
 * bounds, the draft parse, the boost-report parse, and the
 * composer's append-and-cap rule — plus source pins that both host
 * surfaces use the shared block and the confirmed-fetch pattern.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  POST_ASSIST_COST_VISUAL_BUCS,
  POST_ASSIST_PATH,
  POST_ASSIST_TONES,
  appendAssistDraft,
  buildPostAssistPayload,
  isPostAssistTone,
  parsePostAssistBoost,
  parsePostAssistDraft,
  postAssistPromptReady,
} from "./post-assist";

describe("post assist — the rail's own shape", () => {
  it("price and path are the registry's and the route's", () => {
    expect(POST_ASSIST_COST_VISUAL_BUCS).toBe(100);
    expect(POST_ASSIST_PATH).toBe("/api/posts/assist");
    expect(POST_ASSIST_TONES.map((t) => t.key)).toEqual(["hype", "chill", "professional", "funny"]);
    expect(isPostAssistTone("hype")).toBe(true);
    expect(isPostAssistTone("angry")).toBe(false);
  });

  it("prompt readiness mirrors the route's 3–300 char rule", () => {
    expect(postAssistPromptReady("ab")).toBe(false);
    expect(postAssistPromptReady("  new single Friday ")).toBe(true);
    expect(postAssistPromptReady("x".repeat(301))).toBe(false);
    expect(buildPostAssistPayload("  my drop  ", "chill")).toEqual({ prompt: "my drop", tone: "chill" });
  });

  it("draft parse takes only a real draft", () => {
    expect(parsePostAssistDraft({ draft: "  We live!  " })).toBe("We live!");
    expect(parsePostAssistDraft({ draft: "   " })).toBeNull();
    expect(parsePostAssistDraft({})).toBeNull();
    expect(parsePostAssistDraft(null)).toBeNull();
  });

  it("boost parse takes only the rail's real funding report", () => {
    expect(
      parsePostAssistBoost({ draft: "x", boost: { applied: true, allowance: 3, used: 1, remaining: 2 } }),
    ).toEqual({ applied: true, allowance: 3, used: 1, remaining: 2 });
    expect(
      parsePostAssistBoost({ boost: { applied: false, allowance: 25, used: 25, remaining: 0 } }),
    ).toEqual({ applied: false, allowance: 25, used: 25, remaining: 0 });
    /* No report (older build / ledger unreadable) → null, never a guess. */
    expect(parsePostAssistBoost({ draft: "x", boost: null })).toBeNull();
    expect(parsePostAssistBoost({ draft: "x" })).toBeNull();
    expect(parsePostAssistBoost({ boost: { applied: "yes", allowance: 3, used: 1, remaining: 2 } })).toBeNull();
    expect(parsePostAssistBoost({ boost: { applied: true, allowance: 3, used: 1 } })).toBeNull();
    expect(parsePostAssistBoost(null)).toBeNull();
  });

  it("append matches the 2D composer: blank line between, capped at 500", () => {
    expect(appendAssistDraft("", "Fresh words")).toBe("Fresh words");
    expect(appendAssistDraft("My intro", "Fresh words")).toBe("My intro\n\nFresh words");
    expect(appendAssistDraft("x".repeat(490), "y".repeat(50))).toHaveLength(500);
  });
});

describe("post assist — both homes ride the shared block (source pins)", () => {
  const block = readFileSync(new URL("../../components/world/native/PostAssist.tsx", import.meta.url), "utf8");
  const social = readFileSync(new URL("../../components/world/native/SocialDesk.tsx", import.meta.url), "utf8");
  const business = readFileSync(new URL("../../components/world/native/BusinessDesks.tsx", import.meta.url), "utf8");

  it("the block charges through the confirmation pattern and never posts", () => {
    expect(block).toContain("confirmedFetch(POST_ASSIST_PATH");
    expect(block).toContain('data-testid="world-post-assist"');
    expect(block).not.toContain('"/api/posts"');
    expect(block).not.toContain("POSTS_PATH");
  });

  it("the feed composer hosts it and posts on the feed rail", () => {
    expect(social).toContain("<PostAssistBlock");
    expect(social).toContain('data-testid="world-feed-composer"');
    expect(social).toContain("appendAssistDraft(b, draft)");
  });

  it("the Promote Room hosts it and hands the draft to the Scheduler", () => {
    expect(business).toContain("<PostAssistBlock");
    expect(business).toContain('data-testid="world-promote-assist-schedule"');
    expect(business).toContain("setCardPrefill({ mediaUrl: \"\", mediaType: \"video\", caption: assistDraft })");
  });
});
