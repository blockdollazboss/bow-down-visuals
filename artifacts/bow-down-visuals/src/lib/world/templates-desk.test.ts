import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import {
  TEMPLATE_GALLERIES,
  VIDEO_TEMPLATES_PATH,
  VIDEO_TEMPLATE_APPLY_PATH,
  VIDEO_TEMPLATE_UPLOAD_MAX_BYTES,
  buildVideoTemplateApplyBody,
  filterTemplateCards,
  interpretTemplateJob,
  missingSlotLabels,
  parseVideoTemplateCatalog,
  slotAcceptsMedia,
  templateCards,
  templateCategories,
  templateGalleryCount,
  templateUseTarget,
  videoTemplateApplyCost,
  videoTemplateApplyFeature,
  videoTemplateJobPath,
  videoTemplatePrefill,
  type VideoTemplateCatalogEntry,
} from "./templates-desk";
import {
  parsePanelPayloadFor,
  hookTemplatePayload,
  videoTemplatePayload,
} from "./panel-payload";
import { HOOK_TEMPLATES, HOOK_CATEGORIES } from "../../data/hook-templates";
import { CAPTION_PACKS, CAPTION_CATEGORIES } from "../../data/caption-templates";
import { THUMBNAIL_TEMPLATES, THUMBNAIL_CATEGORIES } from "../../data/thumbnail-templates";
import {
  VIDEO_TEMPLATE_METAS,
  VIDEO_TEMPLATE_CATEGORIES,
  VIDEO_TEMPLATE_APPLY_COST,
  getVideoTemplateMeta,
} from "../../data/video-templates";
import { getHookTemplate } from "../../data/hook-templates";
import { getCaptionPack } from "../../data/caption-templates";
import { getThumbnailTemplate } from "../../data/thumbnail-templates";
import { CREDIT_COSTS } from "../credit-costs";

const feSrc = (rel: string) => readFileSync(resolve(process.cwd(), "src", rel), "utf8");
const apiSrc = (rel: string) =>
  readFileSync(resolve(process.cwd(), "../api-server/src", rel), "utf8");

describe("the browse desk reads the SAME catalogs as the 2D hub", () => {
  it("carries all four galleries, in the hub's shape", () => {
    expect(TEMPLATE_GALLERIES.map((g) => g.id)).toEqual([
      "videos",
      "hooks",
      "captions",
      "thumbnails",
    ]);
  });

  it("every gallery's cards come from its own data library — same count, same order, same slugs", () => {
    expect(templateCards("videos").map((c) => c.slug)).toEqual(
      VIDEO_TEMPLATE_METAS.map((t) => t.key),
    );
    expect(templateCards("hooks").map((c) => c.slug)).toEqual(
      HOOK_TEMPLATES.map((t) => t.slug),
    );
    expect(templateCards("captions").map((c) => c.slug)).toEqual(
      CAPTION_PACKS.map((t) => t.slug),
    );
    expect(templateCards("thumbnails").map((c) => c.slug)).toEqual(
      THUMBNAIL_TEMPLATES.map((t) => t.slug),
    );
    expect(templateGalleryCount("videos")).toBe(VIDEO_TEMPLATE_METAS.length);
  });

  it("card text is the library's own text — title, blurb, category copied, never rewritten", () => {
    const v = templateCards("videos")[0]!;
    const meta = VIDEO_TEMPLATE_METAS[0]!;
    expect(v.title).toBe(meta.name);
    expect(v.blurb).toBe(meta.tagline);
    expect(v.category).toBe(meta.category);
    expect(v.detail).toBe(meta.outcome);
    expect(v.meta).toContain(meta.aspect);
    const h = templateCards("hooks")[0]!;
    expect(h.title).toBe(HOOK_TEMPLATES[0]!.title);
    expect(h.blurb).toBe(HOOK_TEMPLATES[0]!.blurb);
    expect(h.detail).toBeNull();
  });

  it("category chips are each library's own category list", () => {
    expect(templateCategories("videos")).toEqual([...VIDEO_TEMPLATE_CATEGORIES]);
    expect(templateCategories("hooks")).toEqual([...HOOK_CATEGORIES]);
    expect(templateCategories("captions")).toEqual([...CAPTION_CATEGORIES]);
    expect(templateCategories("thumbnails")).toEqual([...THUMBNAIL_CATEGORIES]);
  });

  it("category filtering is exact, and 'All' passes the whole gallery", () => {
    for (const gallery of TEMPLATE_GALLERIES.map((g) => g.id)) {
      const all = filterTemplateCards(gallery, "All", "");
      expect(all).toHaveLength(templateGalleryCount(gallery));
      const cats = templateCategories(gallery).filter((c) => c !== "All");
      for (const cat of cats.slice(0, 3)) {
        const filtered = filterTemplateCards(gallery, cat, "");
        expect(filtered.length).toBeGreaterThan(0);
        expect(filtered.every((c) => c.category === cat)).toBe(true);
      }
      expect(filterTemplateCards(gallery, "No Such Category", "")).toEqual([]);
    }
  });

  it("search finds by the library's own words and honestly returns none for nonsense", () => {
    const firstMeta = VIDEO_TEMPLATE_METAS[0]!;
    const byName = filterTemplateCards("videos", "All", firstMeta.name.split(" ")[0]!);
    expect(byName.map((c) => c.slug)).toContain(firstMeta.key);
    expect(filterTemplateCards("videos", "All", "zzzqqq-nothing")).toEqual([]);
    const hook = HOOK_TEMPLATES[0]!;
    const hookHit = filterTemplateCards("hooks", "All", hook.title.split(" ")[0]!);
    expect(hookHit.map((c) => c.slug)).toContain(hook.slug);
  });
});

