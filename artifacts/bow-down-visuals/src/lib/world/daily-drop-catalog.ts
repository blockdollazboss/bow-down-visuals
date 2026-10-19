/* ─── Daily Drop catalogue — the Treasury's full template slate ──────
   (STACK-20 R2 item #18, UPGRADE-PROGRAM Ring 4)

   The Daily Drop catalogue is a code-level slate on the server: 30
   curated template defs rotating one per UTC day (DAILY_DROPS in the
   API's retention-drops routes). The card surfaces only TODAY's drop.
   This seam reads the catalogue route — every def with its real tool
   href, today's flag, and the member's own archived flags — so the
   Treasury can list the whole slate: USE any template (the href is
   the real rail into the tool, the same way today's drop has always
   been used) and ARCHIVE the ones a member doesn't want in their
   active list (per-member state, reversible, migration 0161).

   Everything here is a pure guard over the wire shape: a payload
   that fails the guard is the panel's error state, never rows. */

export const DAILY_DROP_CATALOG_PATH = "/api/retention/daily-drop/catalog";
export const DAILY_DROP_ARCHIVE_PATH = "/api/retention/daily-drop/archive";
export const DAILY_DROP_UNARCHIVE_PATH = "/api/retention/daily-drop/unarchive";

export type DailyDropKind = "thumbnail" | "caption" | "video" | "hook";

const DROP_KINDS: ReadonlySet<string> = new Set([
  "thumbnail",
  "caption",
  "video",
  "hook",
]);

export interface DailyDropCatalogEntry {
  key: string;
  kind: DailyDropKind;
  /** The real tool deep-link — using a template IS following this. */
  href: string;
  isToday: boolean;
  archived: boolean;
}

export interface DailyDropCatalog {
  /** false when the member turned Daily Drop off in retention prefs —
   *  the server closes the catalogue exactly like the daily drop. */
  enabled: boolean;
  date: string;
  drops: DailyDropCatalogEntry[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function normalizeDrop(raw: unknown): DailyDropCatalogEntry | null {
  if (!isRecord(raw)) return null;
  const { key, kind, href } = raw;
  if (typeof key !== "string" || key.length === 0) return null;
  if (typeof kind !== "string" || !DROP_KINDS.has(kind)) return null;
  if (typeof href !== "string" || !href.startsWith("/")) return null;
  return {
    key,
    kind: kind as DailyDropKind,
    href,
    isToday: raw.isToday === true,
    archived: raw.archived === true,
  };
}

/** Normalize a catalogue response. Returns null on any shape drift —
 *  the caller renders its failed state, never a partial slate dressed
 *  as the whole catalogue. */
export function normalizeDailyDropCatalog(raw: unknown): DailyDropCatalog | null {
  if (!isRecord(raw)) return null;
  if (raw.enabled === false) return { enabled: false, date: "", drops: [] };
  if (raw.enabled !== true) return null;
  if (!Array.isArray(raw.drops)) return null;
  const drops: DailyDropCatalogEntry[] = [];
  for (const item of raw.drops) {
    const drop = normalizeDrop(item);
    if (!drop) return null;
    drops.push(drop);
  }
  return {
    enabled: true,
    date: typeof raw.date === "string" ? raw.date : "",
    drops,
  };
}

/** The two lists the Treasury renders: what can be used today-ish
 *  (active) and what the member tidied away (archived). */
export function splitDailyDropCatalog(drops: DailyDropCatalogEntry[]): {
  active: DailyDropCatalogEntry[];
  archived: DailyDropCatalogEntry[];
} {
  return {
    active: drops.filter((d) => !d.archived),
    archived: drops.filter((d) => d.archived),
  };
}

/** Apply a confirmed archive/unarchive answer to the local slate.
 *  Called only AFTER the server confirms — a failed write never
 *  moves a row on screen. Unknown keys leave the slate untouched. */
export function applyDropArchive(
  drops: DailyDropCatalogEntry[],
  key: string,
  archived: boolean,
): DailyDropCatalogEntry[] {
  return drops.map((d) => (d.key === key ? { ...d, archived } : d));
}
