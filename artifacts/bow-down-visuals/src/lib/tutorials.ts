/* ─── Tutorials V1 — client ─────────────────────────────────────────────
   Mirrors the API DTOs from routes/tutorials.ts exactly. Tutorials
   live INSIDE the Creator Academy (the How-To Videos tab) and on
   creator profiles (the Tutorials shelf); this lib is the one read/
   write path for both. Official tutorials are FREE — nothing here
   touches credits. The pure helpers (progress state, resume point,
   search) are unit-tested in tutorials.test.ts; components stay
   thin shells over them. */

export type TutorialCategoryKey =
  | "start-here"
  | "create"
  | "brand"
  | "promote"
  | "money"
  | "creator";

export const TUTORIAL_CATEGORY_LABELS: Record<TutorialCategoryKey, string> = {
  "start-here": "Start Here",
  create: "Create",
  brand: "Brand",
  promote: "Promote",
  money: "Money",
  creator: "From creators",
};

/** The operating-flow order the Academy renders shelves in. */
export const TUTORIAL_CATEGORY_ORDER: TutorialCategoryKey[] = [
  "start-here",
  "create",
  "brand",
  "promote",
  "money",
  "creator",
];

export interface TutorialCard {
  id: string;
  slug: string;
  title: string;
  description: string;
  category: TutorialCategoryKey;
  isOfficial: boolean;
  access: string;
  position: number;
  seriesId: string | null;
  creatorSlug: string | null;
  creatorName: string | null;
  /** false = video still in production; the walkthrough teaches. */
  hasVideo: boolean;
  videoDurationSec: number | null;
  chapterCount: number;
  chapterTitles: string[];
}

export interface TutorialSeries {
  id: string;
  slug: string;
  title: string;
  description: string;
  category: TutorialCategoryKey;
  isOfficial: boolean;
  position: number;
  tutorials: TutorialCard[];
}

export interface TutorialCatalog {
  series: TutorialSeries[];
  standalone: TutorialCard[];
}

export interface TutorialChapter {
  id: string;
  position: number;
  title: string;
  startSec: number | null;
  body: string;
}

export interface TutorialResource {
  id: string;
  chapterId: string | null;
  title: string;
  url: string;
  kind: "download" | "link";
  position: number;
}

export interface TutorialDetail {
  id: string;
  slug: string;
  title: string;
  description: string;
  category: TutorialCategoryKey;
  isOfficial: boolean;
  access: string;
  guideRoute: string | null;
  tryRoute: string | null;
  transcript: string | null;
  video: {
    id: string;
    title: string;
    url: string;
    thumbnailUrl: string | null;
    durationSec: number;
  } | null;
  chapters: TutorialChapter[];
  resources: TutorialResource[];
  series: { id: string; slug: string; title: string } | null;
  next: { slug: string; title: string } | null;
  creator: { slug: string; displayName: string } | null;
}

export type TutorialProgressStatus = "started" | "in_progress" | "completed";

export interface TutorialProgress {
  tutorialId: string;
  status: TutorialProgressStatus;
  completedChapterIds: string[];
  lastChapterId: string | null;
  lastPositionSec: number;
  completedAt: string | null;
}

export interface ProgressBeat {
  chapterId?: string | null;
  positionSec?: number;
  completeChapterId?: string;
  uncompleteChapterId?: string;
  markCompleted?: boolean;
}

/* ─── pure helpers ───────────────────────────────────────────────────── */

export type TutorialCardState = "not_started" | TutorialProgressStatus;

/** A card's progress state: no row yet = not started. */
export function tutorialCardState(
  progress: TutorialProgress | undefined,
): TutorialCardState {
  return progress ? progress.status : "not_started";
}

