/* Presave tracklist preview shaping (wave 3 #15).
   The public presave payload carries the release's tracklist as
   owner-published metadata only — position, title, and a duration
   when the release record carries one. These helpers shape that
   payload for the landing page; there is deliberately no audio
   field anywhere in this shape, so nothing here can leak an
   unreleased track. */

export interface PresaveTracklistEntry {
  position: number;
  title: string;
  durationSeconds: number | null;
}

export interface PresaveTracklistRow extends PresaveTracklistEntry {
  /** "3:07" when a duration is known, null when it is not — the page
      renders nothing rather than inventing a length. */
  durationLabel: string | null;
}

export function formatTrackDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return `${m}:${String(rest).padStart(2, "0")}`;
}

/** Defensive shaping of the payload value: non-arrays become an empty
    list, entries without a usable title drop out, and positions are
    re-sequenced to the visible order. */
export function presaveTracklistRows(value: unknown): PresaveTracklistRow[] {
  if (!Array.isArray(value)) return [];
  const rows: PresaveTracklistRow[] = [];
  for (const raw of value as Array<Record<string, unknown>>) {
    if (!raw || typeof raw !== "object") continue;
    const title = typeof raw["title"] === "string" ? raw["title"].trim() : "";
    if (!title) continue;
    const d = raw["durationSeconds"];
    const durationSeconds =
      typeof d === "number" && Number.isFinite(d) && d > 0 ? Math.round(d) : null;
    rows.push({
      position: rows.length + 1,
      title,
      durationSeconds,
      durationLabel: durationSeconds !== null ? formatTrackDuration(durationSeconds) : null,
    });
  }
  return rows;
}
