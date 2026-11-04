/* ─── Team Seats desk seam (stack1500 world parity, wave 4a follow-on) ──
   Team Seats — the Settings surface the wave-4a Team desk named as
   its adjacent gap: account-level collaborator seats, a different
   feature from the Team Workspace pool family (/api/teams). The 2D
   home is pages/settings.tsx mounting components/TeamSeats.tsx on
   the seats router's own rails (routes/team-seats.ts):

     GET    /api/team-seats          → { seats (mine, every status),
                                         memberOf (active seats I
                                         hold on other accounts),
                                         roles, myRole: "owner" }
     POST   /api/team-seats/invite   → owner invites by email { email,
                                         displayName, role } → 201
                                         { seat, inviteLink,
                                         emailSent, emailNote }; 409
                                         when the email is already
                                         seated, 400 for a self-invite
     POST   /api/team-seats/accept   → { token } — the invitee, signed
                                         in as the invited email,
                                         activates the seat; answers
                                         alreadyActive when it was
                                         already live
     PATCH  /api/team-seats/:id      → { role } (owner only)
     DELETE /api/team-seats/:id      → revoke / cancel invite (owner
                                         only)

   Seats activate by LINK: the rail mints a token link to
   /settings?teamInvite=<token> and emails it when an email provider
   is configured (best-effort, fail-open) — the link is always
   returned so the owner can share it manually. In the palace the
   desk shows that same link for copying and accepts a pasted link
   (or bare token) in-desk, so the whole loop closes without a walk
   out of the World.

   PRICE: FREE — the 2D component's own header says "Price: FREE",
   the surface carries a "Free" badge, and lib/credit-costs.ts has
   NO /api/team-seats row (pinned by test). No money rail exists on
   this surface, so the desk invents none and never reaches for the
   confirmed-spend seam.

   PERMISSIONS: the matrix below mirrors the schema's
   permissionsForRole (lib/db/src/schema/team-seats.ts) and the 2D
   table cell for cell. The rail ALSO returns each seat's own
   permissions object; the desk renders the rail's copy when it
   arrives and falls back to this mirror only when the field is
   absent.

   REVOKED SEATS: the owned list carries every status, revoked
   included. The desk renders a revoked seat's true status and
   offers no role change / re-revoke on it (the 2D page paints a
   non-invited seat "Active", revoked included — the desk does not
   repeat that; the rail's status field is the truth).

   MEMBEROF: the 2D component ignores the list's memberOf half. The
   desk renders it read-only — seats the member holds on other
   people's accounts — because the rail returns it and it is the
   member's own truth; the account owner manages those seats, so no
   actions are offered on them here. */

export const TEAM_SEATS_PATH = "/api/team-seats";
export const TEAM_SEATS_INVITE_PATH = "/api/team-seats/invite";
export const TEAM_SEATS_ACCEPT_PATH = "/api/team-seats/accept";

export function teamSeatPath(id: string): string {
  return `/api/team-seats/${encodeURIComponent(id)}`;
}

/* ─── Roles + permissions ────────────────────────────────────────── */

export const TEAM_SEAT_ROLE_ORDER = ["owner", "manager", "collaborator", "viewer"] as const;
export type TeamSeatRole = (typeof TEAM_SEAT_ROLE_ORDER)[number];

/** Roles an invite / role change may carry (the rail's zod enums). */
export const TEAM_SEAT_ASSIGNABLE_ROLES = ["manager", "collaborator", "viewer"] as const;
export type TeamSeatAssignableRole = (typeof TEAM_SEAT_ASSIGNABLE_ROLES)[number];

export const TEAM_SEAT_STATUSES = ["invited", "active", "revoked"] as const;
export type TeamSeatStatus = (typeof TEAM_SEAT_STATUSES)[number];

export interface TeamSeatPermissions {
  canGenerate: boolean;
  canPublish: boolean;
  canViewMoney: boolean;
  canEditProfile: boolean;
  canManageTeam: boolean;
}

/** Mirror of the schema's TEAM_SEAT_PERMISSIONS — owner all-true,
 *  manager all but canManageTeam, collaborator generate-only,
 *  viewer none. */
