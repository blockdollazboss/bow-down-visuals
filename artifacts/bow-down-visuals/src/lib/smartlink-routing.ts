/* Smartlink territory / language routing — editor helpers
 * (Stack-100 #3 W3).
 *
 * A creator can give a release smartlink per-country destination
 * overrides and per-language destinations. Fans are resolved
 * server-side (territory → language → the normal platform links);
 * this module is only the settings form's shape discipline, mirroring
 * the server's cleaners in artifacts/api-server/src/lib/
 * smartlink-routing.ts so a typo is caught before the round-trip.
 * The server stays the source of truth and refuses bent saves.
 */

export type DestinationMap = Record<string, string>;

export interface DestinationRow {
  code: string;
  url: string;
}

/** "de" / " DE " → "DE"; anything not a real alpha-2 code (incl. the
 *  CDN's "XX" unknown sentinel) → null. */
export function normalizeCountryCode(raw: string): string | null {
  const v = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(v) && v !== "XX" ? v : null;
}

/** "es" / "ES-MX" / "en_US" → the primary subtag; bent shapes → null. */
export function normalizeLanguageCode(raw: string): string | null {
  const primary = (raw.trim().toLowerCase().split(/[-_]/)[0] ?? "");
  return /^[a-z]{2,3}$/.test(primary) ? primary : null;
}

export function isDestinationUrl(raw: string): boolean {
  const v = raw.trim();
  if (!v || v.length > 500 || !/^https?:\/\//i.test(v)) return false;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function destinationRows(map: DestinationMap | null | undefined): DestinationRow[] {
  if (!map) return [];
  return Object.entries(map)
    .map(([code, url]) => ({ code, url }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

/** Rows → the map the settings API stores. Blank rows (no code and no
 *  URL) are ignored; a row with an empty URL REMOVES that code (the
 *  server's rule). Returns an error string instead when a row is bent
 *  — the form shows it and saves nothing. */
export function destinationMapFromRows(
  rows: DestinationRow[],
  kind: "territory" | "language",
): { ok: true; value: DestinationMap } | { ok: false; error: string } {
  const normalize = kind === "territory" ? normalizeCountryCode : normalizeLanguageCode;
  const label = kind === "territory" ? "country" : "language";
  const out: DestinationMap = {};
  for (const row of rows) {
    if (!row.code.trim() && !row.url.trim()) continue;
    const code = normalize(row.code);
    if (!code) {
      return { ok: false, error: `That ${label} code ("${row.code}") doesn't look right — ${kind === "territory" ? "use a two-letter code like DE or JP" : "use a code like es, de or pt"}. Nothing was saved.` };
    }
    if (row.url.trim() && !isDestinationUrl(row.url)) {
      return { ok: false, error: `The destination for ${code} must be a full http(s) URL. Nothing was saved.` };
    }
    if (code in out && out[code] !== row.url.trim()) {
      return { ok: false, error: `${code} is listed twice — keep one destination per ${label}. Nothing was saved.` };
    }
    out[code] = row.url.trim();
  }
  return { ok: true, value: out };
}
