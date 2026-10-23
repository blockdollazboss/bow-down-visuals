/**
 * panel-payload.test.ts — Stack-100 #2 item 97: the panel-swap
 * protocol's payload channel.
 *
 * The claim under test: a desk handoff (Daily Drop "Use" is the
 * wired consumer) carries a template reference through the panel
 * swap — world.tsx target → StationPanel → CreateDeskPanel →
 * desk — and the receiving desk applies it ONLY when it parses
 * for its own station id and resolves in its own library. Every
 * other shape opens the desk blank, exactly as before the
 * channel existed. The payload carries template/state references
 * only — never money (pinned: the type has no numeric field and
 * the builders take a slug and nothing else).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  captionPackPayload,
  hookTemplatePayload,
  parsePanelPayloadFor,
  thumbnailTemplatePayload,
} from "./panel-payload";
import { dailyDropPanelPayload } from "./daily-drop-catalog";
import { hookTemplatePrefill, captionPackPrefill } from "./hook-desk";
import { getThumbnailTemplate } from "../../data/thumbnail-templates";
import { HOOK_TEMPLATES } from "../../data/hook-templates";
import { CAPTION_PACKS } from "../../data/caption-templates";
import { THUMBNAIL_TEMPLATES } from "../../data/thumbnail-templates";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("builders — typed, slug-only, no money ever", () => {
  it("builds the three kinds from a slug and nothing else", () => {
    expect(hookTemplatePayload("new-single-release-hook")).toEqual({
      kind: "hook-template",
      templateSlug: "new-single-release-hook",
    });
    expect(captionPackPayload("single-release-captions")).toEqual({
      kind: "caption-pack",
      templateSlug: "single-release-captions",
    });
    expect(thumbnailTemplatePayload("hype-trailer-thumb")).toEqual({
      kind: "thumbnail-template",
      templateSlug: "hype-trailer-thumb",
    });
    for (const p of [hookTemplatePayload("x"), captionPackPayload("x"), thumbnailTemplatePayload("x")]) {
      expect(Object.values(p).some((v) => typeof v === "number")).toBe(false);
    }
  });
});

describe("parsePanelPayloadFor — defensive at the receiving desk", () => {
  it("accepts a payload addressed to the parsing station", () => {
    expect(parsePanelPayloadFor("hook-desk", hookTemplatePayload("a"))).toEqual({
      kind: "hook-template",
      templateSlug: "a",
    });
    expect(parsePanelPayloadFor("hook-desk", captionPackPayload("b"))).toEqual({
      kind: "caption-pack",
      templateSlug: "b",
    });
    expect(parsePanelPayloadFor("thumbnail-desk", thumbnailTemplatePayload("c"))).toEqual({
      kind: "thumbnail-template",
      templateSlug: "c",
    });
  });

  it("rejects a payload addressed to another desk (no cross-desk leakage)", () => {
    expect(parsePanelPayloadFor("thumbnail-desk", hookTemplatePayload("a"))).toBeNull();
    expect(parsePanelPayloadFor("hook-desk", thumbnailTemplatePayload("c"))).toBeNull();
    expect(parsePanelPayloadFor("song-desk", hookTemplatePayload("a"))).toBeNull();
    expect(parsePanelPayloadFor("visual-vibes-editor", thumbnailTemplatePayload("c"))).toBeNull();
  });

  it("rejects garbage wholesale — absent, non-record, drifted fields", () => {
    expect(parsePanelPayloadFor("hook-desk", null)).toBeNull();
    expect(parsePanelPayloadFor("hook-desk", undefined)).toBeNull();
    expect(parsePanelPayloadFor("hook-desk", "hook-template")).toBeNull();
    expect(parsePanelPayloadFor("hook-desk", [])).toBeNull();
    expect(parsePanelPayloadFor("hook-desk", { kind: "hook-template" })).toBeNull();
    expect(parsePanelPayloadFor("hook-desk", { kind: "hook-template", templateSlug: "" })).toBeNull();
    expect(parsePanelPayloadFor("hook-desk", { kind: "hook-template", templateSlug: "   " })).toBeNull();
    expect(parsePanelPayloadFor("hook-desk", { kind: "hook-template", templateSlug: 42 })).toBeNull();
    expect(parsePanelPayloadFor("hook-desk", { kind: "money", templateSlug: "a", amount: 100 })).toBeNull();
    expect(parsePanelPayloadFor("hook-desk", { templateSlug: "a" })).toBeNull();
  });
});

describe("the Daily Drop handoff (the wired consumer)", () => {
  const entry = (kind: "hook" | "caption" | "thumbnail" | "video", key: string) => ({
    key,
    kind,
    href: "/x",
    isToday: false,
    archived: false,
  });

  it("maps hook/caption/thumbnail drops to their desk payloads; video honestly carries none", () => {
    expect(dailyDropPanelPayload(entry("hook", "grow-on-tiktok-hook"))).toEqual({
      kind: "hook-template",
      templateSlug: "grow-on-tiktok-hook",
    });
    expect(dailyDropPanelPayload(entry("caption", "merch-drop-captions"))).toEqual({
      kind: "caption-pack",
      templateSlug: "merch-drop-captions",
    });
    expect(dailyDropPanelPayload(entry("thumbnail", "gaming-video-thumbnail"))).toEqual({
      kind: "thumbnail-template",
      templateSlug: "gaming-video-thumbnail",
    });
    /* The editor door's seed is a project id, not a template slug —
       a video drop must not fake a prefill. */
    expect(dailyDropPanelPayload(entry("video", "hype-trailer"))).toBeNull();
  });

  it("every real drop slug resolves in the receiving desk's own library", () => {
    /* The server slate's keys (retention-drops DAILY_DROPS) are the
       template slugs of the three libraries — sampled here across
       all three kinds, the whole hook/caption/thumbnail libraries
       round-trip through their desk prefills. */
    for (const tpl of HOOK_TEMPLATES) {
      expect(hookTemplatePrefill(tpl.slug)).not.toBeNull();
    }
    for (const pack of CAPTION_PACKS) {
      expect(captionPackPrefill(pack.slug)).not.toBeNull();
    }
    for (const tpl of THUMBNAIL_TEMPLATES) {
      expect(getThumbnailTemplate(tpl.slug)).toBeDefined();
    }
    /* An unknown slug is the second gate: the desk prefills nothing. */
    expect(hookTemplatePrefill("no-such-template")).toBeNull();
    expect(captionPackPrefill("no-such-pack")).toBeNull();
    expect(getThumbnailTemplate("no-such-template")).toBeUndefined();
  });
});

