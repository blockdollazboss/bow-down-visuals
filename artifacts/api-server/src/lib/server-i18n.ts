/**
 * Server-side locale core — the ten site languages and how a request
 * resolves to one of them.
 *
 * The frontend's language choice lives only in the browser
 * (localStorage "bdv-language" — see the web app's lib/i18n.ts); the
 * server keeps NO stored language preference for a member, so every
 * localized server surface resolves a locale per request:
 *   1. an explicit `locale` field on the request (JSON body or query
 *      string — each route documents which it reads);
 *   2. English.
 *
 * Per-surface copy catalogs (email-automation-i18n.ts,
 * move-home-i18n.ts, catalog-import-i18n.ts) build on these
 * primitives so every server surface normalizes and falls back the
 * same way. House conventions for all catalogs: "Visual Bucs",
 * "Bow Down Visuals" and "Thy Cheat Code" are never translated, and
 * interpolation placeholders keep their exact shape ({name}) in every
 * locale — the catalog tests pin placeholder parity.
 */

export const SERVER_LOCALES = [
  "en",
  "es",
  "fr",
  "pt",
  "de",
  "it",
  "hi",
  "ar",
  "ja",
  "ko",
] as const;

export type ServerLocale = (typeof SERVER_LOCALES)[number];

const LOCALE_SET = new Set<string>(SERVER_LOCALES);

/** Normalize a raw locale value ("pt-BR", "EN", "es") to one of the
 *  supported codes, or null when it names nothing we carry. The
 *  base-language split mirrors the web app's own document-language
 *  handling (lib/i18n.ts splits on "-"). */
export function normalizeServerLocale(value: unknown): ServerLocale | null {
  if (typeof value !== "string") return null;
  const base = value.trim().toLowerCase().split(/[-_]/)[0] ?? "";
  return LOCALE_SET.has(base) ? (base as ServerLocale) : null;
}

/** First resolvable candidate wins; English when none resolve. */
export function resolveServerLocale(...candidates: unknown[]): ServerLocale {
  for (const candidate of candidates) {
    const locale = normalizeServerLocale(candidate);
    if (locale) return locale;
  }
  return "en";
}

/** Fill `{name}` placeholders in a catalog template from `vars`, in a
 *  single pass: inserted values are data (names, titles the creator
 *  typed) and are never re-scanned for placeholders, and a placeholder
 *  with no matching var is left exactly as written. */
export function fillServerTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? vars[name]! : whole,
  );
}
