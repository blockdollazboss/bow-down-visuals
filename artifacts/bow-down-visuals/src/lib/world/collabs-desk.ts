/* ─── Collabs desk seam (stack1100 world parity) ───────────────────
   Creator-to-creator collaboration, native in the Community Hall —
   on the collabs router's own rails, the same endpoints
   pages/collabs.tsx calls:

     GET  /api/collabs/profiles?niche=  → public creator cards
     GET  /api/collabs/profile/me       → { profile | null }
     POST /api/collabs/profile          → upsert my card (FREE)
     POST /api/collabs/match            → AI match report — 100
                                          Visual Bucs (registry-pinned,
                                          lib/credit-costs.ts; the
                                          rail refunds every failure
                                          path and says so)
     POST /api/collabs/requests         → send a request (FREE)
     GET  /api/collabs/requests         → { received, sent } — a
                                          received intro's pitch
                                          stays LOCKED until the
                                          receiver accepts (the
                                          rail's double opt-in)
     POST /api/collabs/requests/:id/respond { action } → FREE

   Niche/platform vocabulary mirrors the rail's own label tables
   (routes/generate/collabs.ts NICHE_LABELS / PLATFORM_LABELS) and
   the page's key lists — same words everywhere. */

export const COLLABS_PROFILES_PATH = "/api/collabs/profiles";
export const COLLAB_PROFILE_ME_PATH = "/api/collabs/profile/me";
export const COLLAB_PROFILE_PATH = "/api/collabs/profile";
export const COLLAB_MATCH_PATH = "/api/collabs/match";
export const COLLAB_REQUESTS_PATH = "/api/collabs/requests";

export function collabsProfilesPath(niche: string): string {
  return niche ? `${COLLABS_PROFILES_PATH}?niche=${encodeURIComponent(niche)}` : COLLABS_PROFILES_PATH;
}

export function collabRespondPath(id: string): string {
  return `/api/collabs/requests/${encodeURIComponent(id)}/respond`;
}

/** The registry's pinned price (lib/credit-costs.ts:
 *  "/api/collabs/match": { cost: 100, feature: "Collab Match
 *  Report" }) — named on the button and in the confirmation
 *  before the ask, like the page. */
export const COLLAB_MATCH_COST_VB = 100;
export const COLLAB_MATCH_FEATURE = "Collab Match Report";

export const COLLAB_NICHE_OPTIONS = [
  { key: "music", label: "Music" },
  { key: "gaming", label: "Gaming" },
  { key: "vlogging", label: "Vlogging" },
  { key: "comedy", label: "Comedy" },
  { key: "education", label: "Education" },
  { key: "fitness", label: "Fitness" },
  { key: "beauty", label: "Beauty" },
  { key: "tech", label: "Tech" },
  { key: "cooking", label: "Cooking" },
  { key: "travel", label: "Travel" },
  { key: "fashion", label: "Fashion" },
  { key: "podcasting", label: "Podcasting" },
  { key: "other", label: "Other" },
] as const;

export const COLLAB_PLATFORM_OPTIONS = [
  { key: "tiktok", label: "TikTok" },
  { key: "instagram", label: "Instagram" },
  { key: "youtube", label: "YouTube" },
  { key: "twitch", label: "Twitch" },
  { key: "x", label: "X" },
  { key: "discord", label: "Discord" },
] as const;

export function collabNicheLabel(key: string): string {
  return COLLAB_NICHE_OPTIONS.find((n) => n.key === key)?.label ?? "Other";
}

