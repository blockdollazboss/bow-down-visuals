/* ─── Panel payload channel (Stack-100 #2 item 97) ──────────────────
   The station panel-swap protocol (world.tsx → StationPanel →
   desks) historically carried ONLY a station id: a desk handoff
   that knew WHICH template or state the walker meant opened the
   target desk blank and dropped that context on the floor. The
   one honourable exception was the scheduler's typed prefill
   (scheduler-desk.ts SchedulerPrefill), threaded by hand inside
   one desk family.

   This module is the general channel, kept deliberately small:
   a payload is a TEMPLATE/STATE REFERENCE — a slug the receiving
   desk resolves against its own libraries — never money, never a
   price, never a charge. The kinds that exist are the desks that
   can honestly prefill today:

     hook-template       → the Hook Desk, hooks mode, filled from
                           the site's hook-template library
                           (hook-desk.ts hookTemplatePrefill)
     caption-pack        → the Hook Desk, captions mode, filled
                           from the caption-pack library
                           (hook-desk.ts captionPackPrefill)
     thumbnail-template  → the Thumbnail Desk's benches, filled
                           from the thumbnail-template library
                           (data/thumbnail-templates)
     video-template      → the Video Desk's template bench
                           (Stack-100 wave 4, item 27 / desk #100),
                           preselected from the video-template
                           catalog the editor's Templates tab reads
                           (templates-desk.ts videoTemplatePrefill)
     library-preset      → the Visual Vibes Editor step-through
                           (stack100 phase-2 join repair): the
                           Library desk's "Use" carries the picked
                           look as the SAME query param the preset's
                           2D deep link carries (?fx= / ?textstyle= /
                           ?transition= with the preset slug), and
                           the step-through seeds it into the
                           editor's search — the editor's own param
                           reader applies it there, exactly as on
                           the page. No new editor plumbing.
     remix-preset        → the Visual Vibes Editor step-through
                           (stack200 lane B1, census item 2): the
                           Remix desk's "Remix" for the trending
                           presets whose 2D deep link carries the
                           fallback ?remix=<slug> param (the motion
                           and VFX looks with no library mapping).
                           The step-through seeds ?remix= into the
                           editor's search and the editor's own
                           remix deep-link reader applies it,
                           exactly as on the page. A trending
                           preset whose link carries ?fx= or
                           ?transition= rides the library-preset
                           kind instead — the desk's seam mirrors
                           each preset's OWN params, never a
                           translation of them.
     cover-art-scene     → the Cover Art desk (stack300 item 96):
                           the Locations bench's "Use in cover art"
                           door, carrying the saved location's
                           imageUrl — the exact reference the 2D
                           door carries in /cover-art?scene=. The
                           desk seeds its prompt from the URL the
                           same way the page does. Still a state
                           reference — never money.

   A desk applies a payload ONLY through parsePanelPayloadFor with
   its OWN station id: a payload addressed to another desk, a kind
   the desk doesn't speak, or any shape drift at all parses to
   null and the desk opens exactly as blank as it always has.
   Garbage is ignored, never guessed at. A slug the desk's own
   library doesn't know is the second gate — the desk's prefill
   lookup no-ops on it, so an unknown reference fills nothing. */

export type PanelPayload =
  | { kind: "hook-template"; templateSlug: string }
  | { kind: "caption-pack"; templateSlug: string }
  | { kind: "thumbnail-template"; templateSlug: string }
  | { kind: "video-template"; templateSlug: string }
  | {
      kind: "library-preset";
      /** The editor query param the preset's 2D deep link carries. */
      param: "fx" | "textstyle" | "transition";
      slug: string;
    }
  | {
      kind: "remix-preset";
      /** A trending-preset slug from data/trending-presets — the
       *  editor's remix deep-link reader resolves it there. */
      slug: string;
    }
  | {
      kind: "cover-art-scene";
      /** A saved location's image URL (locations-desk.ts
       *  coverArtSceneUrl) — the reference the Cover Art desk
       *  seeds its prompt from, mirroring /cover-art?scene=. */
      sceneUrl: string;
    };

type PanelPayloadKind = PanelPayload["kind"];

const PAYLOAD_KINDS: ReadonlySet<string> = new Set([
  "hook-template",
  "caption-pack",
  "thumbnail-template",
  "video-template",
  "library-preset",
  "remix-preset",
  "cover-art-scene",
]);

/** Which payload kinds each station's desk can honestly apply.
 *  A station absent from this table takes no payload at all —
 *  opening it with one is a shape error, parsed to null. */
