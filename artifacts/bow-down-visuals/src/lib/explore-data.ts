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
