/* Pure helpers for the Title & Description Studio (/titles page).
   Kept in lib/ so they stay unit-testable without rendering the page. */

export interface RankedTitle {
  title: string;
  score: number;
  why: string;
}

export interface TitleStudioHistoryEntry {
  id: string;
  when: number;
  topic: string;
  platform: "youtube" | "tiktok" | "instagram";
  tone: "hype" | "professional" | "funny";
  titles: RankedTitle[];
  description: string;
  tags: string[];
}

export const TITLE_STUDIO_HISTORY_KEY = "bdv-title-studio-history";
export const TITLE_STUDIO_HISTORY_LIMIT = 20;

export function scoreColor(score: number): string {
  if (score >= 75) return "text-emerald-400";
  if (score >= 50) return "text-amber-400";
  return "text-red-400";
}

export function scoreBar(score: number): string {
  if (score >= 75) return "from-emerald-500 to-emerald-300";
  if (score >= 50) return "from-amber-500 to-amber-300";
  return "from-red-500 to-red-300";
}

/** Sanitize a raw localStorage value into history entries. Never throws —
 *  corrupted history must not crash the page. */
export function parseTitleStudioHistory(raw: string | null): TitleStudioHistoryEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is TitleStudioHistoryEntry =>
          !!e &&
          typeof (e as { topic?: unknown }).topic === "string" &&
          Array.isArray((e as { titles?: unknown }).titles)
      )
      .slice(0, TITLE_STUDIO_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

/** Prepend an entry, enforcing the history cap. Pure — the caller persists. */
export function pushTitleStudioHistory(
  prev: TitleStudioHistoryEntry[],
  entry: Omit<TitleStudioHistoryEntry, "id" | "when">
): TitleStudioHistoryEntry[] {
  const full: TitleStudioHistoryEntry = {
    ...entry,
    id: `${Date.now()}`,
    when: Date.now(),
  };
  return [full, ...prev].slice(0, TITLE_STUDIO_HISTORY_LIMIT);
}

/** Build the hashtag copy string: "#tag1 #tag2". */
export function tagsCopyString(tags: string[]): string {
  return tags.map((t) => `#${t.replace(/^#+/, "")}`).join(" ");
}
