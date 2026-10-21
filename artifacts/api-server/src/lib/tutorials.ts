/**
 * tutorials.ts — Tutorials V1, the service layer (tutorials-scope.md).
 *
 * The two-sided how-to system lives INSIDE the Creator Academy:
 * Bow Down's official tutorials teach members the site; creators
 * designate their own published videos as tutorials for their fans.
 * This lib owns every rule; routes/tutorials.ts is the HTTP shape.
 *
 * House laws baked in:
 *  - FREE: nothing here imports credits code or charges anything.
 *    Official tutorials are free for fans, full stop.
 *  - OFFICIAL IS ADMIN-ONLY: isOfficial can only be set by an
 *    ADMIN_EMAILS account (fail-closed, the routes/admin.ts rule).
 *    A member designating their own video gets a creator tutorial,
 *    never an official one.
 *  - HONEST MEDIA: a tutorial whose video is still in production
 *    carries videoId NULL and the surfaces say so — the chapter
 *    walkthrough (the script) is the lesson until production lands.
 *  - NOTHING INVENTED: the official seed below is the production
 *    pack's own material — the five operating-flow paths from the
 *    scope and the pilot "Make Your First Song" with its scripted
 *    chapters and narration verbatim. No other lesson content is
 *    fabricated here; the rest of the slate arrives by designation
 *    as its videos are produced.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  db,
  tutorialsTable,
  tutorialSeriesTable,
  tutorialChaptersTable,
  tutorialResourcesTable,
  tutorialProgressTable,
  creatorProfilesTable,
  profileVideosTable,
  TUTORIAL_CATEGORIES,
  type Tutorial,
  type TutorialSeries,
  type TutorialCategory,
} from "@workspace/db";

/* ─── errors ─────────────────────────────────────────────────────────── */

export class TutorialError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/* ─── actors + admin ─────────────────────────────────────────────────── */

export interface TutorialActor {
  userId: string;
  email?: string | null;
}

/** The house admin test (routes/admin.ts): ADMIN_EMAILS, comma-
    separated, case-insensitive — unset allowlist means NOBODY is an
    admin (fail closed). */