const STATION_PAYLOAD_KINDS: Readonly<Record<string, ReadonlySet<PanelPayloadKind>>> = {
  "hook-desk": new Set<PanelPayloadKind>(["hook-template", "caption-pack"]),
  "thumbnail-desk": new Set<PanelPayloadKind>(["thumbnail-template"]),
  "video-desk": new Set<PanelPayloadKind>(["video-template"]),
  "visual-vibes-editor": new Set<PanelPayloadKind>(["library-preset", "remix-preset"]),
  "cover-art-desk": new Set<PanelPayloadKind>(["cover-art-scene"]),
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Defensive parse at the receiving desk: the payload this desk
 *  may apply, or null when the raw value is absent, addressed to
 *  another station, of a kind this desk doesn't speak, or shape-
 *  drifted in any field. Null means "open blank" — the pre-97
 *  behaviour — never a partially-applied guess. */
export function parsePanelPayloadFor(stationId: string, raw: unknown): PanelPayload | null {
  const allowed = STATION_PAYLOAD_KINDS[stationId];
  if (!allowed) return null;
  if (!isRecord(raw)) return null;
  const kind = raw["kind"];
  if (typeof kind !== "string" || !PAYLOAD_KINDS.has(kind)) return null;
  if (!allowed.has(kind as PanelPayloadKind)) return null;
  if (kind === "library-preset") {
    const param = raw["param"];
    if (param !== "fx" && param !== "textstyle" && param !== "transition") return null;
    const slug = raw["slug"];
    if (typeof slug !== "string" || slug.trim().length === 0) return null;
    return { kind: "library-preset", param, slug };
  }
  if (kind === "remix-preset") {
    const slug = raw["slug"];
    if (typeof slug !== "string" || slug.trim().length === 0) return null;
    return { kind: "remix-preset", slug };
  }
  if (kind === "cover-art-scene") {
    const sceneUrl = raw["sceneUrl"];
    if (typeof sceneUrl !== "string" || sceneUrl.trim().length === 0) return null;
    return { kind: "cover-art-scene", sceneUrl };
  }
  const slug = raw["templateSlug"];
  if (typeof slug !== "string" || slug.trim().length === 0) return null;
  return { kind: kind as PanelPayloadKind, templateSlug: slug } as PanelPayload;
}

/** The hook-template payload (a Daily Drop hook "Use", or any
 *  future handoff naming a hook template). */
export function hookTemplatePayload(templateSlug: string): PanelPayload {
  return { kind: "hook-template", templateSlug };
}

/** The caption-pack payload (a Daily Drop caption "Use"). */
export function captionPackPayload(templateSlug: string): PanelPayload {
  return { kind: "caption-pack", templateSlug };
}

/** The thumbnail-template payload (a Daily Drop thumbnail "Use"). */
export function thumbnailTemplatePayload(templateSlug: string): PanelPayload {
  return { kind: "thumbnail-template", templateSlug };
}

/** The video-template payload (the Templates Desk's video "Use",
 *  Stack-100 wave 4 item 27): the slug is a video-template key
 *  from the site's catalog (data/video-templates), resolved by
 *  the Video Desk's bench against the rail's own catalog. */
export function videoTemplatePayload(templateSlug: string): PanelPayload {
  return { kind: "video-template", templateSlug };
}

/** The library-preset payload (the Library Desk's preset "Use",
 *  stack100 phase-2 join repair): the param is the editor query
 *  param the preset's 2D deep link carries, the slug a preset key
 *  from the page's own catalog (data/library-presets). The
 *  step-through host seeds both into the editor's search; the
 *  editor's own param reader applies the look there. */
export function libraryPresetPayload(
  param: "fx" | "textstyle" | "transition",
  slug: string,
): PanelPayload {
  return { kind: "library-preset", param, slug };
}

/** The remix-preset payload (the Remix Desk's "Remix", stack200
 *  lane B1): the slug is a trending-preset key from the site's
 *  catalog (data/trending-presets) whose 2D deep link carries
 *  the fallback ?remix= param; the step-through seeds it and
 *  the editor's own remix reader resolves it there. */
export function remixPresetPayload(slug: string): PanelPayload {
  return { kind: "remix-preset", slug };
}

/** The cover-art-scene payload (the Locations bench's "Use in
 *  cover art", stack300 item 96): the URL is a saved location's
 *  imageUrl — the same reference the page's cover-art door
 *  carries in ?scene= — resolved by the Cover Art desk into its
 *  prompt seed, exactly as the page seeds from the param. */
export function coverArtScenePayload(sceneUrl: string): PanelPayload {
  return { kind: "cover-art-scene", sceneUrl };
}
