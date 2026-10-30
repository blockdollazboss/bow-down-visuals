/* Shared constants for the Music Distribution hub (/distribute).
   Platform keys must stay in sync with the backend route's
   DISTRIBUTION_PLATFORMS enum in
   artifacts/api-server/src/routes/generate/distribution.ts. */

export const DISTRIBUTION_PLATFORMS = [
  { key: "spotify", label: "Spotify" },
  { key: "apple_music", label: "Apple Music" },
  { key: "youtube_music", label: "YouTube Music" },
  { key: "tiktok", label: "TikTok" },
  { key: "instagram", label: "Instagram" },
  { key: "amazon_music", label: "Amazon Music" },
  { key: "deezer", label: "Deezer" },
  { key: "tidal", label: "Tidal" },
  { key: "correctional", label: "Jails & Prisons" },
] as const;

export type DistributionPlatformKey = (typeof DISTRIBUTION_PLATFORMS)[number]["key"];

/** Pricing shown in the UI — mirrors the backend env-overridable defaults. */
export const DISTRIBUTION_AI_CREDIT_COST = 100;
export const DISTRIBUTION_PACKAGING_CREDITS = 10;

export function platformLabel(key: string): string {
  return DISTRIBUTION_PLATFORMS.find((p) => p.key === key)?.label ?? key;
}

/** Release lifecycle statuses. draft → submit (pay tier price) → packaged,
    after which the aggregator delivery job moves each platform's status
    through queued → pending → delivered → live. */
export const DISTRIBUTION_STATUSES = ["draft", "packaged"] as const;
export type DistributionStatus = (typeof DISTRIBUTION_STATUSES)[number];

export function isPackaged(status: string): boolean {
  return status === "packaged";
}

/* ── Release tiers (credits charged at submit) ──────────────────────────
   Mirrors the backend pricing defaults; the UI also fetches
   GET /api/distribution/pricing and prefers that when it loads. */
export const DISTRIBUTION_TIERS = [
  { type: "single", credits: 1000, label: "Single", blurb: "1 track — one release event" },
  { type: "ep", credits: 2000, label: "EP", blurb: "2–6 tracks — a short project" },
  { type: "album", credits: 3000, label: "Album", blurb: "7–30 tracks — a full project" },
] as const;

export type DistributionTier = (typeof DISTRIBUTION_TIERS)[number]["type"];

export function tierCredits(type: string): number {
  return DISTRIBUTION_TIERS.find((t) => t.type === type)?.credits ?? 1000;
}

export function tierLabel(type: string): string {
  return DISTRIBUTION_TIERS.find((t) => t.type === type)?.label ?? type;
}

/* ── Per-platform delivery statuses ─────────────────────────────────────
   Progression: queued → pending → delivered → live. "failed" is terminal.
   The UI only ever shows a status the API returned — never invents one. */
export const PLATFORM_STATUSES = ["queued", "pending", "delivered", "live", "failed"] as const;
export type PlatformStatusValue = (typeof PLATFORM_STATUSES)[number];

export interface PlatformStatusEntry {
  platform: string;
  status: PlatformStatusValue;
  detail?: string;
  updatedAt?: string;
}

/** Non-terminal statuses — the tracker keeps polling while any of these
    are present. "delivered", "live", and "failed" stop the poll loop. */
const TERMINAL_PLATFORM_STATUSES: ReadonlySet<string> = new Set(["delivered", "live", "failed"]);

export function isTerminalPlatformStatus(status: string): boolean {
  return TERMINAL_PLATFORM_STATUSES.has(status);
}

export function platformStatusLabel(status: string): string {
  switch (status) {
    case "queued": return "Queued";
    case "pending": return "Pending";
    case "delivered": return "Delivered";
    case "live": return "Live";
    case "failed": return "Failed";
    default: return status;
  }
}

/* ── Royalty splits ───────────────────────────────────────────────────── */
export interface RoyaltySplit {
  id?: string;
  name: string;
  role?: string;
  email?: string | null;
  inviteStatus?: string;
  share: number;
  agreementVersion?: number;
  effectiveFrom?: string;
}

/** Canonical collaborator roles for a split agreement (DistroKid parity). */
export const SPLIT_ROLES = ["artist", "producer", "writer", "featured"] as const;

export function roleLabel(role: string | undefined | null): string {
  switch ((role ?? "").toLowerCase()) {
    case "artist": return "Artist";
    case "producer": return "Producer";
    case "writer": return "Writer";
    case "featured": return "Featured";
    default: return role?.trim() || "Collaborator";
  }
}

/** Shares must total exactly 100 (within floating-point tolerance). */
export function splitsTotal(splits: RoyaltySplit[]): number {
  return splits.reduce((sum, s) => sum + (Number(s.share) || 0), 0);
}

export function splitsValid(splits: RoyaltySplit[]): boolean {
  if (splits.length === 0) return true;
  if (splits.some((s) => !s.name.trim() || Number(s.share) <= 0)) return false;
  return Math.abs(splitsTotal(splits) - 100) < 0.01;
}

/* ── Release readiness — the client mirror of the server's submit gate ──
   The server is the truth: POST /distribution/releases/:id/submit runs
   buildChecklist (artifacts/api-server/src/routes/generate/distribution.ts)
   and refuses to package — before any charge — until every item passes.
   The wizard used to keep its own shorter list: it called a release
   ready with no cover art, no genre, a release date tomorrow, a
   2-track "album", or a 1-character title, and the server refused at
   the final step. This mirror runs the SAME rules over the wizard's
   local state so the review step can never promise what the submit
   gate will deny. The create rail's own gates ride along, because the
   wizard creates and submits in one motion: a hand-typed audio or
   artwork link must be a real URL (the create schema's z.string().url())
   and every ISRC present must match the server's 12-character pattern.
   Labels and hints are the server's own words — the Releases tab
   renders the server's checklist verbatim, so both steps of the flow
   now speak one language. */