export function isTutorialAdmin(email?: string | null): boolean {
  const e = (email ?? "").trim().toLowerCase();
  if (!e) return false;
  return (process.env["ADMIN_EMAILS"] ?? "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
    .includes(e);
}

/* ─── DTOs ───────────────────────────────────────────────────────────── */

export interface TutorialVideoDto {
  id: string;
  title: string;
  url: string;
  thumbnailUrl: string | null;
  durationSec: number;
}

export interface TutorialCardDto {
  id: string;
  slug: string;
  title: string;
  description: string;
  category: TutorialCategory;
  isOfficial: boolean;
  access: string;
  position: number;
  seriesId: string | null;
  creatorSlug: string | null;
  creatorName: string | null;
  /** false = the video is still in production; walkthrough only. */
  hasVideo: boolean;
  videoDurationSec: number | null;
  chapterCount: number;
  chapterTitles: string[];
}

export interface TutorialSeriesDto {
  id: string;
  slug: string;
  title: string;
  description: string;
  category: TutorialCategory;
  isOfficial: boolean;
  position: number;
  tutorials: TutorialCardDto[];
}

export interface TutorialCatalogDto {
  series: TutorialSeriesDto[];
  standalone: TutorialCardDto[];
}

export interface TutorialChapterDto {
  id: string;
  position: number;
  title: string;
  startSec: number | null;
  body: string;
}

export interface TutorialResourceDto {
  id: string;
  chapterId: string | null;
  title: string;
  url: string;
  kind: "download" | "link";
  position: number;
}

export interface TutorialDetailDto {
  id: string;
  slug: string;
  title: string;
  description: string;
  category: TutorialCategory;
  isOfficial: boolean;
  access: string;
  guideRoute: string | null;
  tryRoute: string | null;
  transcript: string | null;
  video: TutorialVideoDto | null;
  chapters: TutorialChapterDto[];
  resources: TutorialResourceDto[];
  series: { id: string; slug: string; title: string } | null;
  next: { slug: string; title: string } | null;
  creator: { slug: string; displayName: string } | null;
}

export interface TutorialProgressDto {
  tutorialId: string;
  status: "started" | "in_progress" | "completed";
  completedChapterIds: string[];
  lastChapterId: string | null;
  lastPositionSec: number;
  completedAt: string | null;
}

/* ─── slugs ──────────────────────────────────────────────────────────── */

export function slugifyTitle(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return base || "tutorial";
}

async function uniqueTutorialSlug(base: string): Promise<string> {
  let candidate = base;
  for (let n = 2; n < 100; n++) {
    const [row] = await db
      .select({ id: tutorialsTable.id })
      .from(tutorialsTable)
      .where(eq(tutorialsTable.slug, candidate))
      .limit(1);
    if (!row) return candidate;
    candidate = `${base}-${n}`;
  }
  return `${base}-${Date.now()}`;
}

async function uniqueSeriesSlug(base: string): Promise<string> {
  let candidate = base;
  for (let n = 2; n < 100; n++) {
    const [row] = await db
      .select({ id: tutorialSeriesTable.id })
      .from(tutorialSeriesTable)
      .where(eq(tutorialSeriesTable.slug, candidate))
      .limit(1);
    if (!row) return candidate;
    candidate = `${base}-${n}`;
  }
  return `${base}-${Date.now()}`;
}

/* ─── the official seed ──────────────────────────────────────────────── */

/** The site's operating flow (scope §6): the official series shelves,
    in order. Seeded lazily under the official house profile; until
    that profile exists there is nothing honest to attach them to. */
const OFFICIAL_SERIES: Array<{ slug: string; title: string; category: TutorialCategory; position: number }> = [
  { slug: "start-here", title: "Start Here", category: "start-here", position: 1 },
  { slug: "create", title: "Create", category: "create", position: 2 },
  { slug: "brand", title: "Brand", category: "brand", position: 3 },
  { slug: "promote", title: "Promote", category: "promote", position: 4 },
  { slug: "money", title: "Money", category: "money", position: 5 },
];

/** The pilot, verbatim from the production pack
    (tutorials-production/pilot-make-your-first-song.md): chapter
    markers + the narration, which IS the walkthrough text. The video
    itself is a production-track deliverable — videoId stays NULL
    until the finished capture is published and attached, and the
    surfaces present the walkthrough honestly in the meantime. */
const PILOT = {
  slug: "make-your-first-song",
  title: "Make Your First Song",
  description:
    "In the next ninety seconds, you're gonna have a finished song — your idea, your words, your voice. Watch how easy this is.",
  guideRoute: "/make-song",
  tryRoute: "/make-song",
  chapters: [
    {
      startSec: 0,
      title: "Your first song starts now",
      body: "Welcome to Bow Down Visuals. I'm Thy Cheat Code. In the next ninety seconds, you're gonna have a finished song — your idea, your words, your voice. Watch how easy this is.",
    },
    {
      startSec: 8,
      title: "Step 1: Describe the vibe",
      body: "Step one — tell it the vibe. Title, genre, mood, and what the song is about. Be specific. “A late-night record about winning” will beat “a sad song” every single time. This is you briefing your co-writer.",
    },
    {
      startSec: 30,
      title: "Step 2: Get the lyrics right",
      body: "Step two — the lyrics. It writes the whole song: verses, chorus, bridge. Don't love a line? Regenerate just that section. Do this part until it reads right out loud — because the next step is the one that costs.",
    },
    {
      startSec: 52,
      title: "Step 3: Produce the track",
      body: "Step three — produce it. One tap, and your song gets made: full vocals in your artist's locked voice, over a beat built for it. A short song runs four hundred Visual Bucs — you saw the price before I tapped. No surprises here. Ever.",
    },
    {
      startSec: 72,
      title: "Hear what you made",
      body: "That's yours. From an idea to a finished song — and it sounds like you, because your voice was locked in from the start.",
    },
    {
      startSec: 84,
      title: "Your move",
      body: "Your move. Walk through it with me on the real page — or tap Try It Now and make yours. I'll be right there in the chat if you get stuck.",
    },
  ] as Array<{ startSec: number; title: string; body: string }>,
};

function mmss(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** The pilot's transcript, assembled from the pack's caption blocks
    (chapter list + verbatim captions, incl. the music caption). */
const PILOT_TRANSCRIPT = PILOT.chapters
  .map((c) => {
    const music =
      c.title === "Hear what you made"
        ? "\n[♪ Music: “Midnight Run” — the song generated in this tutorial ♪]"
        : "";
    return `${mmss(c.startSec)} — ${c.title}\n${c.body}${music}`;
  })
  .join("\n\n");

/**
 * Idempotently seed the official structure: the five flow-path
 * series under the official house profile, plus the pilot tutorial
 * with its chapters. Safe to call on every catalog read — existing
 * rows (by slug) are left exactly as they are, so admin edits win.
 * No official profile yet → seeds nothing, says nothing.
 */
export async function ensureOfficialSeed(): Promise<void> {
  const [official] = await db
    .select()
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.isOfficial, true))
    .limit(1);
  if (!official) return;

  const seriesBySlug = new Map<string, TutorialSeries>();
  for (const def of OFFICIAL_SERIES) {
    const [existing] = await db
      .select()
      .from(tutorialSeriesTable)
      .where(eq(tutorialSeriesTable.slug, def.slug))
      .limit(1);
    if (existing) {
      seriesBySlug.set(def.slug, existing);
      continue;
    }
    const [created] = await db
      .insert(tutorialSeriesTable)
      .values({
        ownerUserId: official.userId,
        profileId: official.id,
        title: def.title,
        slug: def.slug,
        description: "",
        category: def.category,
        isOfficial: true,
        position: def.position,
        isPublished: true,
      })
      .onConflictDoNothing({ target: tutorialSeriesTable.slug })
      .returning();
    if (created) {
      seriesBySlug.set(def.slug, created);
    } else {
      const [row] = await db
        .select()
        .from(tutorialSeriesTable)
        .where(eq(tutorialSeriesTable.slug, def.slug))
        .limit(1);
      if (row) seriesBySlug.set(def.slug, row);
    }
  }

  const create = seriesBySlug.get("create");
  if (!create) return;

  const [pilotRow] = await db
    .select({ id: tutorialsTable.id })
    .from(tutorialsTable)
    .where(eq(tutorialsTable.slug, PILOT.slug))
    .limit(1);
  if (pilotRow) return;

  const [tutorial] = await db
    .insert(tutorialsTable)
    .values({
      seriesId: create.id,
      ownerUserId: official.userId,
      profileId: official.id,
      videoId: null,
      title: PILOT.title,
      slug: PILOT.slug,
      description: PILOT.description,
      category: "create",
      position: 1,
      isOfficial: true,
      access: "free",
      guideRoute: PILOT.guideRoute,
      tryRoute: PILOT.tryRoute,
      transcript: PILOT_TRANSCRIPT,
      isPublished: true,
    })
    .onConflictDoNothing({ target: tutorialsTable.slug })
    .returning();
  if (!tutorial) return;

  await db.insert(tutorialChaptersTable).values(
    PILOT.chapters.map((c, i) => ({
      tutorialId: tutorial.id,
      position: i + 1,
      title: c.title,
      startSec: c.startSec,
      body: c.body,
    })),
  );
}

