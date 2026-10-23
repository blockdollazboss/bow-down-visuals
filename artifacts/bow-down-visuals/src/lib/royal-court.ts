/* ─── The Front Row — client ─────────────────────────────────────────────
   A creator crowns up to 8 other creators into their Court, in rank
   order. API: routes/royal-court.ts (GET /creator-profiles/:slug/court,
   GET|PUT /creator-profiles/me/court, GET /me/court-candidates).
   DTOs are the API's explicit camelCase shapes — mirrored here exactly.
   The pure helpers (view state + picker list ops + save summary) are
   unit-tested in royal-court.test.ts; the components stay thin shells. */

export const MAX_COURT_MEMBERS = 8;

export interface CourtMember {
  position: number;
  profileId: string;
  slug: string;
  displayName: string;
  avatarUrl: string | null;
  profileUrl: string;
  isPublic: boolean;
}

export interface CourtCandidate {
  profileId: string;
  slug: string;
  displayName: string;
  avatarUrl: string | null;
  profileUrl: string;
  isPublic: boolean;
  isFollowing: boolean;
}

/* ─── Fetch helpers (same error contract as lib/artist-profiles.ts:
   the thrown error carries .status so callers can tell a genuine 404
   from a load failure) ─────────────────────────────────────────────── */
async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(
      (body as { message?: string; error?: string }).message ||
        (body as { error?: string }).error ||
        `Request failed (${res.status})`,
    ) as Error & { status?: number; code?: string };
    err.status = res.status;
    err.code = (body as { error?: string }).error;
    throw err;
  }
  return res.json() as Promise<T>;
}

export async function fetchPublicCourt(slug: string): Promise<CourtMember[]> {
  const res = await fetch(`/api/creator-profiles/${encodeURIComponent(slug)}/court`);
  const data = await json<{ court: CourtMember[] }>(res);
  return Array.isArray(data.court) ? data.court : [];
}

export async function fetchMyCourt(): Promise<CourtMember[]> {
  const res = await fetch("/api/creator-profiles/me/court");
  const data = await json<{ court: CourtMember[] }>(res);
  return Array.isArray(data.court) ? data.court : [];
}

export async function saveMyCourt(memberProfileIds: string[]): Promise<CourtMember[]> {
  const res = await fetch("/api/creator-profiles/me/court", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ memberProfileIds }),
  });
  const data = await json<{ court: CourtMember[] }>(res);
  return Array.isArray(data.court) ? data.court : [];
}

/* Per-source settle for the picker (S27-35): the loaded Court and
   the candidate list are independent sources. A candidates failure
   must not discard a Court that already loaded (the old picker
   Promise.all'd both into one catch and threw the Court away); a
   Court failure is reported on its own channel so the picker can
   keep its honest load-error state for the Court itself. */
export interface CourtPickerSources {
  court: CourtMember[] | null;
  courtError: unknown;
  candidates: CourtCandidate[] | null;
  candidatesError: unknown;
}

export async function fetchCourtPickerSources(): Promise<CourtPickerSources> {
  const [court, candidates] = await Promise.allSettled([fetchMyCourt(), fetchCourtCandidates()]);
  return {
    court: court.status === "fulfilled" ? court.value : null,
    courtError: court.status === "rejected" ? court.reason : null,
    candidates: candidates.status === "fulfilled" ? candidates.value : null,
    candidatesError: candidates.status === "rejected" ? candidates.reason : null,
  };
}

export async function fetchCourtCandidates(query?: string): Promise<CourtCandidate[]> {
  const q = (query ?? "").trim();
  const res = await fetch(
    `/api/creator-profiles/me/court-candidates${q ? `?q=${encodeURIComponent(q)}` : ""}`,
  );
  const data = await json<{ candidates: CourtCandidate[] }>(res);
  return Array.isArray(data.candidates) ? data.candidates : [];
}

/* ─── Profile-section render decision ──────────────────────────────────────
   Viewer side: the section exists only when the Court is populated —
   an empty Court on someone else's page renders NOTHING (never a fake
   placeholder). Owner side: an empty Court shows the "Add your Court"
   invitation. A failed load is its own honest state with a retry, for
   both — never silently dressed up as "empty". */
export type CourtLoadStatus = "loading" | "error" | "ready";
export type CourtView = "loading" | "error" | "hidden" | "owner-empty" | "cards";

export function courtViewState(input: {
  status: CourtLoadStatus;
  members: CourtMember[];
  isOwner: boolean;
}): CourtView {
  if (input.status === "loading") return "loading";
  if (input.status === "error") return "error";
  if (input.members.length > 0) return "cards";
  return input.isOwner ? "owner-empty" : "hidden";
}

/* ─── Picker list ops (pure; the picker holds an ordered id list where
   index 0 = rank #1) ────────────────────────────────────────────────── */

export function canAddToCourt(ids: string[], profileId: string): boolean {
  return ids.length < MAX_COURT_MEMBERS && !ids.includes(profileId);
}

export function addToCourt(ids: string[], profileId: string): string[] {
  if (!canAddToCourt(ids, profileId)) return ids;
  return [...ids, profileId];
}

export function removeFromCourt(ids: string[], profileId: string): string[] {
  return ids.filter((id) => id !== profileId);
}

/** Move the member at `index` one seat up (dir -1) or down (dir +1).
    Out-of-range moves are no-ops returning the same list. */
export function moveInCourt(ids: string[], index: number, dir: -1 | 1): string[] {
  const target = index + dir;
  if (index < 0 || index >= ids.length || target < 0 || target >= ids.length) return ids;
  const next = [...ids];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item!);
  return next;
}

/** The save confirmation: exactly who holds which seat, in rank order —
    the owner reads back what the server stored, not what they hoped. */
export function courtSaveSummary(members: CourtMember[]): string {
  if (members.length === 0) return "Your Front Row is empty — no one has a seat right now.";
  const seats = members.map((m) => `#${m.position} ${m.displayName}`).join(" · ");
  return `Front Row saved: ${seats}`;
}
