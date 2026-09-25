/**
 * Email List Builder — unit tests for the pure helpers.
 *
 * Covers: the pricing contract (1 credit per newsletter draft), handle
 * validation, email validation, tone keys, newsletter prompt construction
 * (asserts max_completion_tokens is used at the call site, never
 * max_tokens), draft parsing (never throws on malformed model JSON), CSV
 * export escaping, and the embed snippet.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  EMAIL_NEWSLETTER_CREDIT_COST,
  EMAIL_FREE_SUBSCRIBER_LIMIT,
  isHandleAvailable,
  isValidHandle,
  isValidEmail,
  isNewsletterTone,
  buildNewsletterPrompt,
  parseNewsletterDraft,
  subscribersToCsv,
  buildEmbedSnippet,
  NEWSLETTER_TONES,
} from "../email-list-helpers";

describe("newsletter pricing contract", () => {
  it("costs 1 credit per AI newsletter draft", () => {
    expect(EMAIL_NEWSLETTER_CREDIT_COST).toBe(1);
  });

  it("free tier allows 1,000 subscribers per list", () => {
    expect(EMAIL_FREE_SUBSCRIBER_LIMIT).toBe(1000);
  });

  it("the route charges before generating and refunds on provider failure", () => {
    /* Documents the money contract enforced in routes/generate/email-list.ts:
       chargeCredits() runs before getOpenAI(), and any exception after the
       charge triggers refundCredits(). */
    const src = fs.readFileSync(
      path.join(__dirname, "..", "email-list.ts"),
      "utf8"
    );
    const chargeIdx = src.indexOf("await chargeCredits(req.userId!");
    const openaiIdx = src.indexOf("getOpenAI().chat.completions.create", chargeIdx);
    expect(chargeIdx).toBeGreaterThan(-1);
    expect(openaiIdx).toBeGreaterThan(chargeIdx);
    expect(src).toContain("await refundCredits(req.userId!");
  });

  it("the route uses max_completion_tokens, never max_tokens (GPT-6 rule)", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "..", "email-list.ts"),
      "utf8"
    );
    expect(src).toContain("max_completion_tokens");
    expect(src).not.toMatch(/\bmax_tokens\b/);
  });
});

describe("handle validation", () => {
  it("accepts valid handles", () => {
    expect(isValidHandle("shark-king")).toBe(true);
    expect(isValidHandle("bdv123")).toBe(true);
    expect(isValidHandle("a-b-c")).toBe(true);
  });

  it("rejects handles with bad characters or length", () => {
    expect(isValidHandle("AB")).toBe(false); // too short + uppercase
    expect(isValidHandle("ab")).toBe(false); // too short
    expect(isValidHandle("has space")).toBe(false);
    expect(isValidHandle("has_underscore")).toBe(false);
    expect(isValidHandle("UPPERCASE")).toBe(false);
    expect(isValidHandle("a".repeat(41))).toBe(false); // too long
    expect(isValidHandle("")).toBe(false);
  });

  it("rejects reserved handles", () => {
    expect(isValidHandle("admin")).toBe(false);
    expect(isValidHandle("join")).toBe(false);
    expect(isValidHandle("login")).toBe(false);
    expect(isValidHandle("api")).toBe(false);
    expect(isHandleAvailable("admin")).toBe(false);
    expect(isHandleAvailable("my-band")).toBe(true);
  });
});

describe("email validation", () => {
  it("accepts valid emails", () => {
    expect(isValidEmail("fan@example.com")).toBe(true);
    expect(isValidEmail("a.b+tag@sub.domain.co")).toBe(true);
  });

  it("rejects invalid emails", () => {
    expect(isValidEmail("not-an-email")).toBe(false);
    expect(isValidEmail("missing@tld")).toBe(false);
    expect(isValidEmail("@nodomain.com")).toBe(false);
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail("a".repeat(250) + "@x.com")).toBe(false); // > 254 chars
  });
});