export const RELEASE_TRACK_RANGES: Record<DistributionTier, [number, number]> = {
  single: [1, 1],
  ep: [2, 6],
  album: [7, 30],
};

export interface ReleaseChecklistInput {
  title: string;
  artistName: string;
  releaseType: DistributionTier;
  /** The audio link as the wizard holds it (a picked song fills it too). */
  audioUrl: string;
  artworkUrl: string;
  releaseDate: string;
  platforms: string[];
  /** The creator actively declared clean vs explicit AND confirmed it. */
  explicitDeclared: boolean;
  genre: string;
  tracks: { title: string; isrc?: string }[];
  isrc: string;
}

export interface ReleaseChecklistItem {
  key: string;
  label: string;
  ok: boolean;
  hint: string;
}

/** Mirror of the server's isValidIsrc: blank is fine (it assigns one);
 *  a present ISRC must be 12 chars — 2 country + 3 registrant + 7 digits. */
export function isValidIsrcFormat(v: string | undefined | null): boolean {
  if (!v || !v.trim()) return true;
  return /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(v.toUpperCase().replace(/[-\s]/g, ""));
}

function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function releaseChecklist(input: ReleaseChecklistInput, now: Date = new Date()): ReleaseChecklistItem[] {
  const [tMin, tMax] = RELEASE_TRACK_RANGES[input.releaseType] ?? RELEASE_TRACK_RANGES.single;

  const audio = input.audioUrl.trim();
  const artwork = input.artworkUrl.trim();

  const dateOk = (() => {
    if (!input.releaseDate.trim()) return false;
    const d = new Date(`${input.releaseDate.trim()}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return false;
    return (d.getTime() - now.getTime()) / 86_400_000 >= 7;
  })();
  const dateHint = (() => {
    if (!input.releaseDate.trim()) return "Pick a release date — platforms need at least 7 days lead time.";
    const d = new Date(`${input.releaseDate.trim()}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return "Use YYYY-MM-DD format.";
    const daysOut = (d.getTime() - now.getTime()) / 86_400_000;
    if (daysOut < 7) return "Too soon — platforms need at least 7 days lead time.";
    if (daysOut < 21) return "OK, but 3+ weeks gives playlist pitching a real shot.";
    return "Healthy lead time for playlist pitching.";
  })();

  const badIsrcs =
    input.tracks.filter((t) => !isValidIsrcFormat(t.isrc)).length + (isValidIsrcFormat(input.isrc) ? 0 : 1);

  return [
    {
      key: "title",
      label: "Release title",
      ok: input.title.trim().length >= 3,
      hint: "At least 3 characters — this is what fans search for.",
    },
    {
      key: "artist",
      label: "Artist name",
      ok: input.artistName.trim().length >= 2,
      hint: "Must match your artist profile exactly across releases.",
    },
    {
      key: "audio",
      label: "Master audio",
      ok: audio.length > 0 && isHttpUrl(audio),
      hint:
        audio.length > 0 && !isHttpUrl(audio)
          ? "That audio link isn't a valid URL — paste the full https:// link or pick a song from your library."
          : "Upload or pick a song from your library — WAV/MP3, final master.",
    },
    {
      key: "artwork",
      label: "Cover art",
      ok: artwork.length > 0 && isHttpUrl(artwork),
      hint:
        artwork.length > 0 && !isHttpUrl(artwork)
          ? "That cover link isn't a valid URL — paste the full https:// link or generate the art."
          : "3000×3000px JPG/PNG, no blurry screenshots.",
    },
    {
      key: "releaseDate",
      label: "Release date",
      ok: dateOk,
      hint: dateHint,
    },
    {
      key: "platforms",
      label: "Platforms",
      ok: input.platforms.length >= 1,
      hint: "Pick at least one platform to deliver to.",
    },
    {
      key: "explicit",
      label: "Explicit declaration",
      ok: input.explicitDeclared,
      hint: "You must declare clean or explicit — platforms reject undeclared releases.",
    },
    {
      key: "genre",
      label: "Genre",
      ok: input.genre.trim().length > 0,
      hint: "Primary genre drives playlist and radio placement.",
    },
    {
      key: "tracks",
      label: `Track listing (${input.releaseType === "single" ? "1 track" : input.releaseType === "ep" ? "2–6 tracks" : "7–30 tracks"})`,
      ok:
        input.tracks.length >= tMin &&
        input.tracks.length <= tMax &&
        input.tracks.every((t) => t.title.trim().length > 0),
      hint:
        input.releaseType === "single"
          ? "A single needs exactly 1 track."
          : input.releaseType === "ep"
            ? "An EP needs 2–6 tracks."
            : "An album needs 7–30 tracks.",
    },
    {
      key: "isrc",
      label: "ISRC codes",
      ok: badIsrcs === 0,
      hint: "Optional, but recommended — 12 characters (e.g. USABC2412345). We assign one if you skip it.",
    },
  ];
}

export function releaseChecklistPasses(items: ReleaseChecklistItem[]): boolean {
  return items.every((i) => i.ok);
}
