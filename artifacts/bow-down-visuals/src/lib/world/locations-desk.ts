/**
 * locations-desk — the seam behind the Video Desk's native
 * Locations bench (stack200 world parity lane B1, census
 * item 3; the census counted the feature ABSENT — locations
 * existed only as an editor step-through tab).
 *
 * Source of truth: pages/locations.tsx over routes/locations.ts.
 * The bench is the page's saved-places surface in the room —
 * the same free rails the page and the editor's Locations tab
 * share:
 *   GET    /api/locations         { locations: [...] }
 *   POST   /api/locations         { label, image_url } → { location }
 *   POST   /api/locations/upload  FormData "image" + "label" → { location }
 *   DELETE /api/locations/:id     { deleted }
 *
 * Honesty rules, mirrored from the page and the empty-lie law:
 * - a load whose payload is not the locations list parses to
 *   null — the bench shows the error state and a retry, NEVER
 *   the "No locations yet" empty copy; that line appears only
 *   after a successful load of an empty list;
 * - a row without a name or an image is dropped, never shown
 *   as a broken card;
 * - the add-by-URL bar is the page's: BOTH a name and an
 *   image URL are required;
 * - the upload bars are the page's, in the page's order: the
 *   10 MB size cap (the route's multer limit is the same
 *   10 MB) fires before the name-first rule.
 *
 * Copy rides the page's own locations.* catalog keys; nothing
 * is charged anywhere on these rails.
 */

export const LOCATIONS_PATH = "/api/locations";
export const LOCATIONS_UPLOAD_PATH = "/api/locations/upload";
export const LOCATION_MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export function locationPath(id: string): string {
  return `${LOCATIONS_PATH}/${encodeURIComponent(id)}`;
}

export interface SavedLocation {
  id: string;
  label: string;
  imageUrl: string;
  createdAt: string | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function locationOfRow(row: unknown): SavedLocation | null {
  if (!isRecord(row)) return null;
  if (typeof row["id"] !== "string" || !row["id"]) return null;
  if (typeof row["label"] !== "string" || !row["label"]) return null;
  if (typeof row["image_url"] !== "string" || !row["image_url"]) return null;
  return {
    id: row["id"],
    label: row["label"],
    imageUrl: row["image_url"],
    createdAt: typeof row["created_at"] === "string" ? row["created_at"] : null,
  };
}

/** The saved list — null when the payload is not the locations
 *  shape at all (the bench reads null as "the load failed"),
 *  a list (possibly empty) when it is. Malformed rows drop. */
export function locationsOf(data: unknown): SavedLocation[] | null {
  if (!isRecord(data)) return null;
  const rows = data["locations"];
  if (!Array.isArray(rows)) return null;
  const out: SavedLocation[] = [];
  for (const row of rows) {
    const loc = locationOfRow(row);
    if (loc) out.push(loc);
  }
  return out;
}

/** One location off a save/upload response — null when the
 *  response carries none (the bench re-reads the list rather
 *  than trusting a partial echo). */
export function savedLocationOf(data: unknown): SavedLocation | null {
  if (!isRecord(data)) return null;
  return locationOfRow(data["location"]);
}

/** The add-by-URL body — the page's bar: a name AND an image
 *  URL, both trimmed; null when either is missing. */
export function buildLocationBody(
  label: string,
  imageUrl: string,
): { label: string; image_url: string } | null {
  const name = label.trim();
  const url = imageUrl.trim();
  if (!name || !url) return null;
  return { label: name, image_url: url };
}

/** The page's upload bars, in the page's order: size first,
 *  then the name. Null = clear to upload. */
export function locationUploadProblem(
  label: string,
  fileSizeBytes: number,
): "too-large" | "name-first" | null {
  if (fileSizeBytes > LOCATION_MAX_IMAGE_BYTES) return "too-large";
  if (!label.trim()) return "name-first";
  return null;
}