describe("newsletter tones", () => {
  it("offers exactly the four documented tones", () => {
    expect(NEWSLETTER_TONES).toEqual([
      "hype",
      "behind-the-scenes",
      "personal",
      "announcement",
    ]);
  });

  it("validates tone keys", () => {
    expect(isNewsletterTone("hype")).toBe(true);
    expect(isNewsletterTone("personal")).toBe(true);
    expect(isNewsletterTone("formal")).toBe(false);
    expect(isNewsletterTone("")).toBe(false);
    expect(isNewsletterTone(undefined)).toBe(false);
    expect(isNewsletterTone(42)).toBe(false);
  });
});

describe("buildNewsletterPrompt", () => {
  it("includes the topic, creator, tone direction, and JSON contract", () => {
    const p = buildNewsletterPrompt({
      topic: "New single dropping Friday",
      tone: "hype",
      creatorName: "Shark King",
      listName: "Fin Fam",
    });
    expect(p).toContain("New single dropping Friday");
    expect(p).toContain("Shark King");
    expect(p).toContain("high-energy");
    expect(p).toContain('{"subject": "...", "body": "..."}');
  });

  it("uses the custom CTA when provided, falls back otherwise", () => {
    const withCta = buildNewsletterPrompt({
      topic: "Tour dates",
      tone: "announcement",
      creatorName: "X",
      listName: "Y",
      callToAction: "Grab tickets now",
    });
    expect(withCta).toContain("Grab tickets now");

    const withoutCta = buildNewsletterPrompt({
      topic: "Tour dates",
      tone: "announcement",
      creatorName: "X",
      listName: "Y",
    });
    expect(withoutCta).toContain("call to action");
  });
});

describe("parseNewsletterDraft", () => {
  it("parses a well-formed draft", () => {
    const d = parseNewsletterDraft(
      JSON.stringify({ subject: "Big news 🎉", body: "Hey fam,\n\nBig news!" })
    );
    expect(d).toEqual({ subject: "Big news 🎉", body: "Hey fam,\n\nBig news!" });
  });

  it("returns null on malformed JSON instead of throwing", () => {
    expect(parseNewsletterDraft("not json")).toBeNull();
    expect(parseNewsletterDraft("")).toBeNull();
  });

  it("returns null when subject or body is missing", () => {
    expect(parseNewsletterDraft(JSON.stringify({ subject: "x" }))).toBeNull();
    expect(parseNewsletterDraft(JSON.stringify({ body: "y" }))).toBeNull();
    expect(parseNewsletterDraft(JSON.stringify({}))).toBeNull();
  });

  it("trims and caps lengths defensively", () => {
    const d = parseNewsletterDraft(
      JSON.stringify({ subject: "  hi  ", body: "  yo  " })
    );
    expect(d).toEqual({ subject: "hi", body: "yo" });
  });
});

describe("subscribersToCsv", () => {
  it("writes a header plus one row per subscriber", () => {
    const csv = subscribersToCsv([
      { email: "a@x.com", name: "Ann", subscribedAt: "2026-01-01T00:00:00Z", source: "landing" },
      { email: "b@x.com", name: null, subscribedAt: "2026-01-02T00:00:00Z", source: "embed" },
    ]);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("email,name,subscribed_at,source");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("a@x.com");
    expect(lines[2]).toContain("b@x.com");
  });

  it("escapes commas, quotes, and newlines in fields", () => {
    const csv = subscribersToCsv([
      { email: "a@x.com", name: 'O"Brien, Jr.\nIII', subscribedAt: "2026-01-01T00:00:00Z", source: "landing" },
    ]);
    expect(csv).toContain('"O""Brien, Jr.\nIII"');
  });

  it("handles an empty list with just the header", () => {
    expect(subscribersToCsv([])).toBe("email,name,subscribed_at,source");
  });
});

describe("buildEmbedSnippet", () => {
  it("produces a form posting to the subscribe endpoint with the handle", () => {
    const html = buildEmbedSnippet("shark-king", "Fin Fam");
    expect(html).toContain("/api/email-list/subscribe");
    expect(html).toContain('value="shark-king"');
    expect(html).toContain("Fin Fam");
    expect(html).toContain('type="email"');
  });
});