/* ─── reads ──────────────────────────────────────────────────────────── */

const CATEGORY_ORDER: Record<string, number> = {
  "start-here": 0,
  create: 1,
  brand: 2,
  promote: 3,
  money: 4,
  creator: 5,
};

/** Timestamps arrive as Date from pg; some drivers/tests hand back
    strings — order and format defensively either way. */
function timeOf(v: Date | string): number {
  return v instanceof Date ? v.getTime() : new Date(v).getTime();
}

function isoOf(v: Date | string | null): string | null {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

function byPositionThenTime(
  a: { position: number; createdAt: Date },
  b: { position: number; createdAt: Date },
): number {
  return a.position - b.position || timeOf(a.createdAt) - timeOf(b.createdAt);
}

async function cardDtos(rows: Tutorial[]): Promise<TutorialCardDto[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const chapters = await db
    .select({
      tutorialId: tutorialChaptersTable.tutorialId,
      title: tutorialChaptersTable.title,
      position: tutorialChaptersTable.position,
    })
    .from(tutorialChaptersTable)
    .where(inArray(tutorialChaptersTable.tutorialId, ids))
    .orderBy(asc(tutorialChaptersTable.position));
  const chaptersByTutorial = new Map<string, string[]>();
  for (const c of chapters) {
    const list = chaptersByTutorial.get(c.tutorialId) ?? [];
    list.push(c.title);
    chaptersByTutorial.set(c.tutorialId, list);
  }

  const videoIds = rows.map((r) => r.videoId).filter((v): v is string => !!v);
  const videos = videoIds.length
    ? await db
        .select({ id: profileVideosTable.id, durationSec: profileVideosTable.durationSec })
        .from(profileVideosTable)
        .where(inArray(profileVideosTable.id, videoIds))
    : [];
  const durationByVideo = new Map(videos.map((v) => [v.id, v.durationSec]));

  const profileIds = rows.map((r) => r.profileId).filter((v): v is string => !!v);
  const profiles = profileIds.length
    ? await db
        .select({ id: creatorProfilesTable.id, slug: creatorProfilesTable.slug, displayName: creatorProfilesTable.displayName })
        .from(creatorProfilesTable)
        .where(inArray(creatorProfilesTable.id, profileIds))
    : [];
  const profileById = new Map(profiles.map((p) => [p.id, p]));

  return rows.map((r) => {
    const titles = chaptersByTutorial.get(r.id) ?? [];
    const profile = r.profileId ? profileById.get(r.profileId) : undefined;
    return {
      id: r.id,
      slug: r.slug,
      title: r.title,
      description: r.description,
      category: r.category,
      isOfficial: r.isOfficial,
      access: r.access,
      position: r.position,
      seriesId: r.seriesId,
      creatorSlug: profile?.slug ?? null,
      creatorName: profile?.displayName ?? null,
      hasVideo: !!r.videoId,
      videoDurationSec: r.videoId ? durationByVideo.get(r.videoId) ?? null : null,
      chapterCount: titles.length,
      chapterTitles: titles,
    };
  });
}

/**
 * The catalog: published tutorials grouped by their series (series
 * with nothing published never appear — no empty shelves), plus
 * standalone tutorials. `profileSlug` scopes to one creator's shelf
 * (their series + their standalones on that profile). `q` is the
 * plain-language search: title, description, and chapter titles.
 */
export async function listCatalog(opts: {
  profileSlug?: string;
  q?: string;
} = {}): Promise<TutorialCatalogDto> {
  let rows: Tutorial[];
  if (opts.profileSlug) {
    const [profile] = await db
      .select({ id: creatorProfilesTable.id })
      .from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.slug, opts.profileSlug))
      .limit(1);
    if (!profile) return { series: [], standalone: [] };
    rows = await db
      .select()
      .from(tutorialsTable)
      .where(and(eq(tutorialsTable.isPublished, true), eq(tutorialsTable.profileId, profile.id)));
  } else {
    rows = await db.select().from(tutorialsTable).where(eq(tutorialsTable.isPublished, true));
  }

  let cards = await cardDtos(rows);

  const q = (opts.q ?? "").trim().toLowerCase();
  if (q) {
    cards = cards.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        c.chapterTitles.some((t) => t.toLowerCase().includes(q)),
    );
  }

  const seriesIds = [...new Set(cards.map((c) => c.seriesId).filter((v): v is string => !!v))];
  const seriesRows = seriesIds.length
    ? await db
        .select()
        .from(tutorialSeriesTable)
        .where(inArray(tutorialSeriesTable.id, seriesIds))
    : [];
  const seriesById = new Map(seriesRows.map((s) => [s.id, s]));

  const grouped = new Map<string, TutorialCardDto[]>();
  const standalone: TutorialCardDto[] = [];
  for (const card of cards) {
    if (card.seriesId && seriesById.has(card.seriesId)) {
      const list = grouped.get(card.seriesId) ?? [];
      list.push(card);
      grouped.set(card.seriesId, list);
    } else {
      standalone.push(card);
    }
  }

  const series: TutorialSeriesDto[] = [...grouped.entries()]
    .map(([id, list]) => {
      const s = seriesById.get(id)!;
      return {
        id: s.id,
        slug: s.slug,
        title: s.title,
        description: s.description,
        category: s.category,
        isOfficial: s.isOfficial,
        position: s.position,
        tutorials: list.sort((a, b) => a.position - b.position),
      };
    })
    .sort(
      (a, b) =>
        (CATEGORY_ORDER[a.category] ?? 9) - (CATEGORY_ORDER[b.category] ?? 9) ||
        a.position - b.position,
    );
  standalone.sort((a, b) => a.position - b.position);

  return { series, standalone };
}

