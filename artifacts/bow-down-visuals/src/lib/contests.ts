/* ─── Fan Contests frontend helpers ─────────────────────────────────────
   Pure client-side helpers for the /contests page: the entry-method
   catalog (mirrors the server's ENTRY_METHODS) and formatters for the
   provably-fair draw audit log. No network, no credits — unit-tested. */

interface EntryMethodInfo {
  key: string;
  label: string;
  blurb: string;
}

export const ENTRY_METHOD_CATALOG: EntryMethodInfo[] = [
  { key: "follow", label: "Follow", blurb: "Entrants follow your account" },
  { key: "comment", label: "Comment", blurb: "Entrants comment on the contest post" },
  { key: "share", label: "Share", blurb: "Entrants share the contest with friends" },
  { key: "purchase", label: "Purchase", blurb: "Entrants buy merch / music to enter" },
];


/**
 * Shortens a 64-char draw seed for display, e.g. "a3f9…c21d".
 * Returns the full value when it's unexpectedly short (never hide data).
 */
export function shortSeed(seed: string | undefined | null): string {
  if (!seed) return "—";
  if (seed.length <= 16) return seed;
  return `${seed.slice(0, 6)}…${seed.slice(-4)}`;
}

/**
 * Formats the draw timestamp for the audit panel.
 * Falls back to the raw string when it isn't a valid date.
 */
export function formatDrawnAt(iso: string | undefined | null, locale?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Human-readable contest status label.
 */
export function statusLabel(status: string | undefined | null): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "active":
      return "Live";
    case "ended":
      return "Ended";
    default:
      return status ?? "—";
  }
}
