/* ─── Team desk seam (stack1500 world parity, wave #4a item 19) ─────
   The Team Workspace (census: `team` — ABSENT in-World, the largest
   remaining parity gap) native at the My Studio board, stacked
   under the Studio Board like its wave #1–3 neighbours. The desk
   rides the 2D /team page's own rails end to end
   (artifacts/api-server/src/routes/teams.ts +
   routes/group-profiles.ts):

   - GET    /api/teams                       my teams + pending invites
   - POST   /api/teams                       create (Shot Caller+ only)
   - GET    /api/teams/:id                   detail + members + my role
   - PATCH  /api/teams/:id                   rename / personal-fallback
                                             (owner/admin)
   - POST   /api/teams/:id/invite            invite by email (owner/admin)
   - POST   /api/teams/:id/accept            accept an invite
   - POST   /api/teams/:id/decline           decline an invite
   - PATCH  /api/teams/:id/members/:mid      role change (owner only)
   - DELETE /api/teams/:id/members/:mid      remove member (owner/admin)
   - POST   /api/teams/:id/leave             leave (non-owner)
   - POST   /api/teams/:id/fund              fund the pool (owner/admin)
   - GET    /api/teams/:id/spending          per-member pool spending
                                             (owner/admin)
   - DELETE /api/teams/:id                   delete team (owner only)
   - GET    /api/teams/:id/group-profile     the duo/group public half's
                                             own view (any active member)
   - POST   /api/teams/:id/group-profile     upsert identity + written
                                             split terms (owner/admin)
   - POST   /api/teams/:id/group-profile/products
                                             add to the shared store
                                             (owner/admin)
   - GET    /api/group-profiles/:slug        the public view — read
                                             IN the desk via the page's
                                             own lib fetcher, never a
                                             walk out of the palace

   PRICES: no team rail carries a fixed price — lib/credit-costs.ts
   has NO /api/teams rows, and the desk invents none. Every rail is
   free to call. The one money move, funding the pool, moves the
   member's OWN chosen amount of Visual Bucs from their personal
   balance into the pool (the rail charges the personal balance and
   refunds it itself if crediting the pool fails), so it rides the
   confirmed-spend seam with the amount itself as the explicit
   overrideCost — the Books desk's print-total precedent — and the
   member confirms the exact figure before anything moves. A 402
   lands in an out-of-Bucs state naming the Treasury's Visual Buc
   Packs desk, like its neighbours.

   ENTITLEMENT: the workspace is a Shot Caller-tier feature and the
   rail fails closed — GET /api/teams answers 403 with the rail's
   own sentence (pinned below) for anyone under tier. The desk
   renders that as a locked state in the rail's words, never as a
   load error and never as an empty workspace.

   SHARED VAULTS (stack100 wave 5, item 28): the share action rides
   the vault's own rail — POST /api/artist-vaults/:id/share
   (owner-only; sets/clears the row's team_id) — the same call the
   2D Creator Vault page makes (pages/artist-vault.tsx shareVault).
   The desk lists the member's OWN vaults (GET /api/artist-vaults,
   filtered to rows the caller owns — the rail refuses everyone
   else) and toggles each one's sharing in place; the answer's
   teamId is the state the desk renders, never an optimistic guess.
   Sharing is FREE: the share rail has no credit-costs row and
   never charges (the registry's artist-vaults rows are the
   voice-clone and identity-photo rails — different actions). The
   old "mark it shared from the Creator Vault page" note is
   RETIRED — the World's figure pipeline already honours
   team-shared vault rows (lib/world/characters.ts), and now the
   marking itself happens here too. No new desk number is claimed:
   the toggle extends this desk (parity wave #4a item 19's desk),
   it is not a new desk.

   TEAM SEATS is a different surface (account seats in Settings —
   /api/team-seats, manager/collaborator/viewer roles) with no
   in-World form anywhere; it is NOT this desk and is named as an
   adjacent gap in the lane report, not silently folded in.

   Parsers are strict the house way: a broken or incomplete rail
   answer reads as a failed read (null), never painted-over content.
   ────────────────────────────────────────────────────────────────── */

import type {
  GroupMemberCredit,
  GroupOwnView,
  GroupProfileOwnDto,
} from "../group-profile-view";