export function collabPlatformLabel(key: string): string {
  return COLLAB_PLATFORM_OPTIONS.find((p) => p.key === key)?.label ?? key;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/* ─── Browse cards ───────────────────────────────────────────────── */

export interface CollabPlatformView {
  platform: string;
  label: string;
  followers: number;
  followersLabel: string;
}

export interface CollabProfileCard {
  userId: string;
  displayName: string;
  niche: string;
  nicheLabel: string;
  platforms: CollabPlatformView[];
  collabInterests: string;
  bio: string;
  isOwn: boolean;
}

export function normalizeCollabProfiles(payload: unknown): CollabProfileCard[] | null {
  const root = asRecord(payload);
  if (!root || !Array.isArray(root["profiles"])) return null;
  const out: CollabProfileCard[] = [];
  for (const raw of root["profiles"]) {
    const r = asRecord(raw);
    if (!r) return null;
    const userId = str(r["userId"]);
    const displayName = str(r["displayName"]);
    if (!userId || !displayName) return null;
    const platforms: CollabPlatformView[] = [];
    if (Array.isArray(r["platforms"])) {
      for (const p of r["platforms"]) {
        const pr = asRecord(p);
        if (!pr) continue;
        platforms.push({
          platform: str(pr["platform"]),
          label: str(pr["label"]),
          followers: num(pr["followers"]),
          followersLabel: str(pr["followersLabel"]),
        });
      }
    }
    out.push({
      userId,
      displayName,
      niche: str(r["niche"]),
      nicheLabel: str(r["nicheLabel"]),
      platforms,
      collabInterests: str(r["collabInterests"]),
      bio: str(r["bio"]),
      isOwn: r["isOwn"] === true,
    });
  }
  return out;
}

/* ─── My profile ─────────────────────────────────────────────────── */

export interface MyCollabProfile {
  displayName: string;
  niche: string;
  platforms: Array<{ platform: string; followers: number }>;
  collabInterests: string;
  bio: string;
  isPublic: boolean;
}

export type MyCollabProfileRead =
  | { state: "failed" }
  | { state: "none" }
  | { state: "ready"; profile: MyCollabProfile };

export function parseMyCollabProfile(payload: unknown): MyCollabProfileRead {
  const root = asRecord(payload);
  if (!root || !("profile" in root)) return { state: "failed" };
  const raw = root["profile"];
  if (raw === null) return { state: "none" };
  const r = asRecord(raw);
  if (!r) return { state: "failed" };
  const platforms: Array<{ platform: string; followers: number }> = [];
  if (Array.isArray(r["platforms"])) {
    for (const p of r["platforms"]) {
      const pr = asRecord(p);
      if (!pr) continue;
      platforms.push({ platform: str(pr["platform"]), followers: num(pr["followers"]) });
    }
  }
  return {
    state: "ready",
    profile: {
      displayName: str(r["displayName"]),
      niche: str(r["niche"]),
      platforms,
      collabInterests: str(r["collabInterests"]),
      bio: str(r["bio"]),
      isPublic: r["isPublic"] !== false,
    },
  };
}

export interface CollabProfileForm {
  displayName: string;
  niche: string;
  platforms: Array<{ platform: string; followersText: string }>;
  collabInterests: string;
  bio: string;
  isPublic: boolean;
}

export function profileFormFrom(profile: MyCollabProfile): CollabProfileForm {
  return {
    displayName: profile.displayName,
    niche: profile.niche || "music",
    platforms: profile.platforms.map((p) => ({
      platform: p.platform,
      followersText: String(p.followers),
    })),
    collabInterests: profile.collabInterests,
    bio: profile.bio,
    isPublic: profile.isPublic,
  };
}

/** The rail's upsert rules (upsertProfileSchema): name 1–60, niche
 *  in the enum, ≤6 platform rows each a known platform with an
 *  integer follower count 0–1e9, interests/bio ≤500. */
export function profileFormReady(form: CollabProfileForm): boolean {
  const name = form.displayName.trim();
  if (name.length === 0 || name.length > 60) return false;
  if (!COLLAB_NICHE_OPTIONS.some((n) => n.key === form.niche)) return false;
  if (form.platforms.length > 6) return false;
  for (const row of form.platforms) {
    if (!COLLAB_PLATFORM_OPTIONS.some((p) => p.key === row.platform)) return false;
    const followers = Number(row.followersText);
    if (!Number.isInteger(followers) || followers < 0 || followers > 1_000_000_000) return false;
  }
  if (form.collabInterests.length > 500 || form.bio.length > 500) return false;
  return true;
}

export function buildProfileBody(form: CollabProfileForm): Record<string, unknown> {
  return {
    displayName: form.displayName.trim(),
    niche: form.niche,
    platforms: form.platforms.map((row) => ({
      platform: row.platform,
      followers: Number(row.followersText),
    })),
    collabInterests: form.collabInterests.trim(),
    bio: form.bio.trim(),
    isPublic: form.isPublic,
  };
}

/* ─── The match report ───────────────────────────────────────────── */

export interface CollabMatchReport {
  score: number;
  verdict: string;
  strengths: string[];
  risks: string[];
  ideas: string[];
  targetDisplayName: string;
}

export interface CollabMatchResult {
  report: CollabMatchReport;
  creditsUsed: number;
  creditsRemaining: number;
}

export function parseMatchResult(payload: unknown): CollabMatchResult | null {
  const root = asRecord(payload);
  const report = root ? asRecord(root["report"]) : null;
  if (!root || !report) return null;
  const score = report["score"];
  if (typeof score !== "number" || !Number.isFinite(score)) return null;
  return {
    report: {
      score,
      verdict: str(report["verdict"]),
      strengths: strList(report["strengths"]),
      risks: strList(report["risks"]),
      ideas: strList(report["ideas"]),
      targetDisplayName: str(report["targetDisplayName"]),
    },
    creditsUsed: num(root["creditsUsed"]),
    creditsRemaining: num(root["creditsRemaining"]),
  };
}

/* ─── Requests ───────────────────────────────────────────────────── */

export interface CollabRequestReceived {
  id: string;
  message: string;
  status: string;
  createdAt: string;
  fromUserId: string;
  fromDisplayName: string | null;
  fromNiche: string | null;
  introLocked: boolean;
  lockedReason: string | null;
}

export interface CollabRequestSent {
  id: string;
  message: string;
  status: string;
  createdAt: string;
  toUserId: string;
  toDisplayName: string | null;
  toNiche: string | null;
}

export interface CollabRequests {
  received: CollabRequestReceived[];
  sent: CollabRequestSent[];
}

export function normalizeCollabRequests(payload: unknown): CollabRequests | null {
  const root = asRecord(payload);
  if (!root || !Array.isArray(root["received"]) || !Array.isArray(root["sent"])) return null;
  const received: CollabRequestReceived[] = [];
  for (const raw of root["received"]) {
    const r = asRecord(raw);
    if (!r || !str(r["id"])) return null;
    received.push({
      id: str(r["id"]),
      message: str(r["message"]),
      status: str(r["status"], "pending"),
      createdAt: str(r["createdAt"]),
      fromUserId: str(r["fromUserId"]),
      fromDisplayName: typeof r["fromDisplayName"] === "string" ? r["fromDisplayName"] : null,
      fromNiche: typeof r["fromNiche"] === "string" ? r["fromNiche"] : null,
      introLocked: r["introLocked"] === true,
      lockedReason: typeof r["lockedReason"] === "string" ? r["lockedReason"] : null,
    });
  }
  const sent: CollabRequestSent[] = [];
  for (const raw of root["sent"]) {
    const r = asRecord(raw);
    if (!r || !str(r["id"])) return null;
    sent.push({
      id: str(r["id"]),
      message: str(r["message"]),
      status: str(r["status"], "pending"),
      createdAt: str(r["createdAt"]),
      toUserId: str(r["toUserId"]),
      toDisplayName: typeof r["toDisplayName"] === "string" ? r["toDisplayName"] : null,
      toNiche: typeof r["toNiche"] === "string" ? r["toNiche"] : null,
    });
  }
  return { received, sent };
}

export function requestStatusLabel(status: string): string {
  if (status === "accepted") return "Accepted — you're connected";
  if (status === "declined") return "Declined";
  return "Waiting for an answer";
}

/** The send rail's rule (sendRequestSchema): a real message,
 *  1–1000 chars. */
export function sendRequestReady(message: string): boolean {
  const m = message.trim();
  return m.length >= 1 && m.length <= 1000;
}

export function buildSendRequestBody(toUserId: string, message: string): Record<string, unknown> {
  return { toUserId, message: message.trim() };
}
