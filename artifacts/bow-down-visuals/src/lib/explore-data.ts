export interface ExploreData<Short, Creator, HotPost, Evt, Grp> {
  shorts: Short[];
  creators: Creator[];
  posts: HotPost[];
  events: Evt[];
  groups: Grp[];
}

function arrayOrEmpty<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * Explore is a blended page, so a partial API payload should only empty
 * the affected sections — never poison the whole page state and trip its
 * route boundary. Missing and mistyped section fields normalize to [].
 */
export function normalizeExploreData<Short, Creator, HotPost, Evt, Grp>(
  payload: unknown,
): ExploreData<Short, Creator, HotPost, Evt, Grp> {
  const source =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};

  return {
    shorts: arrayOrEmpty(source.shorts),
    creators: arrayOrEmpty(source.creators),
    posts: arrayOrEmpty(source.posts),
    events: arrayOrEmpty(source.events),
    groups: arrayOrEmpty(source.groups),
  };
}

/** Last-resort render guard for a section collection. */
export function exploreSectionOrEmpty<T>(
  items: readonly T[] | null | undefined,
): T[] {
  return Array.isArray(items) ? [...items] : [];
}

export const EXPLORE_SECTION_NAMES = [
  "shorts",
  "creators",
  "posts",
  "events",
  "groups",
] as const;

export type ExploreSectionName = (typeof EXPLORE_SECTION_NAMES)[number];

/**
 * The API settles each Explore section independently (S27-29) and names
 * the sections whose source failed in `failed_sections`. Only known
 * section names survive — a malformed payload degrades to "no known
 * failures", never to phantom error states.
 */
export function exploreFailedSections(payload: unknown): ExploreSectionName[] {
  const source =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  const raw = source.failed_sections;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (name): name is ExploreSectionName =>
      typeof name === "string" &&
      (EXPLORE_SECTION_NAMES as readonly string[]).includes(name),
  );
}

/** Total failure = every section's source failed (the full-page state). */
export function isExploreTotalFailure(payload: unknown): boolean {
  return exploreFailedSections(payload).length === EXPLORE_SECTION_NAMES.length;
}
