/**
 * scenes-desk — the seam behind the Community Hall's native
 * Local Scenes desk (stack1500 world parity wave #3, census
 * item 16; before this wave the World had no scene surface at
 * all — the census counted scenes ABSENT).
 *
 * Source of truth: artifacts/api-server/src/routes/scenes.ts,
 * mounted under /api/discovery (routes/index.ts), and the
 * website's own client contract in lib/scenes.ts — the desk
 * rides those exact fetchers (fetchSceneDirectory / fetchScene)
 * so the in-World scene is the website's scene, never a second
 * counting method. Both rails are PUBLIC: no auth, no charge,
 * guests browse in full.
 *
 * THE DIRECTORY RULE (the rail's honesty contract, mirrored
 * client-side by lib/scenes.visibleCities and re-pinned here):
 * a city lists ONLY when at least one public creator declared
 * it. A city with no declared creators has NO scene — the rail
 * 404s ("No scene here yet") and fetchScene answers null; the
 * desk renders that plainly, never an empty dressed-up shell.
 *
 * Row shapers are defensive on the fields the desk prints:
 * a row missing its name/title drops rather than rendering a
 * blank card. Counts come from the rail's own numbers.
 */
import {
  fetchScene,
  fetchSceneDirectory,
  formatShowDate,
  visibleCities,
  type SceneCityEntry,
  type ScenePage,
} from "@/lib/scenes";

export const SCENES_PATH = "/api/discovery/scenes";

export type SceneWindow = "today" | "week" | "all";

export const SCENE_WINDOWS: ReadonlyArray<{ key: SceneWindow; label: string }> = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "all", label: "All time" },
];

export { fetchScene, fetchSceneDirectory, visibleCities };
export type { SceneCityEntry, ScenePage };

export interface SceneCityRow {
  slug: string;
  name: string;
  creatorCount: number;
  showCount: number;
}

export function cityRowOf(entry: SceneCityEntry | null | undefined): SceneCityRow | null {
  if (!entry || typeof entry.slug !== "string" || !entry.slug) return null;
  if (typeof entry.name !== "string" || !entry.name) return null;
  if (typeof entry.creator_count !== "number" || entry.creator_count < 1) return null;
  return {
    slug: entry.slug,
    name: entry.name,
    creatorCount: entry.creator_count,
    showCount: typeof entry.show_count === "number" ? entry.show_count : 0,
  };
}

export interface SceneCreatorRow {
  profileId: string;
  slug: string;
  displayName: string;
  vertical: string | null;
  followerCount: number;
  totalPlays: number;
}

export interface SceneShowRow {
  id: string;
  venue: string;
  dateLabel: string;
  status: string;
  displayName: string;
}

export interface SceneChartRow {
  id: string;
  title: string;
  genre: string | null;
  plays: number;
  likes: number;
}

export interface SceneDetail {
  slug: string;
  name: string;
  creators: SceneCreatorRow[];
  shows: SceneShowRow[];
  tracks: SceneChartRow[];
  videos: SceneChartRow[];
  counts: { creators: number; shows: number; tracks: number; videos: number };
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Shape one scene page for the desk. Null in (the rail's 404)
 *  stays null out — the desk's no-scene state. */
export function sceneDetailOf(page: ScenePage | null): SceneDetail | null {
  if (!page) return null;
  const creators: SceneCreatorRow[] = [];
  for (const c of page.creators ?? []) {
    const name = str(c?.display_name);
    if (!name || !str(c?.profile_id)) continue;
    creators.push({
      profileId: c.profile_id,
      slug: typeof c.slug === "string" ? c.slug : "",
      displayName: name,
      vertical: str(c.vertical),
      followerCount: num(c.follower_count),
      totalPlays: num(c.total_plays),
    });
  }
  const shows: SceneShowRow[] = [];
  for (const s of page.shows ?? []) {
    if (!str(s?.id) || !str(s?.venue)) continue;
    shows.push({
      id: s.id,
      venue: s.venue,
      dateLabel: formatShowDate(typeof s.show_date === "string" ? s.show_date : ""),
      status: typeof s.status === "string" ? s.status : "",
      displayName: str(s.display_name) ?? "",
    });
  }
  const chartRow = (r: { id?: unknown; title?: unknown; genre?: unknown; play_count?: unknown; view_count?: unknown; like_count?: unknown }): SceneChartRow | null => {
    const title = str(r?.title);
    if (!title || !str(r?.id)) return null;
    return {
      id: r.id as string,
      title,
      genre: str(r.genre),
      plays: num(r.play_count ?? r.view_count),
      likes: num(r.like_count),
    };
  };
  const tracks = (page.chart?.tracks ?? []).map(chartRow).filter((r): r is SceneChartRow => r !== null);
  const videos = (page.chart?.videos ?? []).map(chartRow).filter((r): r is SceneChartRow => r !== null);
  return {
    slug: page.city?.slug ?? "",
    name: page.city?.name ?? "",
    creators,
    shows,
    tracks,
    videos,
    counts: {
      creators: num(page.counts?.creators),
      shows: num(page.counts?.shows),
      tracks: num(page.counts?.tracks),
      videos: num(page.counts?.videos),
    },
  };
}