describe("the Use handoff — payloads land on the owning desk and resolve there", () => {
  it("routes each gallery to its owning station with its own payload kind", () => {
    expect(templateUseTarget(templateCards("videos")[0]!)).toMatchObject({
      stationId: "video-desk",
      payload: { kind: "video-template" },
    });
    expect(templateUseTarget(templateCards("hooks")[0]!)).toMatchObject({
      stationId: "hook-desk",
      payload: { kind: "hook-template" },
    });
    expect(templateUseTarget(templateCards("captions")[0]!)).toMatchObject({
      stationId: "hook-desk",
      payload: { kind: "caption-pack" },
    });
    expect(templateUseTarget(templateCards("thumbnails")[0]!)).toMatchObject({
      stationId: "thumbnail-desk",
      payload: { kind: "thumbnail-template" },
    });
  });

  it("every card in every gallery produces a payload its station accepts, resolving to that exact entry", () => {
    for (const gallery of TEMPLATE_GALLERIES.map((g) => g.id)) {
      for (const card of templateCards(gallery)) {
        const target = templateUseTarget(card);
        const parsed = parsePanelPayloadFor(target.stationId, target.payload);
        expect(parsed).not.toBeNull();
        expect(parsed!.templateSlug).toBe(card.slug);
        if (gallery === "videos") expect(getVideoTemplateMeta(card.slug)).not.toBeNull();
        if (gallery === "hooks") expect(getHookTemplate(card.slug)).toBeDefined();
        if (gallery === "captions") expect(getCaptionPack(card.slug)).toBeDefined();
        if (gallery === "thumbnails") expect(getThumbnailTemplate(card.slug)).toBeDefined();
      }
    }
  });

  it("payloads carry no price — the handoff is a reference, never money", () => {
    for (const card of templateCards("videos").slice(0, 3)) {
      const { payload } = templateUseTarget(card);
      expect(Object.values(payload).some((v) => typeof v === "number")).toBe(false);
    }
  });
});

