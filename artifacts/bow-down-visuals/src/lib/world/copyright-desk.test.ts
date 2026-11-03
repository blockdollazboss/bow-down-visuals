/**
 * copyright-desk — stack1500 world parity wave #3 item 23
 * pins. The Copyright desk is the assistant's native form.
 * These pins hold: both prices come from the registry at 100
 * with the registry's own feature names, matching the route's
 * env-fallback constants; the draft payload requires a title
 * and a known work type, trims + caps every field at the
 * schema's limits, and only sends a publication date when
 * the work is published; the ask payload caps history at the
 * schema's 12; the draft guard needs the description (the
 * page's bar) and keeps filing notes as clean strings; the
 * disclaimer is the page's own words.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  COPYRIGHT_ASK_COST,
  COPYRIGHT_ASK_PATH,
  COPYRIGHT_DISCLAIMER,
  COPYRIGHT_DRAFT_COST,
  COPYRIGHT_DRAFT_PATH,
  COPYRIGHT_WORK_TYPES,
  buildCopyrightAskPayload,
  buildCopyrightDraftPayload,
  copyrightAnswerOf,
  copyrightDraftOf,
  type CopyrightDraftForm,
} from "./copyright-desk";
import { getCreditCost } from "../credit-costs";

const apiSrc = (rel: string) =>
  readFileSync(new URL(`../../../../api-server/src/${rel}`, import.meta.url), "utf8");

const FORM: CopyrightDraftForm = {
  workType: "song",
  title: "Crown Heavy",
  authors: "Thy Cheat Code",
  creationDate: "2026-03-14",
  published: true,
  publishedDate: "2026-04-01",
  notes: "Beat leased non-exclusively.",
};

describe("prices — registry-pinned, route-matched", () => {
  it("draft and ask are both 100 from the registry, route constants agree", () => {
    expect(getCreditCost(COPYRIGHT_DRAFT_PATH)).toMatchObject({ feature: "Copyright Filing Draft", cost: 100 });
    expect(getCreditCost(COPYRIGHT_ASK_PATH)).toMatchObject({ feature: "Copyright Answer", cost: 100 });
    expect(COPYRIGHT_DRAFT_COST).toBe(100);
    expect(COPYRIGHT_ASK_COST).toBe(100);
    const route = apiSrc("routes/generate/copyright.ts");
    expect(route).toContain('COPYRIGHT_DRAFT_CREDITS = Number(process.env["COPYRIGHT_DRAFT_CREDIT_COST"]) || 100');
    expect(route).toContain('COPYRIGHT_ASK_CREDITS = Number(process.env["COPYRIGHT_ASK_CREDIT_COST"]) || 100');
  });
});

describe("payloads", () => {
  it("the draft payload trims, caps, and gates the publication date on published", () => {
    expect(buildCopyrightDraftPayload(FORM)).toEqual(FORM);
    expect(buildCopyrightDraftPayload({ ...FORM, published: false })?.["publishedDate"]).toBe("");
    expect(buildCopyrightDraftPayload({ ...FORM, title: "  " })).toBeNull();
    expect(buildCopyrightDraftPayload({ ...FORM, workType: "painting" })).toBeNull();
    const capped = buildCopyrightDraftPayload({ ...FORM, title: "x".repeat(300) })!;
    expect((capped["title"] as string).length).toBe(200);
    expect(COPYRIGHT_WORK_TYPES.map((t) => t.key)).toEqual([
      "song",
      "sound-recording",
      "lyrics",
      "music-video",
      "album",
    ]);
  });

  it("the ask payload caps history at the schema's 12", () => {
    const history = Array.from({ length: 15 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `m${i}`,
    }));
    const body = buildCopyrightAskPayload(" Who owns the master? ", history);
    expect(body.question).toBe("Who owns the master?");
    expect(body.history).toHaveLength(12);
  });
});

describe("response guards", () => {
  it("a draft needs its description; notes stay clean strings", () => {
    const draft = copyrightDraftOf({
      description: " An original musical composition… ",
      filingNotes: ["File as a musical composition.", "", 42],
    })!;
    expect(draft.description).toBe("An original musical composition…");
    expect(draft.filingNotes).toEqual(["File as a musical composition."]);
    expect(copyrightDraftOf({ description: " " })).toBeNull();
    expect(copyrightAnswerOf({ answer: "The writer does." })).toBe("The writer does.");
    expect(copyrightAnswerOf({})).toBeNull();
  });

  it("the disclaimer is the page's own words", () => {
    expect(COPYRIGHT_DISCLAIMER).toContain("is not a law firm and this page is not legal advice");
    expect(COPYRIGHT_DISCLAIMER).toContain("intellectual property attorney");
  });
});
