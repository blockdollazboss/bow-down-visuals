/**
 * carousel-desk.test.ts — stack1400 parity wave #2 item 5: the
 * Carousel Desk, the Carousel Maker's native desk in the Create
 * Wing.
 *
 * Traced from the 2D surface: /carousel-maker builds slides
 * client-side (templates from lib/carousel-renderer, title/body/
 * per-slide background, ordering capped at 10 slides, square or
 * portrait, serif/sans/display, vault brand colors) and its one
 * charge is POST /api/carousel/export — 100 Visual Bucs flat
 * (the route's chargeCredits(…, 100, …) and the credit registry
 * agree), returning the disclosure payload the client stamps
 * into each downloaded PNG. Its schedule hand-off carries the
 * slide titles as a caption (buildSchedulerHref). These tests
 * pin the desk's seam to those rails: the registry price, the
 * page's enums and slide bookkeeping, the export payload and
 * disclosure guard, the caption hand-off, and the source
 * contracts (confirmedFetch confirmation law, the
 * CreateDeskPanel dispatch, the station registry entry).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CAROUSEL_BG_CHOICES,
  CAROUSEL_DESK_STATION_ID,
  CAROUSEL_EXPORT_PATH,
  CAROUSEL_FORMATS,
  CAROUSEL_FONTS,
  CAROUSEL_MAX_SLIDES,
  addCarouselSlide,
  buildCarouselExportPayload,
  carouselDisclosureForExport,
  carouselExportCost,
  carouselScheduleCaption,
  carouselSchedulePrefill,
  disclosureOfCarouselResponse,
  filledCarouselCount,
  moveCarouselSlide,
  newCarouselSlide,
  removeCarouselSlide,
  slidesFromProjectConcept,
  updateCarouselSlide,
} from "./carousel-desk";
import { getCreditCost } from "../credit-costs";
import { STATION_BY_ID } from "./stations";
import { CREATE_WING_ID } from "./palace-layout";
import { isCreateDeskId, CREATE_DESK_IDS } from "./create-desks";
import { CAROUSEL_TEMPLATES, type CarouselSlide } from "../carousel-renderer";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const deskSrc = read("../../components/world/native/CarouselDesk.tsx");
const panelSrc = read("../../components/world/native/CreateDeskPanel.tsx");

const slide = (id: string, title = "", body = ""): CarouselSlide => ({ id, title, body, bg: null });

describe("price — the registry's, matching the route's charge", () => {
  it("carousel export is 100 VB, read from the credit registry", () => {
    expect(CAROUSEL_EXPORT_PATH).toBe("/api/carousel/export");
    expect(carouselExportCost()).toBe(100);
    expect(carouselExportCost()).toBe(getCreditCost("/api/carousel/export")!.cost);
  });
});

describe("enums — the page's own, verbatim", () => {
  it("formats, fonts and background choices match carousel-maker.tsx", () => {
    expect(CAROUSEL_FORMATS).toEqual(["square", "portrait"]);
    expect(CAROUSEL_FONTS).toEqual(["serif", "sans", "display"]);
    expect(CAROUSEL_BG_CHOICES).toEqual([
      "gold-glow", "midnight", "split", "framed",
      "gradient-wash", "bold-band", "paper", "neon-edge",
    ]);
    expect(CAROUSEL_MAX_SLIDES).toBe(10);
    // Every template bgStyle is one of the per-slide choices.
    for (const tpl of CAROUSEL_TEMPLATES) {
      expect(CAROUSEL_BG_CHOICES, tpl.id).toContain(tpl.bgStyle);
    }
  });
});

describe("slide bookkeeping — the page's state moves", () => {
  it("new slides are blank with the caller's id", () => {
    expect(newCarouselSlide("s1")).toEqual({ id: "s1", title: "", body: "", bg: null });
  });

  it("add caps at 10, remove never drops below 1", () => {
    const ten = Array.from({ length: 10 }, (_, i) => slide(`s${i}`));
    expect(addCarouselSlide(ten, slide("s10"))).toHaveLength(10);
    expect(addCarouselSlide([slide("a")], slide("b")).map((s) => s.id)).toEqual(["a", "b"]);
    expect(removeCarouselSlide([slide("a")], 0)).toHaveLength(1);
    expect(removeCarouselSlide([slide("a"), slide("b")], 0).map((s) => s.id)).toEqual(["b"]);
  });

  it("move swaps neighbours and refuses out-of-range moves", () => {
    const deck = [slide("a"), slide("b"), slide("c")];
    expect(moveCarouselSlide(deck, 0, 1).map((s) => s.id)).toEqual(["b", "a", "c"]);
    expect(moveCarouselSlide(deck, 0, -1).map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(moveCarouselSlide(deck, 2, 1).map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(deck.map((s) => s.id)).toEqual(["a", "b", "c"]); // original untouched
  });

  it("update patches one slide immutably; filled counts words on either field", () => {
    const deck = [slide("a"), slide("b", "T")];
    const next = updateCarouselSlide(deck, 0, { body: "words" });
    expect(next[0]).toEqual({ id: "a", title: "", body: "words", bg: null });
    expect(deck[0]!.body).toBe("");
    expect(filledCarouselCount(deck)).toBe(1);
    expect(filledCarouselCount(next)).toBe(2);
    expect(filledCarouselCount([slide("x", "  ", " ")])).toBe(0);
  });

  it("project pull splits the concept on sentences, first slide takes the project name", () => {
    const out = slidesFromProjectConcept({
      concept: "First point. Second point! Third?",
      projectName: "My Launch",
      idFor: (i) => `p${i}`,
    });
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ id: "p0", title: "My Launch", body: "First point." });
    expect(out[1]).toMatchObject({ id: "p1", title: "", body: "Second point!" });
    expect(slidesFromProjectConcept({ concept: "", projectName: "X", idFor: (i) => `p${i}` })).toEqual([]);
  });
});

describe("export payload + disclosure — the page's post, field for field", () => {
  it("payload is { slideCount, aiDisclosure } with the route's 1–10 clamp", () => {
    expect(buildCarouselExportPayload({ slideCount: 3, aiDisclosure: true })).toEqual({
      slideCount: 3,
      aiDisclosure: true,
    });
    expect(buildCarouselExportPayload({ slideCount: 99, aiDisclosure: false })).toEqual({
      slideCount: 10,
      aiDisclosure: false,
    });
    expect(buildCarouselExportPayload({ slideCount: 0, aiDisclosure: true })).toEqual({
      slideCount: 1,
      aiDisclosure: true,
    });
  });

  it("disclosure guard: only a well-formed { text, tool } payload passes", () => {
    expect(disclosureOfCarouselResponse({ disclosure: { text: "Made with…", tool: "Carousel Maker" } })).toEqual({
      text: "Made with…",
      tool: "Carousel Maker",
    });
    expect(disclosureOfCarouselResponse({ disclosure: null })).toBeNull();
    expect(disclosureOfCarouselResponse({})).toBeNull();
    expect(disclosureOfCarouselResponse({ disclosure: { text: "x" } })).toBeNull();
    expect(disclosureOfCarouselResponse({ disclosure: { text: "", tool: "y" } })).toBeNull();
    expect(disclosureOfCarouselResponse(null)).toBeNull();
    expect(disclosureOfCarouselResponse("nope")).toBeNull();
  });

  it("the stamped disclosure exists only when the toggle is on AND the server sent one", () => {
    const payload = { text: "t", tool: "Carousel Maker" };
    expect(carouselDisclosureForExport({ aiDisclosure: true, responseDisclosure: payload, artistName: "King" })).toEqual({
      text: "t",
      tool: "Carousel Maker",
      creator: "King",
    });
    expect(carouselDisclosureForExport({ aiDisclosure: false, responseDisclosure: payload, artistName: "King" })).toBeNull();
    expect(carouselDisclosureForExport({ aiDisclosure: true, responseDisclosure: null, artistName: null })).toBeNull();
  });
});

describe("schedule hand-off — the page's caption, in-world", () => {
  it("caption joins titles with ' · ' and caps at 200 chars", () => {
    const deck = [slide("a", "One"), slide("b", ""), slide("c", "Two")];
    expect(carouselScheduleCaption(deck, "fallback")).toBe("One · Two");
    expect(carouselScheduleCaption([slide("a")], "fallback")).toBe("fallback");
    expect(carouselScheduleCaption([slide("a", "x".repeat(300))], "f")).toHaveLength(200);
  });

  it("prefill rides the caption as an image post with no invented media link", () => {
    expect(carouselSchedulePrefill([slide("a", "Hi")], "fb")).toEqual({
      mediaUrl: "",
      mediaType: "image",
      caption: "Hi",
    });
  });
});

describe("station + dispatch — the desk stands in the Create Wing", () => {
  it("the registry entry is a members-only native create station for /carousel-maker", () => {
    expect(CAROUSEL_DESK_STATION_ID).toBe("carousel-desk");
    const station = STATION_BY_ID.get("carousel-desk")!;
    expect(station).toBeDefined();
    expect(station.name).toBe("Carousel Desk");
    expect(station.roomId).toBe(CREATE_WING_ID);
    expect(station.membersOnly).toBe(true);
    expect(station.panel).toEqual({ kind: "native", pattern: "create" });
    expect(station.websitePath).toBe("/carousel-maker");
    expect(isCreateDeskId("carousel-desk")).toBe(true);
    expect(CREATE_DESK_IDS).toContain("carousel-desk");
  });

  it("CreateDeskPanel dispatches carousel-desk to the CarouselDesk", () => {
    expect(panelSrc).toContain('case "carousel-desk":');
    expect(panelSrc).toContain("CarouselDesk");
  });
});

describe("desk source contracts — rails, confirmation law, no exits", () => {
  it("the export rides confirmedFetch to the real rail and renders with the site's renderer", () => {
    expect(deskSrc).toContain("confirmedFetch");
    expect(deskSrc).toContain('"/api/carousel/export"');
    expect(deskSrc).toContain("renderCarouselSlide");
    expect(deskSrc).toContain("downloadCarouselSlide");
    expect(deskSrc).toContain("buildCarouselExportPayload");
  });

  it("cost is printed before the run; result and schedule stay in-world", () => {
    expect(deskSrc).toContain('data-testid="world-carousel-desk-cost"');
    expect(deskSrc).toContain('data-testid="world-create-carousel-desk"');
    expect(deskSrc).toContain('data-testid="world-carousel-desk-export"');
    expect(deskSrc).toContain('data-testid="world-carousel-desk-done"');
    expect(deskSrc).toContain("SchedulerComposeStandalone");
    expect(deskSrc).toContain("carouselSchedulePrefill");
    // No website exit: no scheduler href hand-off, no location jump.
    expect(deskSrc).not.toContain("buildSchedulerHref");
    expect(deskSrc).not.toContain("window.location");
    expect(deskSrc).not.toContain('target="_blank"');
  });
});
