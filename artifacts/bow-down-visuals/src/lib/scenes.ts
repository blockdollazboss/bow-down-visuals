import type { CreatorLite, TrackLite, VideoLite } from "@/components/discovery/cards";

/* ─── Local Scenes (Stack-200 N10) — client contract ──────────────────────
   Scene pages are built server-side from REAL rows only (declared-city
   creators, real tour-date shows, the main charts' play counting scoped
   to the city). This module is the fetch + shape layer; the honesty
   rules live on the server, and `visibleCities` mirrors the directory
   rule here so a malformed payload can never render a fake city:
   a city lists ONLY when it carries at least one real creator. */

export interface SceneCityEntry {
  slug: string;
  name: string;
  creator_count: number;
  show_count: number;
}

export interface SceneCreator extends CreatorLite {
  profile_id: string;
  declared_city: string | null;
}

export interface SceneShow {
  id: string;
  city: string;
  venue: string;
  show_date: string;
  status: string;
  profile_id: string;
  slug: string;
  display_name: string;
  avatar_url: string | null;
}

export interface ScenePage {
  city: { slug: string; name: string };
  creators: SceneCreator[];
  shows: SceneShow[];
  chart: { window: string; tracks: TrackLite[]; videos: VideoLite[] };
  counts: { creators: number; shows: number; tracks: number; videos: number };
}

/** THE DIRECTORY RULE, mirrored client-side: only cities with at least
    one real declared-location creator are visible. */
export function visibleCities(cities: SceneCityEntry[] | null | undefined): SceneCityEntry[] {
  if (!Array.isArray(cities)) return [];
  return cities.filter((c) => c && typeof c.creator_count === "number" && c.creator_count >= 1 && !!c.slug);
}

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(path, { headers: { Accept: "application/json" } });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

export async function fetchSceneDirectory(): Promise<SceneCityEntry[]> {
  const data = await getJson<{ cities: SceneCityEntry[] }>("/api/discovery/scenes");
  return visibleCities(data?.cities);
}

export async function fetchScene(slug: string, window: "today" | "week" | "all" = "all"): Promise<ScenePage | null> {
  return getJson<ScenePage>(`/api/discovery/scenes/${encodeURIComponent(slug)}?window=${window}`);
}

/** "Fri, Nov 14 · 8:00 PM" in the viewer's own timezone, from the real
    stored instant. Unparseable dates render as the raw string — never
    an invented one. */
export function formatShowDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
