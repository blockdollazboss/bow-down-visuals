/* ─── Carousel Desk in-world (stack1400 parity wave #2, item 5) ────
   The Carousel Maker's native desk in the Create Wing, on the
   Carousel Maker's OWN rails — the exact surface the 2D
   /carousel-maker page builds on:

     POST /api/carousel/export  { slideCount, aiDisclosure }
                                → { ok, charged: 100, balance,
                                    disclosure: { text, tool } | null }
                                100 Visual Bucs per export — the
                                route's chargeCredits(…, 100, …) and
                                the credit registry's
                                "/api/carousel/export" entry agree;
                                the desk reads the registry, so the
                                shown price can never drift from the
                                confirmation's price.

   Everything else the page does is client-side and rides the
   site's own library in-world, unchanged:
     - slides render with lib/carousel-renderer
       (renderCarouselSlide + downloadCarouselSlide — canvas → PNG
       downloads, with the server's disclosure payload stamped into
       each PNG's metadata when the disclosure toggle is on);
     - the Creative Vault flows in from the active artist
       (brand colors + artist name, exactly as the page's
       "Use my vault" + renderer inputs do);
     - the active hub project's concept splits into slides exactly
       as the page's "Pull from project" does;
     - a finished export saves to the hub project exactly as the
       page's addAsset call does;
     - the schedule hand-off carries the slide titles as the
       caption into the IN-WORLD scheduler compose (the page's
       buildSchedulerHref caption, word for word) — never a
       website exit. The scheduler compose still needs an image
       link the member adds there: carousel PNGs are local
       downloads, no rail hosts them, and the 2D hand-off carries
       caption only too.

   Confirmation law: the export rides useConfirmedApi's
   confirmedFetch — the registry-priced spend confirmation shows
   BEFORE anything runs, a declined confirmation runs nothing and
   downloads nothing. Slide building (templates, ordering,
   captions, backgrounds, fonts, format) is free — only the export
   charges, exactly as on the page. */
import { getCreditCost } from "../credit-costs";
import type {
  CarouselFormat,
  CarouselSlide,
  CarouselDisclosure,
} from "../carousel-renderer";
import type { SchedulerPrefill } from "./scheduler-desk";

export const CAROUSEL_DESK_STATION_ID = "carousel-desk";
export const CAROUSEL_EXPORT_PATH = "/api/carousel/export";

/* ─── Price — the registry's, never invented ─────────────────────── */

/** POST /api/carousel/export — registry 100, the route's
 *  chargeCredits(…, 100, …) agrees. Flat per export, any slide
 *  count (the route clamps slideCount to 1–10 server-side). */
export function carouselExportCost(): number {
  const entry = getCreditCost(CAROUSEL_EXPORT_PATH);
  if (!entry) throw new Error(`No registered credit cost for ${CAROUSEL_EXPORT_PATH}`);
  return entry.cost;
}

/* ─── The page's own enums (verbatim) ────────────────────────────── */

export const CAROUSEL_FORMATS: readonly CarouselFormat[] = ["square", "portrait"];

export const CAROUSEL_FONTS = ["serif", "sans", "display"] as const;
export type CarouselFont = (typeof CAROUSEL_FONTS)[number];

/** carousel-maker.tsx BG_CHOICES — the per-slide background
 *  overrides the page offers beside the template default. */
export const CAROUSEL_BG_CHOICES = [
  "gold-glow",
  "midnight",
  "split",
  "framed",
  "gradient-wash",
  "bold-band",
  "paper",
  "neon-edge",
] as const;

export const CAROUSEL_MAX_SLIDES = 10;
export const CAROUSEL_TITLE_MAX = 120;
export const CAROUSEL_BODY_MAX = 400;

/* ─── Slide bookkeeping — the page's state moves, pure ───────────── */

/** The page's newSlide: a blank slide carrying the caller's id
 *  (the page mints `slide-${Date.now()}-${n}`; the desk mints its
 *  own the same way and passes it in, keeping this pure). */
export function newCarouselSlide(id: string): CarouselSlide {
  return { id, title: "", body: "", bg: null };
}

/** Add a slide — the page caps the deck at 10 and refuses silently
 *  past it; the desk shows the cap instead (see the component). */
export function addCarouselSlide(
  slides: readonly CarouselSlide[],
  slide: CarouselSlide,
): CarouselSlide[] {
  if (slides.length >= CAROUSEL_MAX_SLIDES) return [...slides];
  return [...slides, slide];
}

/** Remove a slide — a deck never drops below one slide. */
export function removeCarouselSlide(
  slides: readonly CarouselSlide[],
  idx: number,
): CarouselSlide[] {
  if (slides.length <= 1) return [...slides];
  return slides.filter((_, i) => i !== idx);
}

/** Move a slide one step — out-of-range moves are no-ops, exactly
 *  as the page's moveSlide guards them. */
