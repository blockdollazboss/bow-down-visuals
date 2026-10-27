/* Duo/Group Profiles (Stack-200 UPGRADE N20) — pure view-model for the
   FE surfaces: the public group page (/group/:slug) and the Team-page
   editor card. Kept JSX-free so it is unit-testable, mirroring
   lib/vault-view.ts. The API (routes/group-profiles.ts) is the source
   of truth — every rule here only mirrors it so the form can be honest
   before the server re-validates. */

export interface GroupSplitTerm {
  userId: string;
  sharePct: number;
}

export interface GroupPublicView {
  slug: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
  bannerUrl: string | null;
  splitTerms: GroupSplitTerm[] | null;
}

export interface GroupOwnView extends GroupPublicView {
  id: string;
  teamId: string;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GroupMemberCredit {
  userId: string;
  role: string;
  displayName: string;
  slug: string | null;
  avatarUrl: string | null;
  sharePct: number | null;
}

export interface GroupStoreProduct {
  id: string;
  kind: string;
  title: string;
  description: string;
  priceCents: number;
  compareAtCents: number | null;
  inventory: number;
  mediaUrls: string[];
  splits: GroupSplitTerm[] | null;
}

export interface GroupProfilePageDto {
  group: GroupPublicView;
  members: GroupMemberCredit[];
  products: GroupStoreProduct[];
}

export interface GroupProfileOwnDto {
  group: GroupOwnView | null;
  members: GroupMemberCredit[];
  products: GroupStoreProduct[];
}

/* ── Slug — the same shape the API + DB check enforce ─────────────── */
export const GROUP_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

export function normalizeGroupSlugInput(input: string): string | null {
  const slug = input.trim().toLowerCase();
  return GROUP_SLUG_RE.test(slug) ? slug : null;
}

/* ── Money — cents in, honest dollars out (never a float surprise) ── */
export function formatGroupPrice(cents: number): string {
  if (!Number.isFinite(cents) || cents < 0) return "$0.00";
  return `$${(Math.round(cents) / 100).toFixed(2)}`;
}

export function parsePriceToCents(input: string): number | null {
  const n = Number(input);
  if (!Number.isFinite(n) || n < 0) return null;
  const cents = Math.round(n * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

/* ── Product kinds the shared store accepts (API list, mirrored) ─── */
export const GROUP_PRODUCT_KINDS = [
  "download",
  "merch",
  "digital",
  "service",
  "ticket",
  "course",
  "gift_card",
] as const;

const KIND_LABELS: Record<string, string> = {
  download: "Download",
  merch: "Merch",
  digital: "Digital",
  service: "Service",
  ticket: "Ticket",
  course: "Course",
  gift_card: "Gift card",
};

export function groupKindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? "Product";
}

/* ── Who may manage the public identity (API: owner/admin) ───────── */
export function canManageGroupProfile(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

/* ── Split terms, displayed ──────────────────────────────────────────
   The public page shows the written terms next to the people they
   name: one row per credited member who holds a share, in the API's
   credit order. Members without a share don't appear — the terms are
   what was published, nothing inferred. */
export interface SplitTermRow {
  userId: string;
  displayName: string;
  role: string;
  sharePct: number;
}

export function splitTermRows(
  terms: GroupSplitTerm[] | null,
  members: GroupMemberCredit[],
): SplitTermRow[] {
  if (!terms || terms.length === 0) return [];
  const byUser = new Map(members.map((m) => [m.userId, m]));
  const rows: SplitTermRow[] = [];
  for (const m of members) {
    if (m.sharePct != null) {
      rows.push({ userId: m.userId, displayName: m.displayName, role: m.role, sharePct: m.sharePct });
    }
  }
  /* A term naming someone the credit list didn't resolve still shows —
     by share only, never with an invented name. */
  for (const term of terms) {
    if (!byUser.has(term.userId)) {
      rows.push({ userId: term.userId, displayName: "Team member", role: "member", sharePct: term.sharePct });
    }
  }
  return rows;
}

/* ── Split terms, edited ─────────────────────────────────────────────
   The editor holds one % field per credited member. Building the
   payload mirrors the server machine: blank/zero = no share; when any
   share is set the shares must total exactly 100 and the owner must
   hold one; a lone owner at 100% is "no written terms" (null), the
   same collapse the API performs. */
export type SplitTermsBuild =
  | { ok: true; terms: GroupSplitTerm[] | null }
  | { ok: false; error: string };

export function buildSplitTerms(
  ownerUserId: string,
  shares: ReadonlyArray<{ userId: string; pct: string }>,
): SplitTermsBuild {
  const rows: GroupSplitTerm[] = [];
  for (const s of shares) {
    const raw = s.pct.trim();
    if (raw === "") continue;
    const pct = Number(raw);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
      return { ok: false, error: "Each share must be more than 0 and at most 100." };
    }
    if (Math.round(pct * 100) !== pct * 100) {
      return { ok: false, error: "Shares can carry at most two decimal places." };
    }
    rows.push({ userId: s.userId, sharePct: pct });
  }
  if (rows.length === 0) return { ok: true, terms: null };
  const total = rows.reduce((sum, r) => sum + r.sharePct, 0);
  if (Math.round(total * 100) !== 10000) {
    return { ok: false, error: `Shares must add up to exactly 100% — right now they add up to ${total}%.` };
  }
  if (!rows.some((r) => r.userId === ownerUserId)) {
    return { ok: false, error: "The team owner must hold a share in the group's split terms." };
  }
  if (rows.length === 1 && rows[0]!.userId === ownerUserId && rows[0]!.sharePct === 100) {
    return { ok: true, terms: null };
  }
  return { ok: true, terms: rows };
}

/* ── Fetchers ────────────────────────────────────────────────────────
   The public read throws with its HTTP status attached so the page can
   tell a genuine 404 ("no such group / not published") apart from a
   load failure — the same distinction artist-public.tsx draws. */
export class GroupProfileFetchError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function fetchPublicGroupProfile(slug: string): Promise<GroupProfilePageDto> {
  const res = await fetch(`/api/group-profiles/${encodeURIComponent(slug)}`);
  if (!res.ok) {
    throw new GroupProfileFetchError(res.status, `Group profile request failed (${res.status})`);
  }
  return (await res.json()) as GroupProfilePageDto;
}