/** One tutorial, in full: chapters, resources, the video (when its
    production has landed), the three doors, and the next tutorial
    in its series. Published tutorials only — this is the public read. */
export async function getTutorialDetail(slug: string): Promise<TutorialDetailDto> {
  const [row] = await db
    .select()
    .from(tutorialsTable)
    .where(and(eq(tutorialsTable.slug, slug), eq(tutorialsTable.isPublished, true)))
    .limit(1);
  if (!row) throw new TutorialError(404, "TUTORIAL_NOT_FOUND", "That tutorial doesn't exist.");

  const chapters = await db
    .select()
    .from(tutorialChaptersTable)
    .where(eq(tutorialChaptersTable.tutorialId, row.id))
    .orderBy(asc(tutorialChaptersTable.position));
  const resources = await db
    .select()
    .from(tutorialResourcesTable)
    .where(eq(tutorialResourcesTable.tutorialId, row.id))
    .orderBy(asc(tutorialResourcesTable.position));

  let video: TutorialVideoDto | null = null;
  if (row.videoId) {
    const [v] = await db
      .select()
      .from(profileVideosTable)
      .where(eq(profileVideosTable.id, row.videoId))
      .limit(1);
    if (v) {
      video = {
        id: v.id,
        title: v.title,
        url: v.videoUrl,
        thumbnailUrl: v.thumbnailUrl,
        durationSec: v.durationSec,
      };
    }
  }

  let series: TutorialDetailDto["series"] = null;
  let next: TutorialDetailDto["next"] = null;
  if (row.seriesId) {
    const [s] = await db
      .select()
      .from(tutorialSeriesTable)
      .where(eq(tutorialSeriesTable.id, row.seriesId))
      .limit(1);
    if (s) series = { id: s.id, slug: s.slug, title: s.title };
    const siblings = await db
      .select()
      .from(tutorialsTable)
      .where(and(eq(tutorialsTable.seriesId, row.seriesId), eq(tutorialsTable.isPublished, true)));
    const ordered = siblings.sort(byPositionThenTime);
    const idx = ordered.findIndex((t) => t.id === row.id);
    const after = idx >= 0 ? ordered[idx + 1] : undefined;
    if (after) next = { slug: after.slug, title: after.title };
  }

  let creator: TutorialDetailDto["creator"] = null;
  if (row.profileId) {
    const [p] = await db
      .select({ slug: creatorProfilesTable.slug, displayName: creatorProfilesTable.displayName })
      .from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.id, row.profileId))
      .limit(1);
    if (p) creator = p;
  }

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    category: row.category,
    isOfficial: row.isOfficial,
    access: row.access,
    guideRoute: row.guideRoute,
    tryRoute: row.tryRoute,
    transcript: row.transcript,
    video,
    chapters: chapters.map((c) => ({
      id: c.id,
      position: c.position,
      title: c.title,
      startSec: c.startSec,
      body: c.body,
    })),
    resources: resources.map((r) => ({
      id: r.id,
      chapterId: r.chapterId,
      title: r.title,
      url: r.url,
      kind: r.kind,
      position: r.position,
    })),
    series,
    next,
    creator,
  };
}

