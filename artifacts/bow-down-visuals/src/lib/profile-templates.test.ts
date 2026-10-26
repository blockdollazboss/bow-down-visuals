/**
 * Unit tests for the profile-template client helpers (Stack-200):
 * the smart shelf order, the approval read-back (draftChanges), and
 * the draft summary line. The contract: the shelf leads with the fit
 * for the creator's own lane without applying anything, and the
 * approve button's read-back names exactly what will change.
 */
import { describe, it, expect } from "vitest";
import {
  templateShelfOrder,
  draftChanges,
  draftSummary,
  type ProfileBlockDto,
  type ProfileTemplateDefDto,
  type ProfileTemplateDraftDto,
} from "./profile-website";

const block = (type: string, title = type, visible = true): ProfileBlockDto => ({
  type, title, visible, config: {},
});

const tpl = (id: string): ProfileTemplateDefDto => ({
  id,
  name: id,
  tagline: "",
  bestFor: [],
  colorway: "royal-gold",
  headingFont: "Cinzel",
  bodyFont: "Inter",
  layout: [],
});

const SHELF = ["stage", "booth", "gallery", "broadcast", "press-kit", "after-dark"].map(tpl);

describe("templateShelfOrder", () => {
  it("leads with the recommended fit, flagship second, rest in shelf order", () => {
    const ordered = templateShelfOrder(SHELF, "booth").map((t) => t.id);
    expect(ordered).toEqual(["booth", "stage", "gallery", "broadcast", "press-kit", "after-dark"]);
  });

  it("keeps the flagship first when it is itself the recommendation", () => {
    const ordered = templateShelfOrder(SHELF, "stage").map((t) => t.id);
    expect(ordered[0]).toBe("stage");
    expect(ordered).toHaveLength(6);
  });

  it("does not mutate the shelf it was given", () => {
    const before = SHELF.map((t) => t.id);
    templateShelfOrder(SHELF, "gallery");
    expect(SHELF.map((t) => t.id)).toEqual(before);
  });
});

describe("draftChanges — the approval read-back", () => {
  const live = [block("hero", "Featured"), block("spotlight", "The Stage"), block("tracks", "Music"), block("store", "Store")];

  it("names added and removed categories by their titles", () => {
    const draft = [block("hero", "Featured"), block("spotlight", "The Stage"), block("videos", "Videos"), block("store", "Store")];
    const c = draftChanges(live, draft);
    expect(c.added).toEqual(["Videos"]);
    expect(c.removed).toEqual(["Music"]);
    expect(c.reordered).toBe(false);
  });

  it("detects a pure reorder of the shared categories", () => {
    const draft = [block("hero", "Featured"), block("store", "Store"), block("spotlight", "The Stage"), block("tracks", "Music")];
    const c = draftChanges(live, draft);
    expect(c.added).toEqual([]);
    expect(c.removed).toEqual([]);
    expect(c.reordered).toBe(true);
  });

  it("an identical draft changes nothing", () => {
    const c = draftChanges(live, [...live]);
    expect(c).toEqual({ added: [], removed: [], reordered: false });
  });
});

describe("draftSummary", () => {
  it("reads name, visible block count, colorway name and fonts", () => {
    const draft: ProfileTemplateDraftDto = {
      templateId: "booth",
      layout: [block("hero"), block("tracks"), block("videos", "Videos", false)],
      colorway: "stage-lights",
      headingFont: "Bebas Neue",
      bodyFont: "Inter",
      source: "template",
      ops: [],
      updatedAt: "2026-10-25T00:00:00.000Z",
    };
    const templates = [{ ...tpl("booth"), name: "Booth" }];
    const s = draftSummary(draft, templates, (id) => (id === "stage-lights" ? "Stage Lights" : undefined));
    expect(s).toBe("Booth — 2 blocks · Stage Lights · Bebas Neue / Inter");
  });
});