describe("the bench's deep link — videoTemplatePrefill", () => {
  it("resolves a real catalog key handed as a payload", () => {
    const key = VIDEO_TEMPLATE_METAS[0]!.key;
    expect(videoTemplatePrefill(videoTemplatePayload(key))).toBe(key);
  });

  it("refuses everything else — unknown keys, other kinds, garbage, no payload", () => {
    expect(videoTemplatePrefill(videoTemplatePayload("no-such-template"))).toBeNull();
    expect(videoTemplatePrefill(hookTemplatePayload("x"))).toBeNull();
    expect(videoTemplatePrefill({ kind: "video-template", templateSlug: 42 })).toBeNull();
    expect(videoTemplatePrefill(null)).toBeNull();
    expect(videoTemplatePrefill(undefined)).toBeNull();
    expect(videoTemplatePrefill("lyric-sync-cut")).toBeNull();
  });
});

describe("price — read from the registry, pinned to the rail", () => {
  it("the seam's cost and feature ARE the registry row for the apply path", () => {
    const row = CREDIT_COSTS[VIDEO_TEMPLATE_APPLY_PATH];
    expect(row).toBeDefined();
    expect(videoTemplateApplyCost()).toBe(row!.cost);
    expect(videoTemplateApplyFeature()).toBe(row!.feature);
    expect(getCreditCostRow()).toBe(VIDEO_TEMPLATE_APPLY_COST);
  });

  function getCreditCostRow() {
    return videoTemplateApplyCost();
  }

  it("the rail really charges that: the route's TEMPLATE_COST equals the registry cost", () => {
    const route = apiSrc("routes/generate/video-template.ts");
    const match = route.match(/const TEMPLATE_COST = (\d+);/);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBe(videoTemplateApplyCost());
  });

  it("the seam states no price literal (the components' pin lives in the desk-components suite)", () => {
    const cost = String(videoTemplateApplyCost());
    expect(feSrc("lib/world/templates-desk.ts")).not.toContain(cost);
  });

  it("the rail paths are the route's real family", () => {
    expect(VIDEO_TEMPLATES_PATH).toBe("/api/video-template/templates");
    expect(videoTemplateJobPath("abc")).toBe("/api/video-template/job/abc");
    const route = apiSrc("routes/generate/video-template.ts");
    expect(route).toContain('"/video-template/templates"');
    expect(route).toContain('"/video-template/apply"');
    expect(route).toContain('"/video-template/job/:jobId"');
  });
});

const ENTRY: VideoTemplateCatalogEntry = {
  key: "lyric-sync-cut",
  name: "Lyric Sync Cut",
  tagline: "Your words, on the beat",
  description: "A fast lyric video.",
  aspect: "9:16",
  durationTargetSec: 30,
  outputSeconds: 28,
  slots: [
    { key: "main", label: "Main performance clip", kind: "video", durationSec: 20 },
    { key: "cover", label: "Cover photo", kind: "photo", durationSec: 8 },
  ],
  transitions: ["cut"],
  overlays: [{ text: "YOUR SONG", slotIndex: 0, position: "bottom", size: "lg", color: "gold" }],
  audioMode: "keep",
};

describe("the catalog parse — defensive, all-or-nothing", () => {
  it("accepts a well-formed catalog and reads the rail's price line", () => {
    const parsed = parseVideoTemplateCatalog({ price: 250, templates: [ENTRY] });
    expect(parsed).not.toBeNull();
    expect(parsed!.templates).toHaveLength(1);
    expect(parsed!.templates[0]!.key).toBe("lyric-sync-cut");
    expect(parsed!.price).toBe(250);
    expect(parseVideoTemplateCatalog({ templates: [ENTRY] })!.price).toBeNull();
  });

  it("rejects drift wholesale — never a half-parsed shelf", () => {
    expect(parseVideoTemplateCatalog(null)).toBeNull();
    expect(parseVideoTemplateCatalog({})).toBeNull();
    expect(parseVideoTemplateCatalog({ templates: "nope" })).toBeNull();
    expect(parseVideoTemplateCatalog({ templates: [{ ...ENTRY, aspect: "4:5" }] })).toBeNull();
    expect(
      parseVideoTemplateCatalog({
        templates: [{ ...ENTRY, slots: [{ key: "a", label: "A", kind: "hologram", durationSec: 1 }] }],
      }),
    ).toBeNull();
    expect(
      parseVideoTemplateCatalog({ templates: [{ ...ENTRY, overlays: [{ text: "x" }] }] }),
    ).toBeNull();
    expect(parseVideoTemplateCatalog({ templates: [{ ...ENTRY, outputSeconds: "28" }] })).toBeNull();
  });
});