/* ─── writes: designation + management ───────────────────────────────── */

async function loadTutorial(id: string): Promise<Tutorial> {
  const [row] = await db.select().from(tutorialsTable).where(eq(tutorialsTable.id, id)).limit(1);
  if (!row) throw new TutorialError(404, "TUTORIAL_NOT_FOUND", "That tutorial doesn't exist.");
  return row;
}

function canManage(actor: TutorialActor, row: { ownerUserId: string }): boolean {
  return actor.userId === row.ownerUserId || isTutorialAdmin(actor.email);
}

async function assertSeriesPlacement(
  actor: TutorialActor,
  seriesId: string,
  profileId: string | null,
): Promise<TutorialSeries> {
  const [series] = await db
    .select()
    .from(tutorialSeriesTable)
    .where(eq(tutorialSeriesTable.id, seriesId))
    .limit(1);
  if (!series) throw new TutorialError(400, "BAD_SERIES", "That series doesn't exist.");
  const admin = isTutorialAdmin(actor.email);
  if (series.isOfficial && !admin) {
    throw new TutorialError(403, "OFFICIAL_SERIES", "Only the house team can add to an official series.");
  }
  if (series.profileId && profileId && series.profileId !== profileId && !admin) {
    throw new TutorialError(403, "SERIES_NOT_YOURS", "That series belongs to another creator.");
  }
  return series;
}

export interface DesignateInput {
  videoId: string;
  title?: string;
  description?: string;
  category?: TutorialCategory;
  seriesId?: string | null;
  position?: number;
  isOfficial?: boolean;
  guideRoute?: string | null;
  tryRoute?: string | null;
  transcript?: string | null;
}

/**
 * Designate a published profile video as a tutorial. The video's
 * owner (or an admin) designates; the OFFICIAL badge is admin-only.
 * One tutorial per video in V1.
 */
export async function designateTutorial(
  actor: TutorialActor,
  input: DesignateInput,
): Promise<TutorialDetailDto> {
  const [video] = await db
    .select()
    .from(profileVideosTable)
    .where(eq(profileVideosTable.id, input.videoId))
    .limit(1);
  if (!video) throw new TutorialError(404, "VIDEO_NOT_FOUND", "That video doesn't exist.");
  if (!video.isPublished) {
    throw new TutorialError(400, "VIDEO_NOT_PUBLISHED", "Only a published video can become a tutorial.");
  }
  const [profile] = await db
    .select()
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.id, video.profileId))
    .limit(1);
  if (!profile) throw new TutorialError(404, "PROFILE_NOT_FOUND", "That video's profile doesn't exist.");

  const admin = isTutorialAdmin(actor.email);
  if (profile.userId !== actor.userId && !admin) {
    throw new TutorialError(403, "NOT_OWNER", "You can only turn your own videos into tutorials.");
  }
  if (input.isOfficial && !admin) {
    throw new TutorialError(
      403,
      "OFFICIAL_REQUIRES_ADMIN",
      "Only the house team can mark a tutorial official.",
    );
  }

  const [existing] = await db
    .select({ slug: tutorialsTable.slug })
    .from(tutorialsTable)
    .where(eq(tutorialsTable.videoId, video.id))
    .limit(1);
  if (existing) {
    throw new TutorialError(409, "ALREADY_DESIGNATED", "That video is already a tutorial.");
  }

  if (input.seriesId) await assertSeriesPlacement(actor, input.seriesId, profile.id);

  const title = (input.title ?? video.title).trim();
  const slug = await uniqueTutorialSlug(slugifyTitle(title));
  const [row] = await db
    .insert(tutorialsTable)
    .values({
      seriesId: input.seriesId ?? null,
      ownerUserId: profile.userId,
      profileId: profile.id,
      videoId: video.id,
      title,
      slug,
      description: input.description ?? video.description ?? "",
      category: input.category ?? "creator",
      position: input.position ?? 0,
      isOfficial: !!input.isOfficial,
      access: "free",
      guideRoute: input.guideRoute ?? null,
      tryRoute: input.tryRoute ?? null,
      transcript: input.transcript ?? null,
      isPublished: true,
    })
    .returning();
  return getTutorialDetail(row.slug);
}

