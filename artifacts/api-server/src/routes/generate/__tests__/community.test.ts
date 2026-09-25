/**
 * Tests for the AI Community Manager endpoints' pure logic.
 *
 * Covers: pricing constants (1cr/50 moderated, 1cr per report/scan/draft),
 * request validation schemas, moderation JSON parsing (good, malformed,
 * empty, out-of-range indexes), and the no-max_tokens rule on prompts.
 */
import { describe, expect, it } from "vitest";
import {
  COMMUNITY_MODERATE_CREDITS,
  COMMUNITY_MODERATE_BATCH,
  COMMUNITY_SENTIMENT_CREDITS,
  COMMUNITY_SUPERFAN_CREDITS,
  COMMUNITY_REPLY_CREDITS,
  moderateCreditCost,
  moderateSchema,
  replyDraftSchema,
  sentimentSchema,
  superfanSchema,
  parseModerationJson,
  buildModerateSystemPrompt,
  buildReplySystemPrompt,
  buildSentimentSystemPrompt,
  buildSuperfanSystemPrompt,
} from "../community";

describe("pricing constants", () => {
  it("charges 1 credit per 50 comments moderated", () => {
    expect(COMMUNITY_MODERATE_CREDITS).toBe(1);
    expect(COMMUNITY_MODERATE_BATCH).toBe(50);
  });

  it("scales moderation cost by batch", () => {
    expect(moderateCreditCost(1)).toBe(1);
    expect(moderateCreditCost(50)).toBe(1);
    expect(moderateCreditCost(51)).toBe(2);
    expect(moderateCreditCost(100)).toBe(2);
    expect(moderateCreditCost(0)).toBe(0);
  });

  it("charges 1 credit per sentiment report / superfan scan / reply batch", () => {
    expect(COMMUNITY_SENTIMENT_CREDITS).toBe(1);
    expect(COMMUNITY_SUPERFAN_CREDITS).toBe(1);
    expect(COMMUNITY_REPLY_CREDITS).toBe(1);
  });
});

describe("moderateSchema", () => {
  it("accepts a valid comment batch", () => {
    const r = moderateSchema.safeParse({
      comments: [{ author: "fan1", text: "love this!" }],
    });
    expect(r.success).toBe(true);
  });

  it("rejects an empty batch", () => {
    expect(moderateSchema.safeParse({ comments: [] }).success).toBe(false);
  });

  it("rejects more than 200 comments", () => {
    const comments = Array.from({ length: 201 }, (_, i) => ({
      author: `fan${i}`,
      text: "hi",
    }));
    expect(moderateSchema.safeParse({ comments }).success).toBe(false);
  });

  it("rejects a comment with empty text", () => {
    expect(
      moderateSchema.safeParse({ comments: [{ author: "fan", text: "" }] }).success,
    ).toBe(false);
  });

  it("defaults likes to 0", () => {
    const r = moderateSchema.safeParse({ comments: [{ author: "fan", text: "hi" }] });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.comments[0]!.likes).toBe(0);
  });
});

describe("replyDraftSchema", () => {
  it("accepts valid reply draft input with tone", () => {
    const r = replyDraftSchema.safeParse({
      comments: [{ author: "fan", text: "when's the album?" }],
      tone: "hype",
    });
    expect(r.success).toBe(true);
  });

  it("defaults tone to friendly", () => {
    const r = replyDraftSchema.safeParse({ comments: [{ author: "fan", text: "hi" }] });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.tone).toBe("friendly");
  });

  it("rejects an unknown tone", () => {
    expect(
      replyDraftSchema.safeParse({ comments: [{ author: "a", text: "b" }], tone: "rude" }).success,
    ).toBe(false);
  });

  it("rejects more than 20 comments for drafts", () => {
    const comments = Array.from({ length: 21 }, () => ({ author: "a", text: "b" }));
    expect(replyDraftSchema.safeParse({ comments }).success).toBe(false);
  });
});

describe("sentimentSchema / superfanSchema", () => {
  it("accepts valid sentiment input", () => {
    expect(
      sentimentSchema.safeParse({ comments: [{ author: "a", text: "great!" }] }).success,
    ).toBe(true);
  });

  it("accepts valid superfan input", () => {
    expect(
      superfanSchema.safeParse({ comments: [{ author: "a", text: "great!" }] }).success,
    ).toBe(true);
  });
});

describe("parseModerationJson", () => {
  it("parses a valid flag array", () => {
    const flags = parseModerationJson(
      JSON.stringify([
        { index: 1, author: "troll", text: "trash", verdict: "remove", reasons: ["harassment"], severity: 90 },
      ]),
      5,
    );
    expect(flags).toHaveLength(1);
    expect(flags[0]!.verdict).toBe("remove");
    expect(flags[0]!.severity).toBe(90);
  });

  it("returns [] on malformed JSON (never throws)", () => {
    expect(parseModerationJson("not json {{{", 5)).toEqual([]);
  });

  it("returns [] on non-array JSON", () => {
    expect(parseModerationJson('{"oops": true}', 5)).toEqual([]);
  });

  it("clamps out-of-range indexes", () => {
    const flags = parseModerationJson(
      JSON.stringify([{ index: 99, author: "x", text: "y", verdict: "review", reasons: [], severity: 10 }]),
      5,
    );
    expect(flags[0]!.index).toBe(4);
  });

  it("normalizes unknown verdicts to ok", () => {
    const flags = parseModerationJson(
      JSON.stringify([{ index: 0, author: "x", text: "y", verdict: "nuke", reasons: [], severity: 10 }]),
      5,
    );
    expect(flags[0]!.verdict).toBe("ok");
  });

  it("strips markdown fences before parsing", () => {
    const flags = parseModerationJson(
      '```json\n[{"index":0,"author":"x","text":"y","verdict":"review","reasons":["spam"],"severity":40}]\n```',
      3,
    );
    expect(flags).toHaveLength(1);
    expect(flags[0]!.verdict).toBe("review");
  });
});

describe("prompt builders", () => {
  it("moderation prompt stresses human review, never auto-delete", () => {
    const p = buildModerateSystemPrompt();
    expect(p).toMatch(/human review/i);
    expect(p).not.toMatch(/max_tokens/);
  });

  it("reply prompt includes tone and never uses max_tokens", () => {
    const p = buildReplySystemPrompt("hype", "SharkKing");
    expect(p).toContain("hype");
    expect(p).toContain("SharkKing");
    expect(p).not.toMatch(/max_tokens/);
  });

  it("sentiment prompt asks for risks and wins", () => {
    const p = buildSentimentSystemPrompt("this week");
    expect(p).toMatch(/risks/i);
    expect(p).toMatch(/wins/i);
  });

  it("superfan prompt caps at 10 and sorts by score", () => {
    const p = buildSuperfanSystemPrompt();
    expect(p).toMatch(/max 10/i);
  });
});