export const TEAM_SEAT_PERMISSIONS: Record<TeamSeatRole, TeamSeatPermissions> = {
  owner: { canGenerate: true, canPublish: true, canViewMoney: true, canEditProfile: true, canManageTeam: true },
  manager: { canGenerate: true, canPublish: true, canViewMoney: true, canEditProfile: true, canManageTeam: false },
  collaborator: { canGenerate: true, canPublish: false, canViewMoney: false, canEditProfile: false, canManageTeam: false },
  viewer: { canGenerate: false, canPublish: false, canViewMoney: false, canEditProfile: false, canManageTeam: false },
};

/** The matrix rows, labels verbatim from the 2D table
 *  (settings.teamPerm* in locales/en.json). */
export const TEAM_SEAT_PERMISSION_ROWS: { key: keyof TeamSeatPermissions; label: string }[] = [
  { key: "canGenerate", label: "Generate & spend Visual Bucs" },
  { key: "canPublish", label: "Publish releases" },
  { key: "canViewMoney", label: "View Money Tracker" },
  { key: "canEditProfile", label: "Edit artist profile" },
  { key: "canManageTeam", label: "Manage team seats" },
];

export const TEAM_SEAT_ROLE_LABELS: Record<TeamSeatRole, string> = {
  owner: "Owner",
  manager: "Manager",
  collaborator: "Collaborator",
  viewer: "Viewer",
};

export function isTeamSeatRole(v: unknown): v is TeamSeatRole {
  return v === "owner" || v === "manager" || v === "collaborator" || v === "viewer";
}

export function isTeamSeatAssignableRole(v: unknown): v is TeamSeatAssignableRole {
  return v === "manager" || v === "collaborator" || v === "viewer";
}

/* ─── Verbatim strings ───────────────────────────────────────────────
   The 2D surface's own words (locales/en.json settings.team*) and
   the rail's own words (routes/team-seats.ts), so the desk and the
   page never drift apart. Pinned against both sources by test. */

export const TEAM_SEATS_TITLE = "Team Seats";
export const TEAM_SEATS_SUBTITLE = "Roles for collaborators & managers";
export const TEAM_SEATS_FREE_BADGE = "Free";
export const TEAM_SEATS_MATRIX_HEADING = "What each role can do";
export const TEAM_SEATS_LOADING = "Loading your team…";
export const TEAM_SEATS_LOAD_ERROR =
  "Couldn't load your team — check your connection and try again.";
export const TEAM_SEATS_EMPTY =
  "No team members yet — invite your manager or collaborators above.";
export const TEAM_SEATS_INVITE_HEADING = "Invite a team member";
export const TEAM_SEATS_EMAIL_PLACEHOLDER = "Teammate's email";
export const TEAM_SEATS_NAME_PLACEHOLDER = "Name (optional)";
export const TEAM_SEATS_ROLE_LABEL = "Role";
export const TEAM_SEATS_INVITE_BUTTON = "Create invite";
export const TEAM_SEATS_STATUS_INVITED = "Invite pending";
export const TEAM_SEATS_STATUS_ACTIVE = "Active";
/** The 2D surface has no revoked label (see header); this is the
 *  rail's own status word, title-cased. */
export const TEAM_SEATS_STATUS_REVOKED = "Revoked";
export const TEAM_SEATS_CANCEL = "Cancel invite";
export const TEAM_SEATS_REVOKE = "Revoke";
export const TEAM_SEATS_COPY_LINK = "Copy link";
export const TEAM_SEATS_COPIED = "Copied!";
export const TEAM_SEATS_COPY_FAILED = "Couldn't copy — select the link manually.";
export const TEAM_SEATS_NO_EMAIL_NOTE =
  "Email isn't set up yet, so no email was sent. Copy this link and share it with them manually.";
export const TEAM_SEATS_AUTH_GAP_NOTE =
  "Team seats activate when the invited person signs in with the invited email and accepts the link. The app can't yet create a sign-in for someone from an invite — they must already have a way to log in (email or Google sign-in), so matching happens by email address.";
export const TEAM_SEATS_ACCEPTED_TITLE = "Invite accepted";
export const TEAM_SEATS_ACCEPTED_DESC = "You're on the team — your role is live now.";
export const TEAM_SEATS_ACCEPTED_ALREADY = "You're already an active member of this team.";

/* ─── Shapes ─────────────────────────────────────────────────────── */

export interface TeamSeat {
  id: string;
  email: string;
  displayName: string;
  role: TeamSeatRole;
  status: TeamSeatStatus;
  invitedAt: string;
  joinedAt: string | null;
  permissions: TeamSeatPermissions;
  isAccountOwner: boolean;
}

