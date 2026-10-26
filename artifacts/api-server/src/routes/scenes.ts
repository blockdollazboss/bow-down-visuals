import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { publicApiLimiter } from "../lib/rate-limit";
import { refreshSupabaseStorageUrlsDeep } from "../lib/objectStorage";
import { isMissingSchemaError } from "../lib/pg-errors";
import {
  aggregateSceneDirectory,
  aggregateShowCounts,
  cityKey,
  cityNamePart,
  citySlug,
  slugToCityKey,
} from "../lib/scenes";
import { topTracks, topVideos, type Window } from "./discovery";

/* ─── Local Scenes (Stack-200 N10) ────────────────────────────────────────
   Mounted under /api/discovery (routes/index.ts), beside the charts —
   scenes ARE a discovery surface, not a standalone microsite.

   A scene page is the house's map of ONE city's music, built from REAL
   rows only:
   - CREATORS: public creator profiles whose declared_city (free text
     the creator typed into profile setup themselves) names this city.
     Nobody is geocoded, inferred, or assigned — undeclared creators
     appear on no scene page.
   - SHOWS: real tour_dates rows (the Tour Planner's own records:
     city + venue + date, owned by a creator) whose city names this
     scene, status upcoming/confirmed, not in the past. Show Finder
     output is AI suggestion text with no rows behind it — it is never
     read here and can never appear as a scene show. Platform `events`
     carry no location at all, so they are not scene shows either.
     Tour-date NOTES are never shipped (freeform planner text — it can
     hold promoter contacts).
   - SCENE CHART: the main charts' own counting, scoped to the city's
     creators — topTracks/topVideos from routes/discovery, the exact
     functions behind /api/discovery/charts (windowed = play_events
     COUNT, all-time = the counter columns). No second counting method
     exists that could disagree with the main chart.

   HONESTY CONTRACT: a city with no declared-location creators has NO
   scene — GET /scenes/:slug answers 404 "No scene here yet", and the
   directory lists a city only when ≥1 real creator declared it (the
   rule lives in lib/scenes aggregateSceneDirectory). Empty sections
   ship as empty arrays and the page says so in plain words.

   Pre-migration (declared_city column held in 9999-local-scenes):
   reads degrade via isMissingSchemaError — directory answers an empty
   list, a city page answers the honest no-scene 404. Never a 500,
   never a fabricated scene. */

const router = Router();

const asyncHandler =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response): void => {
    fn(req, res).catch((err) => {
      console.error("[scenes]", err);
      res.status(500).json({ error: "Scene hiccup — try again." });
    });
  };

const clampLimit = (v: unknown, def = 20, max = 50): number => {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(1, Math.min(max, Math.floor(n)));
};

const SceneQuery = z.object({
  window: z.enum(["today", "week", "all"]).default("all"),
  limit: z.coerce.number().optional(),
});

interface DeclaredCreatorRow extends Record<string, unknown> {
  profile_id: string;
  slug: string;
  display_name: string;
  avatar_url: string | null;
  vertical: string;
  follower_count: number;
  total_plays: number;
  declared_city: string | null;
}

interface ShowRow extends Record<string, unknown> {
  id: string;
  city: string;
  venue: string;
  show_date: string | Date;
  status: string;
  profile_id: string;
  slug: string;
  display_name: string;
  avatar_url: string | null;
}

/* Every public profile that declared a city, lite columns only. The
   scene filter itself runs through lib/scenes cityKey so route, lib
   and tests share one normalization. */
async function loadDeclaredCreators(): Promise<DeclaredCreatorRow[]> {
  const rows = await db.execute(sql`
    SELECT p.id AS profile_id, p.slug, p.display_name, p.avatar_url,
           p.vertical, p.follower_count, p.total_plays, p.declared_city
    FROM creator_profiles p
    WHERE p.is_public
      AND p.declared_city IS NOT NULL
      AND TRIM(p.declared_city) <> ''
    ORDER BY p.total_plays DESC`);
  return rows.rows as unknown as DeclaredCreatorRow[];
}

/* Real shows: tour_dates rows in the near future (a 1-day grace so a
   show happening tonight never vanishes mid-evening), owned by a
   public creator profile. Cancelled/completed rows are not scene
   shows. Notes are deliberately NOT selected. */
