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
   price, never a charge. Three kinds exist because three desks
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
  | { kind: "thumbnail-template"; templateSlug: string };

export type PanelPayloadKind = PanelPayload["kind"];

const PAYLOAD_KINDS: ReadonlySet<string> = new Set([
  "hook-template",
  "caption-pack",
  "thumbnail-template",
]);

/** Which payload kinds each station's desk can honestly apply.
 *  A station absent from this table takes no payload at all —
 *  opening it with one is a shape error, parsed to null. */
const STATION_PAYLOAD_KINDS: Readonly<Record<string, ReadonlySet<PanelPayloadKind>>> = {
  "hook-desk": new Set<PanelPayloadKind>(["hook-template", "caption-pack"]),
  "thumbnail-desk": new Set<PanelPayloadKind>(["thumbnail-template"]),
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