export interface TeamSeatsList {
  seats: TeamSeat[];
  memberOf: TeamSeat[];
}

export interface TeamSeatInviteResult {
  seat: TeamSeat;
  inviteLink: string;
  emailSent: boolean;
  emailNote: string;
}

export interface TeamSeatAcceptResult {
  alreadyActive: boolean;
  seat: TeamSeat | null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function parsePermissions(v: unknown, role: TeamSeatRole): TeamSeatPermissions | null {
  if (v === undefined || v === null) return TEAM_SEAT_PERMISSIONS[role];
  const rec = asRecord(v);
  if (!rec) return null;
  const keys: (keyof TeamSeatPermissions)[] = [
    "canGenerate",
    "canPublish",
    "canViewMoney",
    "canEditProfile",
    "canManageTeam",
  ];
  for (const k of keys) {
    if (typeof rec[k] !== "boolean") return null;
  }
  return {
    canGenerate: rec.canGenerate as boolean,
    canPublish: rec.canPublish as boolean,
    canViewMoney: rec.canViewMoney as boolean,
    canEditProfile: rec.canEditProfile as boolean,
    canManageTeam: rec.canManageTeam as boolean,
  };
}

/** One seat DTO off the rail. Broken or incomplete → null (a failed
 *  read), never a painted-over seat. */
export function parseTeamSeat(v: unknown): TeamSeat | null {
  const rec = asRecord(v);
  if (!rec) return null;
  const id = asString(rec.id);
  const email = asString(rec.email);
  if (!id || !email) return null;
  if (!isTeamSeatRole(rec.role)) return null;
  if (rec.status !== "invited" && rec.status !== "active" && rec.status !== "revoked") {
    return null;
  }
  const permissions = parsePermissions(rec.permissions, rec.role);
  if (!permissions) return null;
  return {
    id,
    email,
    displayName: typeof rec.displayName === "string" ? rec.displayName : "",
    role: rec.role,
    status: rec.status,
    invitedAt: typeof rec.invitedAt === "string" ? rec.invitedAt : "",
    joinedAt: typeof rec.joinedAt === "string" ? rec.joinedAt : null,
    permissions,
    isAccountOwner: rec.isAccountOwner === true,
  };
}

function parseSeatArray(v: unknown): TeamSeat[] | null {
  if (!Array.isArray(v)) return null;
  const out: TeamSeat[] = [];
  for (const item of v) {
    const seat = parseTeamSeat(item);
    if (!seat) return null;
    out.push(seat);
  }
  return out;
}

/** GET /api/team-seats → the desk's whole read model. */
export function parseTeamSeatsList(data: unknown): TeamSeatsList | null {
  const rec = asRecord(data);
  if (!rec) return null;
  const seats = parseSeatArray(rec.seats);
  if (!seats) return null;
  const memberOf =
    rec.memberOf === undefined ? [] : parseSeatArray(rec.memberOf);
  if (!memberOf) return null;
  return { seats, memberOf };
}

/** POST /api/team-seats/invite → seat + the shareable link + the
 *  rail's own email verdict. */
export function parseTeamSeatInviteResult(data: unknown): TeamSeatInviteResult | null {
  const rec = asRecord(data);
  if (!rec) return null;
  const seat = parseTeamSeat(rec.seat);
  const inviteLink = asString(rec.inviteLink);
  if (!seat || !inviteLink) return null;
  return {
    seat,
    inviteLink,
    emailSent: rec.emailSent === true,
    emailNote: typeof rec.emailNote === "string" ? rec.emailNote : "",
  };
}

/** PATCH /api/team-seats/:id → { seat }. */
export function parseTeamSeatResult(data: unknown): TeamSeat | null {
  const rec = asRecord(data);
  if (!rec) return null;
  return parseTeamSeat(rec.seat);
}

/** POST /api/team-seats/accept → { accepted, alreadyActive?, seat? }.
 *  Anything but an explicit accepted:true is not an acceptance. */
export function parseTeamSeatAcceptResult(data: unknown): TeamSeatAcceptResult | null {
  const rec = asRecord(data);
  if (!rec || rec.accepted !== true) return null;
  return {
    alreadyActive: rec.alreadyActive === true,
    seat: rec.seat === undefined ? null : parseTeamSeat(rec.seat),
  };
}

/* ─── Payload builders + gates (the rail's zod, mirrored) ────────── */

const TEAM_SEAT_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The invite form's gate: the rail trims, validates as an email,
 *  and caps at 254 chars; the name caps at 80. */
export function teamSeatInviteReady(email: string, role: unknown): boolean {
  const trimmed = email.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= 254 &&
    TEAM_SEAT_EMAIL_RE.test(trimmed) &&
    isTeamSeatAssignableRole(role)
  );
}