async function loadShows(): Promise<ShowRow[]> {
  const rows = await db.execute(sql`
    SELECT td.id, td.city, td.venue, td.show_date, td.status,
           p.id AS profile_id, p.slug, p.display_name, p.avatar_url
    FROM tour_dates td
    JOIN creator_profiles p ON p.user_id = td.user_id
    WHERE p.is_public
      AND td.status IN ('upcoming', 'confirmed')
      AND td.show_date >= NOW() - INTERVAL '1 day'
    ORDER BY td.show_date ASC`);
  return rows.rows as unknown as ShowRow[];
}

function noScene(res: Response): void {
  res.status(404).json({
    error: "No scene here yet — no creator has declared this city.",
    scene: null,
  });
}

/* GET /api/discovery/scenes — the scene directory. Only cities with at
   least one real declared-location creator are listed. */
router.get("/scenes", publicApiLimiter, asyncHandler(async (_req, res) => {
  try {
    const declared = await db.execute(sql`
      SELECT declared_city, COUNT(*)::int AS creator_count
      FROM creator_profiles
      WHERE is_public
        AND declared_city IS NOT NULL
        AND TRIM(declared_city) <> ''
      GROUP BY declared_city`);
    let showCounts = new Map<string, number>();
    try {
      const showRows = await db.execute(sql`
        SELECT td.city AS city, COUNT(*)::int AS show_count
        FROM tour_dates td
        JOIN creator_profiles p ON p.user_id = td.user_id
        WHERE p.is_public
          AND td.status IN ('upcoming', 'confirmed')
          AND td.show_date >= NOW() - INTERVAL '1 day'
        GROUP BY td.city`);
      showCounts = aggregateShowCounts(
        showRows.rows as unknown as Array<{ city: string | null; show_count: number }>,
      );
    } catch (err) {
      if (!isMissingSchemaError(err)) throw err;
      /* tour_dates predates the held migration by years; a missing
         table here just means no shows to count yet. */
    }
    const cities = aggregateSceneDirectory(
      declared.rows as unknown as Array<{ declared_city: string | null; creator_count: number }>,
      showCounts,
    );
    res.json(await refreshSupabaseStorageUrlsDeep({ cities }));
  } catch (err) {
    if (isMissingSchemaError(err)) {
      /* declared_city not migrated yet: the honest directory is empty. */
      res.json({ cities: [] });
      return;
    }
    throw err;
  }
}));

/* GET /api/discovery/scenes/:slug — one city's scene page. */
router.get("/scenes/:slug", publicApiLimiter, asyncHandler(async (req, res) => {
  const parsed = SceneQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid query: window must be one of today|week|all.",
    });
    return;
  }
  const key = slugToCityKey(String(req.params.slug ?? ""));
  if (!key) {
    noScene(res);
    return;
  }
  const limit = clampLimit(parsed.data.limit);
  const window = parsed.data.window as Window;

  let creators: DeclaredCreatorRow[];
  try {
    creators = (await loadDeclaredCreators()).filter(
      (row) => cityKey(row.declared_city) === key,
    );
  } catch (err) {
    if (isMissingSchemaError(err)) {
      noScene(res);
      return;
    }
    throw err;
  }
  /* THE rule: no declared-location creators → no scene page. Ever. */
  if (creators.length === 0) {
    noScene(res);
    return;
  }

  let shows: ShowRow[] = [];
  try {
    shows = (await loadShows()).filter((row) => cityKey(row.city) === key);
  } catch (err) {
    if (!isMissingSchemaError(err)) throw err;
    shows = [];
  }

  const profileIds = creators.map((c) => c.profile_id);
  const [tracks, videos] = await Promise.all([
    topTracks(window, undefined, undefined, limit, undefined, profileIds),
    topVideos(window, undefined, undefined, limit, undefined, profileIds),
  ]);

  /* Display name = the form the most creators in this scene wrote. */
  const formCounts = new Map<string, number>();
  for (const c of creators) {
    const name = cityNamePart(c.declared_city);
    if (name) formCounts.set(name, (formCounts.get(name) ?? 0) + 1);
  }
  let displayName = creators[0] ? cityNamePart(creators[0].declared_city) ?? key : key;
  let best = -1;
  for (const [form, n] of formCounts) {
    if (n > best) { best = n; displayName = form; }
  }

  res.json(await refreshSupabaseStorageUrlsDeep({
    city: { slug: citySlug(key), name: displayName },
    creators,
    shows,
    chart: { window, tracks, videos },
    counts: {
      creators: creators.length,
      shows: shows.length,
      tracks: tracks.length,
      videos: videos.length,
    },
  }));
}));

export default router;
