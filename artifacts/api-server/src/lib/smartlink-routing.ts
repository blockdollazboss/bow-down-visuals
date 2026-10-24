/* Smartlink territory / language routing (Stack-100 #3 Wave 3, lane 10).
 *
 * VERIFIED ABSENT before this build (.lane/VERDICT.md): the release
 * smartlink (the persistent presave landing) had ONE flat destination
 * per platform for every fan on earth. The CDN geo header
 * (cf-ipcountry) was read only to record analytics, and the fan's
 * language was never read at all.
 *
 * This module is the pure resolution + validation core. It fabricates
 * no geo source: the country comes from the same header the smartlink
 * analytics already trust (requestCountry in routes/generate/
 * distribution.ts reads cf-ipcountry ?? x-vercel-ip-country), and the
 * language comes from the standard Accept-Language header the fan's
 * browser sends on the landing fetch.
 *
 * Resolution order (the redirect-path equivalent for a landing page —
 * this codebase's smartlink has no server redirect; the server resolves
 * at landing-payload time and the fan's tap follows the resolved URL):
 *   1. exact territory override (ISO country → creator-entered URL)
 *   2. language match (Accept-Language preference order, primary subtag)
 *   3. default — no routed destination; the page renders exactly the
 *      links it renders today.
 */

export type SmartlinkRouteRule = "territory" | "language";

export interface SmartlinkRoutedDestination {
  url: string;
  rule: SmartlinkRouteRule;
  /** ISO 3166-1 alpha-2 code that matched (rule = "territory"). */
  country?: string;
  /** Primary language subtag that matched (rule = "language"). */
  language?: string;
}

export type DestinationMap = Record<string, string>;

export const MAX_TERRITORY_DESTINATIONS = 100;
export const MAX_LANGUAGE_DESTINATIONS = 50;
export const MAX_DESTINATION_URL_LENGTH = 500;

/* ─── Normalizers ────────────────────────────────────────────────────── */

/** "de" / "DE" / " de " → "DE". "XX" (the CDN's unknown sentinel),
    "USA", "D1", "" → null. Creator-entered and fan-side codes share
    this shape so a stored key can only ever match a real signal. */
export function normalizeCountryCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(v) && v !== "XX" ? v : null;
}

/** "es" / "ES" / "es-MX" / "en_US" → the primary subtag ("es" / "en").
    Anything that isn't a 2–3 letter primary subtag → null. */
export function normalizeLanguageTag(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const primary = raw.trim().toLowerCase().split(/[-_]/)[0] ?? "";
  return /^[a-z]{2,3}$/.test(primary) ? primary : null;
}

function cleanDestinationUrl(value: string): string | null {
  const v = value.trim();
  if (!v || v.length > MAX_DESTINATION_URL_LENGTH) return null;
  if (!/^https?:\/\//i.test(v)) return null;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:" ? v : null;
  } catch {
    return null;
  }
}

/* ─── Accept-Language ────────────────────────────────────────────────── */

/** The fan's preferred primary language subtags, in preference order
    (q-value descending, header order breaking ties), deduplicated.
    Entries with q=0 ("not acceptable") are dropped; "*" is skipped —
    a wildcard is not a language a creator can target. */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header) return [];
  const parsed: Array<{ lang: string; q: number; idx: number }> = [];
  header.split(",").forEach((part, idx) => {
    const [tagRaw, ...params] = part.split(";");
    const lang = normalizeLanguageTag(tagRaw);
    if (!lang) return;
    let q = 1;
    for (const p of params) {
      const m = /^\s*q\s*=\s*([0-9]*\.?[0-9]+)\s*$/.exec(p);
      if (m) q = Number(m[1]);
    }
    if (!Number.isFinite(q) || q <= 0) return;
    parsed.push({ lang, q: Math.min(q, 1), idx });
  });
  parsed.sort((a, b) => b.q - a.q || a.idx - b.idx);
  const out: string[] = [];
  for (const p of parsed) if (!out.includes(p.lang)) out.push(p.lang);
  return out;
}

/* ─── Resolution ─────────────────────────────────────────────────────── */