export interface CreateSeriesInput {
  title: string;
  description?: string;
  category?: TutorialCategory;
  isOfficial?: boolean;
  position?: number;
}

/** Create a tutorial series. Official series are admin-only; a
    creator's series hangs on their own profile when they have one. */
export async function createSeries(
  actor: TutorialActor,
  input: CreateSeriesInput,
): Promise<TutorialSeries> {
  const admin = isTutorialAdmin(actor.email);
  if (input.isOfficial && !admin) {
    throw new TutorialError(
      403,
      "OFFICIAL_REQUIRES_ADMIN",
      "Only the house team can create an official series.",
    );
  }
  const [profile] = await db
    .select({ id: creatorProfilesTable.id })
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.userId, actor.userId))
    .limit(1);
  const slug = await uniqueSeriesSlug(slugifyTitle(input.title));
  const [row] = await db
    .insert(tutorialSeriesTable)
    .values({
      ownerUserId: actor.userId,
      profileId: profile?.id ?? null,
      title: input.title.trim(),
      slug,
      description: input.description ?? "",
      category: input.category ?? "creator",
      isOfficial: !!input.isOfficial,
      position: input.position ?? 0,
      isPublished: true,
    })
    .returning();
  return row;
}

export interface UpdateTutorialInput {
  title?: string;
  description?: string;
  category?: TutorialCategory;
  seriesId?: string | null;
  position?: number;
  isOfficial?: boolean;
  isPublished?: boolean;
  guideRoute?: string | null;
  tryRoute?: string | null;
  transcript?: string | null;
  /** Attach (or swap) the finished video once production lands. */
  videoId?: string | null;
}

/** Edit a tutorial's metadata. Owner or admin; flipping the
    OFFICIAL flag is admin-only; the slug never changes (deep links
    are forever). */
export async function updateTutorial(
  actor: TutorialActor,
  id: string,
  patch: UpdateTutorialInput,
): Promise<TutorialDetailDto> {
  const row = await loadTutorial(id);
  const admin = isTutorialAdmin(actor.email);
  if (!canManage(actor, row)) {
    throw new TutorialError(403, "NOT_OWNER", "That tutorial isn't yours to edit.");
  }
  if (patch.isOfficial !== undefined && patch.isOfficial !== row.isOfficial && !admin) {
    throw new TutorialError(
      403,
      "OFFICIAL_REQUIRES_ADMIN",
      "Only the house team can mark a tutorial official.",
    );
  }
  if (patch.seriesId !== undefined && patch.seriesId !== null) {
    await assertSeriesPlacement(actor, patch.seriesId, row.profileId);
  }
  if (patch.videoId !== undefined && patch.videoId !== row.videoId) {
    if (patch.videoId === null) {
      /* detaching media is allowed — the walkthrough remains */
    } else {
      const [video] = await db
        .select()
        .from(profileVideosTable)
        .where(eq(profileVideosTable.id, patch.videoId))
        .limit(1);
      if (!video) throw new TutorialError(404, "VIDEO_NOT_FOUND", "That video doesn't exist.");
      if (!video.isPublished) {
        throw new TutorialError(400, "VIDEO_NOT_PUBLISHED", "Only a published video can be a tutorial's video.");
      }
      if (video.profileId !== row.profileId && !admin) {
        throw new TutorialError(403, "NOT_OWNER", "That video belongs to another creator.");
      }
      const [other] = await db
        .select({ id: tutorialsTable.id })
        .from(tutorialsTable)
        .where(eq(tutorialsTable.videoId, patch.videoId))
        .limit(1);
      if (other && other.id !== row.id) {
        throw new TutorialError(409, "ALREADY_DESIGNATED", "That video is already another tutorial.");
      }
    }
  }

  const set: Partial<Tutorial> = { updatedAt: new Date() };
  if (patch.title !== undefined) set.title = patch.title.trim();
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.category !== undefined) set.category = patch.category;
  if (patch.seriesId !== undefined) set.seriesId = patch.seriesId;
  if (patch.position !== undefined) set.position = patch.position;
  if (patch.isOfficial !== undefined) set.isOfficial = patch.isOfficial;
  if (patch.isPublished !== undefined) set.isPublished = patch.isPublished;
  if (patch.guideRoute !== undefined) set.guideRoute = patch.guideRoute;
  if (patch.tryRoute !== undefined) set.tryRoute = patch.tryRoute;
  if (patch.transcript !== undefined) set.transcript = patch.transcript;
  if (patch.videoId !== undefined) set.videoId = patch.videoId;

  const [updated] = await db
    .update(tutorialsTable)
    .set(set)
    .where(eq(tutorialsTable.id, id))
    .returning();
  // The public detail read is published-only; an unpublish edit
  // returns the row's shape via a direct DTO build instead.
  if (!updated.isPublished) {
    return {
      id: updated.id,
      slug: updated.slug,
      title: updated.title,
      description: updated.description,
      category: updated.category,
      isOfficial: updated.isOfficial,
      access: updated.access,
      guideRoute: updated.guideRoute,
      tryRoute: updated.tryRoute,
      transcript: updated.transcript,
      video: null,
      chapters: [],
      resources: [],
      series: null,
      next: null,
      creator: null,
    };
  }
  return getTutorialDetail(updated.slug);
}