/* ─── rails ──────────────────────────────────────────────────────── */

export const TEAMS_PATH = "/api/teams";

export function teamDetailPath(teamId: string): string {
  return `/api/teams/${teamId}`;
}
export function teamInvitePath(teamId: string): string {
  return `/api/teams/${teamId}/invite`;
}
export function teamAcceptPath(teamId: string): string {
  return `/api/teams/${teamId}/accept`;
}
export function teamDeclinePath(teamId: string): string {
  return `/api/teams/${teamId}/decline`;
}
export function teamMemberPath(teamId: string, memberId: string): string {
  return `/api/teams/${teamId}/members/${memberId}`;
}
export function teamLeavePath(teamId: string): string {
  return `/api/teams/${teamId}/leave`;
}
export function teamFundPath(teamId: string): string {
  return `/api/teams/${teamId}/fund`;
}
export function teamSpendingPath(teamId: string): string {
  return `/api/teams/${teamId}/spending`;
}
export function teamGroupProfilePath(teamId: string): string {
  return `/api/teams/${teamId}/group-profile`;
}
export function teamGroupProductsPath(teamId: string): string {
  return `/api/teams/${teamId}/group-profile/products`;
}
export function groupPublicPath(slug: string): string {
  return `/api/group-profiles/${slug}`;
}

/* ─── vault sharing rails (the vault's own routes, not team rails) ── */

export const VAULTS_PATH = "/api/artist-vaults";

export function vaultSharePath(vaultId: string): string {
  return `/api/artist-vaults/${vaultId}/share`;
}

/* ─── the rail's own rules, pinned ───────────────────────────────── */

export const TEAM_NAME_MAX = 80;

/** routes/teams.ts, verbatim — the fail-closed entitlement sentence
 *  GET/POST /api/teams answer under-tier callers with. */
export const TEAM_TIER_GATE_MESSAGE =
  "Team Workspace requires Shot Caller tier or higher.";