export function buildTeamSeatInviteBody(
  email: string,
  displayName: string,
  role: TeamSeatAssignableRole,
): { email: string; displayName: string; role: TeamSeatAssignableRole } {
  return {
    email: email.trim(),
    displayName: displayName.trim().slice(0, 80),
    role,
  };
}

export function buildTeamSeatRoleBody(
  role: TeamSeatAssignableRole,
): { role: TeamSeatAssignableRole } {
  return { role };
}

export function buildTeamSeatAcceptBody(token: string): { token: string } {
  return { token: token.trim() };
}

/** An invite link carries its token as ?teamInvite=<64 hex>; the
 *  desk accepts the full link pasted as-is or the bare token. */
export function extractTeamSeatInviteToken(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  const fromQuery = /[?&]teamInvite=([0-9a-fA-F]{64})/.exec(trimmed);
  if (fromQuery) return fromQuery[1];
  return /^[0-9a-fA-F]{64}$/.test(trimmed) ? trimmed : "";
}

/* ─── Row rules (the rail enforces these owner-side; the desk
       offers only the taps that can land) ────────────────────────── */

/* ─── display strings (i18n seam, stack100 locale unit 46) ────────
   The label functions below take optional strings bundles whose
   defaults are the original English constants above, byte-identical;
   the desk builds the bundles from the catalog keys (the settings
   namespace carries the 2D surface's own words; the revoked label —
   which the 2D surface never had — lives in worldTeamLegal). */

export interface TeamSeatStatusStrings {
  invited: string;
  active: string;
  revoked: string;
}

export const TEAM_SEAT_STATUS_STRINGS_EN: TeamSeatStatusStrings = {
  invited: TEAM_SEATS_STATUS_INVITED,
  active: TEAM_SEATS_STATUS_ACTIVE,
  revoked: TEAM_SEATS_STATUS_REVOKED,
};

/** Build the bundle from a translate function (the desk's `t`). */
export function teamSeatStatusStrings(translate: (key: string) => string): TeamSeatStatusStrings {
  return {
    invited: translate("settings.teamStatusInvited"),
    active: translate("settings.teamStatusActive"),
    revoked: translate("worldTeamLegal.seatsStatusRevoked"),
  };
}

export function teamSeatStatusLabel(
  status: TeamSeatStatus,
  strings: TeamSeatStatusStrings = TEAM_SEAT_STATUS_STRINGS_EN,
): string {
  if (status === "invited") return strings.invited;
  if (status === "active") return strings.active;
  return strings.revoked;
}

export interface TeamSeatRevokeStrings {
  cancel: string;
  revoke: string;
}

export const TEAM_SEAT_REVOKE_STRINGS_EN: TeamSeatRevokeStrings = {
  cancel: TEAM_SEATS_CANCEL,
  revoke: TEAM_SEATS_REVOKE,
};

/** Build the bundle from a translate function (the desk's `t`). */
export function teamSeatRevokeStrings(translate: (key: string) => string): TeamSeatRevokeStrings {
  return {
    cancel: translate("settings.teamCancel"),
    revoke: translate("settings.teamRevoke"),
  };
}

/** Role change: owner-managed seats only, and a revoked seat is
 *  terminal — the rail would still answer a PATCH, but there is no
 *  live seat to re-role. */
export function canChangeTeamSeatRole(seat: TeamSeat): boolean {
  return seat.isAccountOwner && seat.status !== "revoked";
}

/** Revoke / cancel: owner-managed seats only; revoking twice is
 *  not an action. */
export function canRevokeTeamSeat(seat: TeamSeat): boolean {
  return seat.isAccountOwner && seat.status !== "revoked";
}

export function teamSeatRevokeLabel(
  seat: TeamSeat,
  strings: TeamSeatRevokeStrings = TEAM_SEAT_REVOKE_STRINGS_EN,
): string {
  return seat.status === "invited" ? strings.cancel : strings.revoke;
}