export function moveCarouselSlide(
  slides: readonly CarouselSlide[],
  idx: number,
  dir: -1 | 1,
): CarouselSlide[] {
  const j = idx + dir;
  if (j < 0 || j >= slides.length) return [...slides];
  const next = [...slides];
  [next[idx], next[j]] = [next[j]!, next[idx]!];
  return next;
}

/** Patch one slide (title / body / background), immutably. */
export function updateCarouselSlide(
  slides: readonly CarouselSlide[],
  idx: number,
  patch: Partial<CarouselSlide>,
): CarouselSlide[] {
  return slides.map((s, i) => (i === idx ? { ...s, ...patch } : s));
}

/** Slides carrying any words — the page's filledCount: the export
 *  and schedule actions stay shut (and uncharged) at zero. */
export function filledCarouselCount(slides: readonly CarouselSlide[]): number {
  return slides.filter((s) => s.title.trim() || s.body.trim()).length;
}

/** The page's "Pull from project": the hub project's concept split
 *  into slide-sized chunks on sentence boundaries, the first slide
 *  carrying the project name as its title, bodies capped at 280
 *  chars, at most 10 slides. Empty when there is no concept text
 *  to pull — the desk then says so instead of inventing slides. */
export function slidesFromProjectConcept(input: {
  concept: string;
  projectName: string;
  idFor: (i: number) => string;
}): CarouselSlide[] {
  const sentences = input.concept.split(/(?<=[.!?])\s+/).filter(Boolean);
  const out: CarouselSlide[] = [];
  sentences.slice(0, CAROUSEL_MAX_SLIDES).forEach((s, i) => {
    out.push({
      id: input.idFor(i),
      title: i === 0 ? input.projectName || "" : "",
      body: s.slice(0, 280),
      bg: null,
    });
  });
  return out;
}

/* ─── Export payload + response guard ────────────────────────────── */

/** carousel-maker.tsx handleExport's body, field for field:
 *  { slideCount, aiDisclosure } — slideCount clamped to the
 *  route's own 1–10 window before it is posted. */
export function buildCarouselExportPayload(input: {
  slideCount: number;
  aiDisclosure: boolean;
}): Record<string, unknown> {
  return {
    slideCount: Math.min(Math.max(Math.trunc(input.slideCount) || 1, 1), CAROUSEL_MAX_SLIDES),
    aiDisclosure: input.aiDisclosure,
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The disclosure payload out of a /carousel/export answer — the
 *  { text, tool } the client stamps into each PNG, or null when
 *  the server returned none (disclosure off). A malformed payload
 *  reads as null too: the export still downloads unstamped, which
 *  is the page's own stamp-failure rule (a stamp failure never
 *  fails the export). */
export function disclosureOfCarouselResponse(raw: unknown): { text: string; tool: string } | null {
  if (!isRecord(raw)) return null;
  const d = raw["disclosure"];
  if (!isRecord(d)) return null;
  if (typeof d["text"] !== "string" || typeof d["tool"] !== "string") return null;
  if (!d["text"] || !d["tool"]) return null;
  return { text: d["text"], tool: d["tool"] };
}

/** The disclosure the desk hands downloadCarouselSlide: the
 *  server's text/tool plus the creator's name, exactly as the
 *  page builds it — and only when the toggle is on AND the server
 *  actually returned a payload. */
export function carouselDisclosureForExport(input: {
  aiDisclosure: boolean;
  responseDisclosure: { text: string; tool: string } | null;
  artistName: string | null;
}): CarouselDisclosure | null {
  if (!input.aiDisclosure || !input.responseDisclosure) return null;
  return {
    text: input.responseDisclosure.text,
    tool: input.responseDisclosure.tool,
    creator: input.artistName || null,
  };
}

/* ─── The schedule hand-off — the page's caption, in-world ───────── */

/** carousel-maker.tsx handleSchedule's caption: the slide titles
 *  joined with " · ", capped at 200 chars (the desk's caller
 *  supplies the same fallback line the page's i18n default uses
 *  when no slide carries a title). */
export function carouselScheduleCaption(
  slides: readonly CarouselSlide[],
  fallback: string,
): string {
  return slides.map((s) => s.title).filter(Boolean).join(" · ").slice(0, 200) || fallback;
}

/** The in-world scheduler prefill for a finished carousel: the
 *  caption rides; the media link starts empty because the slides
 *  are local PNG downloads no rail hosts (the 2D hand-off carries
 *  no media either) — the compose itself asks for the link. */
export function carouselSchedulePrefill(
  slides: readonly CarouselSlide[],
  fallbackCaption: string,
): SchedulerPrefill {
  return {
    mediaUrl: "",
    mediaType: "image",
    caption: carouselScheduleCaption(slides, fallbackCaption),
  };
}