export const TEAM_ROLES = ["owner", "admin", "member"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

/** Roles an invite may carry — the rail refuses anything else. */
export const TEAM_INVITE_ROLES = ["admin", "member"] as const;

/** The page's own fallback hints (en.json team.fallbackOnHint /
 *  team.fallbackOffHint), verbatim. */
export const TEAM_FALLBACK_ON_HINT =
  "When the pool runs low, member spending uses personal Visual Bucs.";
export const TEAM_FALLBACK_OFF_HINT =
  "Pool-only: spending stops when the pool is empty. Personal Visual Bucs are never touched.";

/* ─── shapes (mirror routes/teams.ts answers + the page's types) ── */

export interface TeamRow {
  id: string;
  name: string;
  logoUrl: string | null;
  ownerId: string;
  credits: number;
  allowPersonalFallback: boolean;
  myRole: string | null;
  myStatus: string | null;
}

export interface TeamMemberRow {
  id: string;
  teamId: string;
  userId: string | null;
  email: string;
  role: string;
  status: string;
  joinedAt: string | null;
}

export interface TeamInviteRow {
  id: string;
  teamId: string;
  email: string;
  role: string;
  status: string;
  team: { id: string; name: string } | null;
}

export interface TeamList {
  teams: TeamRow[];
  invites: TeamInviteRow[];
}

export interface TeamDetail {
  team: TeamRow;
  members: TeamMemberRow[];
  myRole: string | null;
}

export interface TeamSpendRow {
  userId: string;
  email: string | null;
  action: string;
  total: number;
}

export interface TeamFundResult {
  team: TeamRow;
  duplicate: boolean;
}

/** One of the member's OWN artist vaults, shaped for the share
 *  toggle: the rail row's team_id is the sharing truth (null =
 *  private). Teammates' vaults shared with the caller never appear
 *  here — the share rail is owner-only, so the desk only offers
 *  the toggle where it can work. */
export interface TeamVaultRow {
  id: string;
  name: string;
  teamId: string | null;
  shared: boolean;
}

/** The share rail's answer: { ok: true, teamId } — teamId is the
 *  vault's NEW sharing state (the active team's id, or null once
 *  unshared). The desk renders exactly this, never its own guess. */
export interface VaultShareResult {
  teamId: string | null;
}

export interface TeamGroupProduct {
  id: string;
  kind: string;
  title: string;
  description: string;
  priceCents: number;
  compareAtCents: number | null;
  inventory: number;
  mediaUrls: string[];
}

/* ─── role rules (the page's + the rail's, in one place) ────────── */

const ROLE_RANK: Record<string, number> = { member: 0, admin: 1, owner: 2 };

export function roleRank(role: string | null | undefined): number {
  return ROLE_RANK[role ?? ""] ?? -1;
}

export function isTeamAdmin(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

export function isTeamOwner(role: string | null | undefined): boolean {
  return role === "owner";
}

/** The page only offers the role select to the owner, for active
 *  members who are not the owner; the rail enforces the same. */
export function canChangeRoles(
  callerRole: string | null | undefined,
  target: Pick<TeamMemberRow, "role" | "status">,
): boolean {
  return isTeamOwner(callerRole) && target.role !== "owner" && target.status === "active";
}

/** Page rule, mirroring the rail: the owner removes anyone but the
 *  owner; an admin removes members only (never another admin). */
export function canRemoveMember(
  callerRole: string | null | undefined,
  target: Pick<TeamMemberRow, "role">,
): boolean {
  if (target.role === "owner") return false;
  if (isTeamOwner(callerRole)) return true;
  return callerRole === "admin" && target.role === "member";
}

/** The page's active team: the membership whose status is active. */
export function activeTeamFromList(teams: readonly TeamRow[]): TeamRow | null {
  return teams.find((t) => t.myStatus === "active") ?? null;
}

/* ─── payload builders + form gates (the page's own rules) ──────── */

export function teamNameReady(name: string): boolean {
  const n = name.trim();
  return n.length > 0 && n.length <= TEAM_NAME_MAX;
}

export function buildCreateTeamPayload(name: string): { name: string } {
  return { name: name.trim() };
}

export function buildRenamePayload(name: string): { name: string } {
  return { name: name.trim() };
}

export function buildFallbackPayload(next: boolean): { allowPersonalFallback: boolean } {
  return { allowPersonalFallback: next };
}

/** The server's own email rule, the one pages/team.tsx applies
 *  before the trip (and the rail re-checks). */
export function inviteEmailValid(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export function buildInvitePayload(
  email: string,
  role: string,
): { email: string; role: string } {
  return {
    email: email.trim().toLowerCase(),
    role: TEAM_INVITE_ROLES.includes(role as (typeof TEAM_INVITE_ROLES)[number])
      ? role
      : "member",
  };
}

export function buildRolePayload(role: string): { role: string } {
  return { role: role === "admin" ? "admin" : "member" };
}

/** The page's fund-amount rule: whole Bucs, floored, above zero. */
export function fundAmountFromInput(input: string): number | null {
  const amount = Math.floor(Number(input));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount;
}

/** The page's idempotency-key shape: a UUID when the platform offers
 *  one, a timestamp+random key otherwise. One key per fund operation —
 *  a retry with the same key returns the original result server-side
 *  instead of double-funding. */
export function fundIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function buildFundPayload(
  amount: number,
  idempotencyKey: string,
): { credits: number; idempotencyKey: string } {
  return { credits: amount, idempotencyKey };
}

export function buildGroupProductPayload(input: {
  kind: string;
  title: string;
  priceCents: number;
}): { kind: string; title: string; priceCents: number } {
  return { kind: input.kind, title: input.title.trim(), priceCents: input.priceCents };
}

/** The 2D page's exact share body (pages/artist-vault.tsx
 *  shareVault): { share } — the rail reads share === true
 *  strictly; anything else unshares. */
export function buildVaultSharePayload(share: boolean): { share: boolean } {
  return { share };
}

/* ─── error classification ───────────────────────────────────────── */

/** True when a failed /api/teams answer is the entitlement gate
 *  (403 + the rail's own sentence), not a load failure. */
export function isTierGateError(status: number, message: string): boolean {
  return status === 403 && message.includes("Shot Caller");
}

/* ─── parsers (strict: incomplete ⇒ null, a failed read) ────────── */

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return null;
}

export function parseTeamRow(v: unknown): TeamRow | null {
  if (!isRecord(v)) return null;
  const id = str(v.id);
  const name = str(v.name);
  const ownerId = str(v.ownerId);
  const credits = num(v.credits);
  if (!id || !name || !ownerId || credits === null) return null;
  return {
    id,
    name,
    logoUrl: strOrNull(v.logoUrl),
    ownerId,
    credits,
    allowPersonalFallback:
      typeof v.allowPersonalFallback === "boolean" ? v.allowPersonalFallback : true,
    myRole: strOrNull(v.myRole),
    myStatus: strOrNull(v.myStatus),
  };
}

export function parseMemberRow(v: unknown): TeamMemberRow | null {
  if (!isRecord(v)) return null;
  const id = str(v.id);
  const teamId = str(v.teamId);
  const email = str(v.email);
  if (!id || !teamId || !email) return null;
  return {
    id,
    teamId,
    userId: strOrNull(v.userId),
    email,
    role: str(v.role) || "member",
    status: str(v.status) || "invited",
    joinedAt: strOrNull(v.joinedAt),
  };
}

function parseInviteRow(v: unknown): TeamInviteRow | null {
  if (!isRecord(v)) return null;
  const id = str(v.id);
  const teamId = str(v.teamId);
  const email = str(v.email);
  if (!id || !teamId || !email) return null;
  let team: { id: string; name: string } | null = null;
  if (isRecord(v.team)) {
    const tid = str(v.team.id);
    const tname = str(v.team.name);
    if (tid && tname) team = { id: tid, name: tname };
  }
  return {
    id,
    teamId,
    email,
    role: str(v.role) || "member",
    status: str(v.status) || "invited",
    team,
  };
}

export function parseTeamList(data: unknown): TeamList | null {
  if (!isRecord(data)) return null;
  if (!Array.isArray(data.teams) || !Array.isArray(data.invites)) return null;
  const teams: TeamRow[] = [];
  for (const raw of data.teams) {
    const row = parseTeamRow(raw);
    if (row) teams.push(row);
  }
  const invites: TeamInviteRow[] = [];
  for (const raw of data.invites) {
    const row = parseInviteRow(raw);
    if (row) invites.push(row);
  }
  return { teams, invites };
}

export function parseTeamDetail(data: unknown): TeamDetail | null {
  if (!isRecord(data)) return null;
  const team = parseTeamRow(data.team);
  if (!team) return null;
  if (!Array.isArray(data.members)) return null;
  const members: TeamMemberRow[] = [];
  for (const raw of data.members) {
    const row = parseMemberRow(raw);
    if (row) members.push(row);
  }
  return { team, members, myRole: strOrNull(data.myRole) ?? team.myRole };
}

export function parseSpending(data: unknown): TeamSpendRow[] | null {
  if (!isRecord(data) || !Array.isArray(data.spending)) return null;
  const rows: TeamSpendRow[] = [];
  for (const raw of data.spending) {
    if (!isRecord(raw)) continue;
    const userId = str(raw.userId);
    const action = str(raw.action);
    const total = num(raw.total);
    if (!userId || !action || total === null) continue;
    rows.push({ userId, email: strOrNull(raw.email), action, total });
  }
  return rows;
}

export function parseFundResult(data: unknown): TeamFundResult | null {
  if (!isRecord(data)) return null;
  const team = parseTeamRow(data.team);
  if (!team) return null;
  return { team, duplicate: data.duplicate === true };
}

function parseSplitTerms(v: unknown): { userId: string; sharePct: number }[] | null {
  if (v === null || v === undefined) return null;
  if (!Array.isArray(v)) return null;
  const out: { userId: string; sharePct: number }[] = [];
  for (const raw of v) {
    if (!isRecord(raw)) continue;
    const userId = str(raw.userId);
    const sharePct = num(raw.sharePct);
    if (userId && sharePct !== null) out.push({ userId, sharePct });
  }
  return out;
}

export function parseGroupOwn(data: unknown): GroupProfileOwnDto | null {
  if (!isRecord(data)) return null;
  if (!Array.isArray(data.members) || !Array.isArray(data.products)) return null;

  let group: GroupOwnView | null = null;
  if (data.group !== null && data.group !== undefined) {
    if (!isRecord(data.group)) return null;
    const g = data.group;
    const id = str(g.id);
    const teamId = str(g.teamId);
    const slug = str(g.slug);
    const displayName = str(g.displayName);
    if (!id || !teamId || !slug || !displayName) return null;
    group = {
      id,
      teamId,
      slug,
      displayName,
      bio: typeof g.bio === "string" ? g.bio : "",
      avatarUrl: strOrNull(g.avatarUrl),
      bannerUrl: strOrNull(g.bannerUrl),
      splitTerms: parseSplitTerms(g.splitTerms),
      isPublished: g.isPublished === true,
      createdAt: str(g.createdAt),
      updatedAt: str(g.updatedAt),
    };
  }

  const members: GroupMemberCredit[] = [];
  for (const raw of data.members) {
    if (!isRecord(raw)) continue;
    const userId = str(raw.userId);
    if (!userId) continue;
    members.push({
      userId,
      role: str(raw.role) || "member",
      displayName: str(raw.displayName),
      slug: strOrNull(raw.slug),
      avatarUrl: strOrNull(raw.avatarUrl),
      sharePct: num(raw.sharePct),
    });
  }

  const products: TeamGroupProduct[] = [];
  for (const raw of data.products) {
    if (!isRecord(raw)) continue;
    const id = str(raw.id);
    const title = str(raw.title);
    const priceCents = num(raw.priceCents);
    if (!id || !title || priceCents === null) continue;
    products.push({
      id,
      kind: str(raw.kind) || "download",
      title,
      description: typeof raw.description === "string" ? raw.description : "",
      priceCents,
      compareAtCents: num(raw.compareAtCents),
      inventory: num(raw.inventory) ?? -1,
      mediaUrls: Array.isArray(raw.mediaUrls)
        ? raw.mediaUrls.filter((u): u is string => typeof u === "string")
        : [],
    });
  }

  /* GroupProfileOwnDto's product type carries the group's split
     stamp too; the desk's rows keep the fields the desk renders and
     the stamp rides the save rail, not the row shape. The cast is
     confined to this seam. */
  return { group, members, products } as unknown as GroupProfileOwnDto;
}

/* ─── vault parsers (the vault list's own snake_case rows) ──────── */

/** Shape GET /api/artist-vaults into the member's OWN vault rows
 *  for the share toggle. The rail's list mixes the caller's own
 *  vaults with teammates' vaults shared with their team; only rows
 *  whose user_id IS the caller survive — the share rail is
 *  owner-only, so a toggle on anyone else's row could only fail.
 *  With no current user id, no row can be proven own and the list
 *  is empty (the characters.ts isOwn rule). Rows may arrive
 *  snake_case (the DB's own names) or camelCase; a broken envelope
 *  is a failed read (null), never a painted-over empty list. */
export function parseOwnVaults(
  data: unknown,
  currentUserId: string | null | undefined,
): TeamVaultRow[] | null {
  if (!isRecord(data) || !Array.isArray(data.vaults)) return null;
  const me = typeof currentUserId === "string" ? currentUserId : "";
  const out: TeamVaultRow[] = [];
  for (const raw of data.vaults) {
    if (!isRecord(raw)) continue;
    const id = str(raw.id);
    if (!id) continue;
    const ownerRaw = raw["user_id"] ?? raw["userId"];
    const ownerId = typeof ownerRaw === "string" ? ownerRaw : "";
    if (!me || ownerId !== me) continue;
    const nameRaw = raw["artist_name"] ?? raw["artistName"];
    const name =
      typeof nameRaw === "string" && nameRaw.trim()
        ? nameRaw.trim().slice(0, 80)
        : "Untitled character";
    const teamRaw = raw["team_id"] ?? raw["teamId"];
    const teamId = typeof teamRaw === "string" && teamRaw.length > 0 ? teamRaw : null;
    out.push({ id, name, teamId, shared: teamId !== null });
  }
  return out;
}

/** The share rail's answer, strictly: { ok: true, teamId } with
 *  teamId the new state (a team id string, or null). Anything else
 *  is a failed read — the desk keeps the row's prior state and
 *  surfaces the failure instead of guessing. */
export function parseVaultShareResult(data: unknown): VaultShareResult | null {
  if (!isRecord(data)) return null;
  if (data.ok !== true) return null;
  if (data.teamId !== null && typeof data.teamId !== "string") return null;
  return { teamId: data.teamId as string | null };
}