describe("the channel is threaded end to end (source pins)", () => {
  const worldSrc = read("../../pages/world.tsx");
  const panelSrc = read("../../components/world/StationPanel.tsx");
  const catalogSrc = read("../../components/world/native/DailyDropCatalog.tsx");
  const hookDeskSrc = read("../../components/world/native/HookDesk.tsx");
  const benchesSrc = read("../../components/world/native/ThumbnailBenches.tsx");
  const createDesksSrc = read("../../components/world/native/CreateDesks.tsx");

  it("world.tsx carries the payload on the panel target", () => {
    expect(worldSrc).toContain("payload: payload ?? null");
  });

  it("StationPanel forwards the target payload into the Create desks", () => {
    expect(panelSrc).toContain("payload?: PanelPayload | null");
    expect(panelSrc).toContain("panelPayload={target.payload ?? null}");
  });

  it("the Daily Drop Use button sends station + payload together", () => {
    expect(catalogSrc).toContain("onOpenStation(stationId, dailyDropPanelPayload(entry))");
  });

  it("both receiving desks parse defensively for their own station", () => {
    expect(hookDeskSrc).toContain('parsePanelPayloadFor(HOOK_DESK_STATION_ID, props.panelPayload)');
    expect(benchesSrc).toContain('parsePanelPayloadFor("thumbnail-desk", panelPayload)');
    expect(createDesksSrc).toContain("panelPayload={props.panelPayload ?? null}");
  });
});