export interface ChapterInput {
  title: string;
  startSec?: number | null;
  body?: string;
}

/** Replace a tutorial's chapters with an ordered set — array order
    IS the chapter order (positions are assigned here, never trusted
    from the client). Replacing chapters resets which of them count
    as completed on the next progress write; fans keep their place
    by position, not by a stale chapter id. */
export async function replaceChapters(
  actor: TutorialActor,
  tutorialId: string,
  chapters: ChapterInput[],
): Promise<TutorialChapterDto[]> {
  const row = await loadTutorial(tutorialId);
  if (!canManage(actor, row)) {
    throw new TutorialError(403, "NOT_OWNER", "That tutorial isn't yours to edit.");
  }
  if (chapters.length > 60) {
    throw new TutorialError(400, "TOO_MANY_CHAPTERS", "A tutorial can hold at most 60 chapters.");
  }
  const cleaned = chapters.map((c, i) => ({
    tutorialId,
    position: i + 1,
    title: c.title.trim(),
    startSec: c.startSec ?? null,
    body: c.body ?? "",
  }));
  if (cleaned.some((c) => !c.title)) {
    throw new TutorialError(400, "BAD_CHAPTER", "Every chapter needs a title.");
  }
  await db.delete(tutorialChaptersTable).where(eq(tutorialChaptersTable.tutorialId, tutorialId));
  if (cleaned.length === 0) return [];
  const inserted = await db.insert(tutorialChaptersTable).values(cleaned).returning();
  return inserted
    .sort((a, b) => a.position - b.position)
    .map((c) => ({ id: c.id, position: c.position, title: c.title, startSec: c.startSec, body: c.body }));
}

export interface ResourceInput {
  title: string;
  url: string;
  kind?: "download" | "link";
  chapterId?: string | null;
}

/** Replace a tutorial's resources with an ordered set. A resource
    may pin to one of the tutorial's own chapters — never another
    tutorial's. */
export async function replaceResources(
  actor: TutorialActor,
  tutorialId: string,
  resources: ResourceInput[],
): Promise<TutorialResourceDto[]> {
  const row = await loadTutorial(tutorialId);
  if (!canManage(actor, row)) {
    throw new TutorialError(403, "NOT_OWNER", "That tutorial isn't yours to edit.");
  }
  if (resources.length > 60) {
    throw new TutorialError(400, "TOO_MANY_RESOURCES", "A tutorial can hold at most 60 resources.");
  }
  const chapterIds = new Set(
    (
      await db
        .select({ id: tutorialChaptersTable.id })
        .from(tutorialChaptersTable)
        .where(eq(tutorialChaptersTable.tutorialId, tutorialId))
    ).map((c) => c.id),
  );
  const cleaned = resources.map((r, i) => {
    const url = r.url.trim();
    if (!r.title.trim()) {
      throw new TutorialError(400, "BAD_RESOURCE", "Every resource needs a title.");
    }
    if (!url.startsWith("https://") && !url.startsWith("http://") && !url.startsWith("/")) {
      throw new TutorialError(400, "BAD_RESOURCE_URL", "Resource links must be web addresses.");
    }
    if (r.chapterId && !chapterIds.has(r.chapterId)) {
      throw new TutorialError(400, "BAD_CHAPTER", "Resources can only pin to this tutorial's own chapters.");
    }
    return {
      tutorialId,
      chapterId: r.chapterId ?? null,
      title: r.title.trim(),
      url,
      kind: r.kind ?? "link",
      position: i + 1,
    };
  });
  await db.delete(tutorialResourcesTable).where(eq(tutorialResourcesTable.tutorialId, tutorialId));
  if (cleaned.length === 0) return [];
  const inserted = await db.insert(tutorialResourcesTable).values(cleaned).returning();
  return inserted
    .sort((a, b) => a.position - b.position)
    .map((r) => ({
      id: r.id,
      chapterId: r.chapterId,
      title: r.title,
      url: r.url,
      kind: r.kind,
      position: r.position,
    }));
}

/* ─── fan progress ───────────────────────────────────────────────────── */

