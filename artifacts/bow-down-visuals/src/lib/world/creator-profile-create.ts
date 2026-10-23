/* ─── Creator-profile creation, in-world (Stack-100 #48) ────────────
   A signed-in member with no creator profile could not publish from
   the World at all: the Song Desk's publish rail found no profile
   and sent them to the website. This is the creation flow docked
   where the block happens, on the site's REAL rails
   (artifacts/api-server/src/routes/creator-platform.ts):

     GET  /api/creator-profiles/me          → my profile, or 404
     GET  /api/creator-profiles/check-slug  → { available, valid }
     POST /api/creator-profiles             → create (201, created:
                                              true) — the rail is an
                                              upsert, so the desk
                                              only offers creation
                                              when /me says there
                                              is no profile yet,
                                              and the rail's own
                                              errors (409 handle
                                              taken, 400 validation)
                                              surface as-is.

   The fields are exactly the ones the create rail accepts for a
   first profile: display name, slug (handle), bio and vertical
   (category). Slug rules mirror the rail's slugSchema:
   3–40 chars, lowercase letters/numbers/hyphens, no leading or
   trailing hyphen. */

export const CREATOR_PROFILE_VERTICALS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "music", label: "Music" },
  { key: "video", label: "Video" },
  { key: "gaming", label: "Gaming" },
  { key: "podcast", label: "Podcast" },
  { key: "film", label: "Film" },
  { key: "tv", label: "TV" },
  { key: "influencer", label: "Influencer" },
  { key: "education", label: "Education" },
  { key: "other", label: "Other" },
];

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** A handle from a display name, in the rail's slug alphabet. */
export function slugifyCreatorSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

/** The slug's local problem, in words, or null when it passes the
 *  rail's slugSchema shape. Availability is a separate, server-side
 *  question (check-slug). */
export function creatorSlugProblem(slug: string): string | null {
  const s = slug.trim().toLowerCase();
  if (s.length < 3) return "Your handle needs at least 3 characters.";
  if (s.length > 40) return "Your handle can be at most 40 characters.";
  if (!SLUG_RE.test(s)) {
    return "Handles are lowercase letters, numbers and hyphens — no leading or trailing hyphen.";
  }
  return null;
}

export function normalizeCreatorSlug(slug: string): string {
  return slug.trim().toLowerCase();
}

/* ─── check-slug ──────────────────────────────────────────────────── */

export type SlugCheckState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available"; slug: string }
  | { kind: "taken"; slug: string }
  | { kind: "invalid"; slug: string; message: string };

export function parseSlugCheck(data: unknown, slug: string): SlugCheckState {
  const d = asRecord(data);
  if (d["valid"] === false) {
    return { kind: "invalid", slug, message: str(d["error"]) ?? "That handle doesn't pass the rules." };
  }
  if (d["available"] === true) return { kind: "available", slug };
  if (d["available"] === false) return { kind: "taken", slug };
  return { kind: "invalid", slug, message: "The handle check didn't answer — try again." };
}

export function slugCheckLine(state: SlugCheckState): string | null {
  switch (state.kind) {
    case "idle":
      return null;
    case "checking":
      return "Checking that handle…";
    case "available":
      return `@${state.slug} is yours to claim.`;
    case "taken":
      return `@${state.slug} is already claimed — pick a fresh one.`;
    case "invalid":
      return state.message;
  }
}

/* ─── My profile (GET /me, POST response) ─────────────────────────── */

export interface MyCreatorProfile {
  id: string | null;
  slug: string;
  displayName: string;
  vertical: string;
  bio: string;
}

/** The /me payload is the public profile shape at the top level
 *  (snake_case fields); the POST answer wraps it as { profile }.
 *  Both shapes parse here. */
export function parseMyCreatorProfile(data: unknown): MyCreatorProfile | null {
  const wrapped = asRecord(data)["profile"];
  const d = asRecord(typeof wrapped === "object" && wrapped !== null ? wrapped : data);
  const slug = str(d["slug"]);
  const displayName = str(d["display_name"]) ?? str(d["displayName"]);
  if (!slug || !displayName) return null;
  return {
    id: str(d["id"]),
    slug,
    displayName,
    vertical: str(d["vertical"]) ?? "music",
    bio: str(d["bio"]) ?? "",
  };
}

/** Create-readiness, in words — the desk's own gates before the
 *  rail is asked: a name, a locally valid handle whose live check
 *  came back available for THIS slug. */
export function creatorProfileFormProblem(input: {
  displayName: string;
  slug: string;
  slugCheck: SlugCheckState;
}): string | null {
  if (input.displayName.trim().length < 1) return "Give your profile a display name.";
  if (input.displayName.trim().length > 80) return "Display names can be at most 80 characters.";
  const slugProblem = creatorSlugProblem(input.slug);
  if (slugProblem) return slugProblem;
  const slug = normalizeCreatorSlug(input.slug);
  if (input.slugCheck.kind === "taken" && input.slugCheck.slug === slug) {
    return `@${slug} is already claimed — pick a fresh one.`;
  }
  if (input.slugCheck.kind === "invalid" && input.slugCheck.slug === slug) {
    return input.slugCheck.message;
  }
  if (input.slugCheck.kind !== "available" || input.slugCheck.slug !== slug) {
    return "Let the handle check finish — your profile needs a handle that's confirmed yours to claim.";
  }
  return null;
}

/** POST /api/creator-profiles body — the create rail's own field
 *  names, first-profile fields only. */
export function buildCreatorProfilePayload(input: {
  displayName: string;
  slug: string;
  bio: string;
  vertical: string;
}): Record<string, unknown> {
  const vertical = CREATOR_PROFILE_VERTICALS.some((v) => v.key === input.vertical)
    ? input.vertical
    : "music";
  return {
    slug: normalizeCreatorSlug(input.slug),
    display_name: input.displayName.trim(),
    bio: input.bio.trim(),
    vertical,
    is_public: true,
  };
}

/** The server error's own words from a failed create, when it sent
 *  any — the rail's 409/400 messages are honest and surface as-is. */
export function creatorProfileErrorLine(data: unknown, fallback: string): string {
  const d = asRecord(data);
  return str(d["error"]) ?? str(d["message"]) ?? fallback;
}