export function resolveSmartlinkDestination(input: {
  territoryDestinations: DestinationMap | null | undefined;
  languageDestinations: DestinationMap | null | undefined;
  country: string | null;
  acceptLanguage: string | null | undefined;
}): SmartlinkRoutedDestination | null {
  const territory = input.territoryDestinations ?? {};
  if (input.country && territory[input.country]) {
    return { url: territory[input.country], rule: "territory", country: input.country };
  }
  const language = input.languageDestinations ?? {};
  for (const lang of parseAcceptLanguage(input.acceptLanguage)) {
    if (language[lang]) return { url: language[lang], rule: "language", language: lang };
  }
  return null;
}

/* ─── Creator-input validation (presave-settings save) ─────────────────
   Same discipline as cleanPixelId: undefined = leave as-is, an entry
   with an empty URL removes that entry, and anything malformed refuses
   the WHOLE save — a bent routing table stored silently would send
   fans to the wrong place and lie by omission. */

export type CleanDestinationsResult =
  | { ok: true; value: DestinationMap }
  | { ok: false; error: string };

export function cleanTerritoryDestinations(
  raw: DestinationMap | undefined,
  current: DestinationMap,
): CleanDestinationsResult {
  if (raw === undefined) return { ok: true, value: current };
  const out: DestinationMap = {};
  for (const [key, value] of Object.entries(raw)) {
    const code = normalizeCountryCode(key);
    if (!code) {
      return { ok: false, error: `That country code ("${key}") doesn't look right — use a two-letter code like DE, JP or BR.` };
    }
    if (typeof value !== "string") {
      return { ok: false, error: `The destination for ${code} must be a URL.` };
    }
    if (!value.trim()) continue; /* empty = remove this territory */
    const url = cleanDestinationUrl(value);
    if (!url) {
      return { ok: false, error: `The destination for ${code} must be a full http(s) URL (max ${MAX_DESTINATION_URL_LENGTH} characters).` };
    }
    if (out[code]) {
      return { ok: false, error: `${code} is listed twice — keep one destination per country.` };
    }
    out[code] = url;
  }
  if (Object.keys(out).length > MAX_TERRITORY_DESTINATIONS) {
    return { ok: false, error: `That's too many territory destinations — the limit is ${MAX_TERRITORY_DESTINATIONS}.` };
  }
  return { ok: true, value: out };
}

export function cleanLanguageDestinations(
  raw: DestinationMap | undefined,
  current: DestinationMap,
): CleanDestinationsResult {
  if (raw === undefined) return { ok: true, value: current };
  const out: DestinationMap = {};
  for (const [key, value] of Object.entries(raw)) {
    const lang = normalizeLanguageTag(key);
    if (!lang) {
      return { ok: false, error: `That language code ("${key}") doesn't look right — use a code like es, de or pt.` };
    }
    if (typeof value !== "string") {
      return { ok: false, error: `The destination for ${lang} must be a URL.` };
    }
    if (!value.trim()) continue; /* empty = remove this language */
    const url = cleanDestinationUrl(value);
    if (!url) {
      return { ok: false, error: `The destination for ${lang} must be a full http(s) URL (max ${MAX_DESTINATION_URL_LENGTH} characters).` };
    }
    if (out[lang]) {
      return { ok: false, error: `${lang} is listed twice — keep one destination per language.` };
    }
    out[lang] = url;
  }
  if (Object.keys(out).length > MAX_LANGUAGE_DESTINATIONS) {
    return { ok: false, error: `That's too many language destinations — the limit is ${MAX_LANGUAGE_DESTINATIONS}.` };
  }
  return { ok: true, value: out };
}

/** Defensive read-side shape check for a stored jsonb map: keeps only
    entries whose key normalizes and whose value is a clean http(s)
    URL. Stored data was validated on save; this guards rows written
    any other way so a bad row can never route a fan. */
export function sanitizeDestinationMap(
  raw: unknown,
  kind: "territory" | "language",
): DestinationMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: DestinationMap = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const norm = kind === "territory" ? normalizeCountryCode(key) : normalizeLanguageTag(key);
    if (!norm || typeof value !== "string") continue;
    const url = cleanDestinationUrl(value);
    if (url) out[norm] = url;
  }
  return out;
}