/** Seconds → "1:24" (or "0:08"). */
export function formatTimestamp(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The chapter a returning fan resumes at: the recorded resume
    chapter when it still exists, else the first incomplete chapter,
    else null (finished or chapter-less). */
export function resumeChapter(
  detail: Pick<TutorialDetail, "chapters">,
  progress: TutorialProgress | undefined,
): TutorialChapter | null {
  if (!progress || detail.chapters.length === 0) return null;
  if (progress.status === "completed") return null;
  const recorded = detail.chapters.find((c) => c.id === progress.lastChapterId);
  if (recorded) return recorded;
  const done = new Set(progress.completedChapterIds);
  return detail.chapters.find((c) => !done.has(c.id)) ?? null;
}

/** 1-based "Chapter N of M" label for a resume point. */
export function resumeLabel(
  detail: Pick<TutorialDetail, "chapters">,
  progress: TutorialProgress | undefined,
): string | null {
  const chapter = resumeChapter(detail, progress);
  if (!chapter) return null;
  return `Chapter ${chapter.position} of ${detail.chapters.length}: ${chapter.title}`;
}

/** Plain-language search over everything the fan can see: titles,
    descriptions, chapter titles, and the creator's name. */
export function cardMatchesQuery(card: TutorialCard, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return (
    card.title.toLowerCase().includes(needle) ||
    card.description.toLowerCase().includes(needle) ||
    (card.creatorName ?? "").toLowerCase().includes(needle) ||
    card.chapterTitles.some((t) => t.toLowerCase().includes(needle))
  );
}

export function filterCatalog(catalog: TutorialCatalog, q: string): TutorialCatalog {
  if (!q.trim()) return catalog;
  return {
    series: catalog.series
      .map((s) => ({ ...s, tutorials: s.tutorials.filter((c) => cardMatchesQuery(c, q)) }))
      .filter((s) => s.tutorials.length > 0),
    standalone: catalog.standalone.filter((c) => cardMatchesQuery(c, q)),
  };
}

/** Every card in the catalog, series first — the resume strip and
    counts read from this one flattening. */
export function allCards(catalog: TutorialCatalog): TutorialCard[] {
  return [
    ...catalog.series.flatMap((s) => s.tutorials),
    ...catalog.standalone,
  ];
}

/** Tutorials the fan has begun but not finished — the "Continue"
    strip, most-progressed first is overkill; catalog order stands. */
export function inProgressCards(
  catalog: TutorialCatalog,
  progressById: Map<string, TutorialProgress>,
): TutorialCard[] {
  return allCards(catalog).filter(
    (c) => progressById.get(c.id)?.status === "in_progress",
  );
}

/* ─── HTTP ───────────────────────────────────────────────────────────── */

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new Error(body.message || body.error || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

type TokenGetter = () => Promise<string | null>;

async function authHeaders(getAccessToken?: TokenGetter): Promise<Record<string, string>> {
  if (!getAccessToken) return {};
  const token = await getAccessToken().catch(() => null);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchTutorialCatalog(opts: {
  profileSlug?: string;
  q?: string;
} = {}): Promise<TutorialCatalog> {
  const params = new URLSearchParams();
  if (opts.profileSlug) params.set("profile", opts.profileSlug);
  if (opts.q) params.set("q", opts.q);
  const qs = params.toString();
  const data = await json<{ catalog: TutorialCatalog }>(
    await fetch(`/api/tutorials${qs ? `?${qs}` : ""}`),
  );
  return data.catalog;
}

export async function fetchTutorialDetail(slug: string): Promise<TutorialDetail> {
  const data = await json<{ tutorial: TutorialDetail }>(
    await fetch(`/api/tutorials/${encodeURIComponent(slug)}`),
  );
  return data.tutorial;
}

export async function fetchMyTutorialProgress(
  getAccessToken: TokenGetter,
): Promise<Map<string, TutorialProgress>> {
  const res = await fetch("/api/tutorials/mine/progress", {
    headers: await authHeaders(getAccessToken),
  });
  const data = await json<{ progress: TutorialProgress[] }>(res);
  return new Map(data.progress.map((p) => [p.tutorialId, p]));
}

export async function recordTutorialProgress(
  getAccessToken: TokenGetter,
  tutorialId: string,
  beat: ProgressBeat,
): Promise<TutorialProgress> {
  const res = await fetch(`/api/tutorials/${tutorialId}/progress`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders(getAccessToken)),
    },
    body: JSON.stringify(beat),
  });
  const data = await json<{ progress: TutorialProgress }>(res);
  return data.progress;
}
