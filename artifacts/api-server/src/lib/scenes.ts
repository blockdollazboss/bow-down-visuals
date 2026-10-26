/* ─── Local Scenes (Stack-200 N10) — city identity from DECLARED text ─────
   A scene exists only where creators said they are. The single source of
   truth is creator_profiles.declared_city: free text the creator typed
   into profile setup themselves ("New York", "New York, NY", "bronx,
   new york"). Nothing here geocodes, infers, or assigns a city to
   anyone — these helpers only normalize what was declared so two
   spellings of the same declaration meet on one page.

   City identity rule: the city NAME is the part before the first comma
   (creators write "City, ST" — the state rides along as decoration,
   never as a separate scene). Matching is case- and spacing-insensitive
   on that name part. A declared value with no name part (", NY") declares
   nothing and keys to null. */

/** Normalize a declared city string to its scene key, or null when the
    declaration carries no city name. */
export function cityKey(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const name = raw.split(",")[0]!.trim().replace(/\s+/g, " ");
  if (name === "") return null;
  return name.toLowerCase();
}

/** The display name part of a declared city, case preserved as the
    creator wrote it ("New York" out of "New York, NY"). */
export function cityNamePart(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const name = raw.split(",")[0]!.trim().replace(/\s+/g, " ");
  return name === "" ? null : name;
}

/** URL slug for a city key: "new york" → "new-york". */
export function citySlug(key: string): string {
  return key.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Inverse of citySlug for route params: "new-york" → "new york". */
export function slugToCityKey(slug: string): string {
  return slug.trim().toLowerCase().replace(/-+/g, " ").replace(/\s+/g, " ");
}

export interface SceneDirectoryEntry {
  slug: string;
  name: string;
  creator_count: number;
  show_count: number;
}

/* DIRECTORY RULE (the honesty contract, pinned by tests): a city is
   listed ONLY when at least one public creator declared it. Cities are
   never seeded, suggested, or padded — the directory is an aggregate of
   declarations, nothing else. New York lists first when it exists
   (the launch scene); the rest order by creator count, then name. */
export function aggregateSceneDirectory(
  declaredRows: Array<{ declared_city: string | null; creator_count: number }>,
  showCountsByKey: Map<string, number>,
): SceneDirectoryEntry[] {
  const byKey = new Map<string, { forms: Map<string, number>; creator_count: number }>();
  for (const row of declaredRows) {
    const key = cityKey(row.declared_city);
    if (!key) continue;
    const name = cityNamePart(row.declared_city)!;
    const entry = byKey.get(key) ?? { forms: new Map<string, number>(), creator_count: 0 };
    entry.creator_count += row.creator_count;
    entry.forms.set(name, (entry.forms.get(name) ?? 0) + row.creator_count);
    byKey.set(key, entry);
  }
  const entries: SceneDirectoryEntry[] = [];
  for (const [key, entry] of byKey) {
    if (entry.creator_count < 1) continue; // the directory rule, enforced in code
    /* Display name = the form the most creators actually wrote. */
    let name = "";
    let best = -1;
    for (const [form, n] of entry.forms) {
      if (n > best) { best = n; name = form; }
    }
    entries.push({
      slug: citySlug(key),
      name,
      creator_count: entry.creator_count,
      show_count: showCountsByKey.get(key) ?? 0,
    });
  }
  entries.sort((a, b) => {
    const aNy = a.slug === "new-york" ? 0 : 1;
    const bNy = b.slug === "new-york" ? 0 : 1;
    if (aNy !== bNy) return aNy - bNy;
    if (b.creator_count !== a.creator_count) return b.creator_count - a.creator_count;
    return a.name.localeCompare(b.name);
  });
  return entries;
}

/** Aggregate raw tour-date city strings into per-key upcoming show counts. */
export function aggregateShowCounts(
  rows: Array<{ city: string | null; show_count: number }>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    const key = cityKey(row.city);
    if (!key) continue;
    out.set(key, (out.get(key) ?? 0) + row.show_count);
  }
  return out;
}