function progressDto(row: {
  tutorialId: string;
  status: "started" | "in_progress" | "completed";
  completedChapters: string[];
  lastChapterId: string | null;
  lastPositionSec: number;
  completedAt: Date | string | null;
}): TutorialProgressDto {
  return {
    tutorialId: row.tutorialId,
    status: row.status,
    completedChapterIds: row.completedChapters ?? [],
    lastChapterId: row.lastChapterId,
    lastPositionSec: row.lastPositionSec,
    completedAt: isoOf(row.completedAt),
  };
}

export async function getMyProgress(userId: string): Promise<TutorialProgressDto[]> {
  const rows = await db
    .select()
    .from(tutorialProgressTable)
    .where(eq(tutorialProgressTable.userId, userId));
  return rows.map(progressDto);
}

export interface ProgressInput {
  /** The chapter the fan is on now (resume point). */
  chapterId?: string | null;
  /** Video position in seconds (resume point). */
  positionSec?: number;
  /** Mark one chapter complete. */
  completeChapterId?: string;
  /** Un-mark one chapter. */
  uncompleteChapterId?: string;
  /** Explicit finish (video ended / chapter-less tutorial). */
  markCompleted?: boolean;
}

/**
 * Record one progress beat. Status is DERIVED, never trusted from
 * the client: completed ⇔ every chapter is done, or a deliberate
 * finish beat (video ended / "mark as complete") — and once earned
 * it sticks unless a chapter is explicitly un-marked. Anything less
 * with real engagement is in_progress; a bare open is started. The
 * row is the resume point: last chapter + furthest video position
 * survive untouched by later, smaller beats.
 */
export async function recordProgress(
  userId: string,
  tutorialId: string,
  input: ProgressInput,
): Promise<TutorialProgressDto> {
  const tutorial = await loadTutorial(tutorialId);
  if (!tutorial.isPublished) {
    throw new TutorialError(404, "TUTORIAL_NOT_FOUND", "That tutorial doesn't exist.");
  }
  const chapters = await db
    .select({ id: tutorialChaptersTable.id })
    .from(tutorialChaptersTable)
    .where(eq(tutorialChaptersTable.tutorialId, tutorialId));
  const chapterIdSet = new Set(chapters.map((c) => c.id));
  for (const cid of [input.chapterId, input.completeChapterId, input.uncompleteChapterId]) {
    if (cid && !chapterIdSet.has(cid)) {
      throw new TutorialError(400, "BAD_CHAPTER", "That chapter isn't part of this tutorial.");
    }
  }

  const [existing] = await db
    .select()
    .from(tutorialProgressTable)
    .where(
      and(
        eq(tutorialProgressTable.userId, userId),
        eq(tutorialProgressTable.tutorialId, tutorialId),
      ),
    )
    .limit(1);

  const completed = new Set<string>(
    (existing?.completedChapters ?? []).filter((id) => chapterIdSet.has(id)),
  );
  if (input.completeChapterId) completed.add(input.completeChapterId);
  if (input.uncompleteChapterId) completed.delete(input.uncompleteChapterId);

  const lastChapterId =
    input.chapterId ?? input.completeChapterId ?? existing?.lastChapterId ?? null;
  const lastPositionSec = Math.max(
    existing?.lastPositionSec ?? 0,
    Math.max(0, Math.floor(input.positionSec ?? 0)),
  );

  const allChaptersDone = chapters.length > 0 && chapters.every((c) => completed.has(c.id));
  /* Completion is sticky: finishing once (every chapter done, or a
     deliberate finish beat) keeps the badge when the fan comes back
     to rewatch. The one honest reopen is un-marking a chapter —
     then the state is re-derived from the chapter set alone. */
  const isCompleted = input.uncompleteChapterId
    ? allChaptersDone
    : existing?.status === "completed" || allChaptersDone || !!input.markCompleted;
  const status: TutorialProgressDto["status"] = isCompleted
    ? "completed"
    : completed.size > 0 || lastPositionSec > 0 || !!lastChapterId
      ? "in_progress"
      : "started";
  const completedAt = isCompleted ? (existing?.completedAt ?? new Date()) : null;

  if (existing) {
    const [row] = await db
      .update(tutorialProgressTable)
      .set({
        status,
        completedChapters: [...completed],
        lastChapterId: lastChapterId && chapterIdSet.has(lastChapterId) ? lastChapterId : null,
        lastPositionSec,
        completedAt,
        updatedAt: new Date(),
      })
      .where(eq(tutorialProgressTable.id, existing.id))
      .returning();
    return progressDto(row);
  }
  const [row] = await db
    .insert(tutorialProgressTable)
    .values({
      userId,
      tutorialId,
      status,
      completedChapters: [...completed],
      lastChapterId: lastChapterId && chapterIdSet.has(lastChapterId) ? lastChapterId : null,
      lastPositionSec,
      completedAt,
    })
    .returning();
  return progressDto(row);
}

/** Category keys, re-exported for route validation. */
export const TUTORIAL_CATEGORY_KEYS = TUTORIAL_CATEGORIES;