describe("slot media rules mirror the editor panel's", () => {
  const videoSlot = ENTRY.slots[0]!;
  const photoSlot = ENTRY.slots[1]!;
  const anySlot: VideoTemplateCatalogEntry["slots"][number] = {
    key: "any",
    label: "Anything",
    kind: "any",
    durationSec: 5,
  };

  it("mime speaks first, then the extension; unknown extensions pass", () => {
    expect(slotAcceptsMedia(videoSlot, "https://x/clip", "video/mp4")).toBe(true);
    expect(slotAcceptsMedia(videoSlot, "https://x/pic", "image/png")).toBe(false);
    expect(slotAcceptsMedia(photoSlot, "https://x/pic.jpg")).toBe(true);
    expect(slotAcceptsMedia(photoSlot, "https://x/clip.mp4")).toBe(false);
    expect(slotAcceptsMedia(videoSlot, "https://x/clip.webm")).toBe(true);
    expect(slotAcceptsMedia(anySlot, "https://x/whatever.bin")).toBe(true);
    expect(slotAcceptsMedia(videoSlot, "https://x/mystery")).toBe(true);
  });

  it("the upload ceiling is the panel's 80 MB", () => {
    expect(VIDEO_TEMPLATE_UPLOAD_MAX_BYTES).toBe(80 * 1024 * 1024);
  });
});

describe("the apply — body shape asserted against the rail's schema", () => {
  it("builds exactly the editor panel's body: slots in recipe order, bed only when given", () => {
    const body = buildVideoTemplateApplyBody({
      entry: ENTRY,
      slotUrls: { cover: "https://x/cover.jpg", main: "https://x/main.mp4" },
      overlayTexts: ["MY SONG"],
      musicBedUrl: "  ",
      endCard: true,
    });
    expect(body["template"]).toBe("lyric-sync-cut");
    expect(body["slots"]).toEqual([{ url: "https://x/main.mp4" }, { url: "https://x/cover.jpg" }]);
    expect(body["overlays"]).toEqual(["MY SONG"]);
    expect(body["musicBedUrl"]).toBeUndefined();
    expect(body["title"]).toBe("Lyric Sync Cut");
    expect(body["endCard"]).toBe(true);

    const withBed = buildVideoTemplateApplyBody({
      entry: ENTRY,
      slotUrls: { main: "a", cover: "b" },
      overlayTexts: [],
      musicBedUrl: " https://x/bed.mp3 ",
      endCard: false,
    });
    expect(withBed["musicBedUrl"]).toBe("https://x/bed.mp3");
  });

  it("names the missing slots in recipe order — the apply's gate", () => {
    expect(missingSlotLabels(ENTRY, {})).toEqual(["Main performance clip", "Cover photo"]);
    expect(missingSlotLabels(ENTRY, { main: "u" })).toEqual(["Cover photo"]);
    expect(missingSlotLabels(ENTRY, { main: "u", cover: "v" })).toEqual([]);
  });
});

describe("the job poll read", () => {
  it("carries state, progress, result and the rail's error words", () => {
    expect(interpretTemplateJob({ state: "active", stage: "rendering", progress: 40 })).toMatchObject({
      state: "active",
      stage: "rendering",
      progress: 40,
      resultUrl: null,
    });
    expect(
      interpretTemplateJob({
        state: "done",
        stage: "done",
        progress: 100,
        result: { url: "https://x/out.mp4", durationSec: 28 },
        error: null,
      }),
    ).toMatchObject({ state: "done", resultUrl: "https://x/out.mp4", durationSec: 28 });
    expect(interpretTemplateJob({ state: "failed", error: "Render failed." })).toMatchObject({
      state: "failed",
      error: "Render failed.",
    });
    expect(interpretTemplateJob(null).state).toBe("unknown");
    expect(interpretTemplateJob({ state: "sideways" }).state).toBe("unknown");
  });
});
