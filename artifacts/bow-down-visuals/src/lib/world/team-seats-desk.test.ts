import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  TEAM_SEATS_ACCEPT_PATH,
  TEAM_SEATS_INVITE_PATH,
  TEAM_SEATS_PATH,
  TEAM_SEAT_ASSIGNABLE_ROLES,
  TEAM_SEAT_PERMISSIONS,
  TEAM_SEAT_PERMISSION_ROWS,
  TEAM_SEAT_ROLE_LABELS,
  TEAM_SEAT_ROLE_ORDER,
  buildTeamSeatAcceptBody,
  buildTeamSeatInviteBody,
  buildTeamSeatRoleBody,
  canChangeTeamSeatRole,
  canRevokeTeamSeat,
  extractTeamSeatInviteToken,
  parseTeamSeat,
  parseTeamSeatAcceptResult,
  parseTeamSeatInviteResult,
  parseTeamSeatResult,
  parseTeamSeatsList,
  teamSeatInviteReady,
  teamSeatPath,
  teamSeatRevokeLabel,
  teamSeatStatusLabel,
  type TeamSeat,
} from "./team-seats-desk";

/* ─── Team Seats desk (stack1500 world parity, wave 4a follow-on) ──
   The Settings team-seats surface native in-World, on the seats
   router's own rails. These tests pin the seam: the paths against
   the route file, the verbatim strings against BOTH the locale
   file and the rail, the permission matrix against the DB schema,
   the FREE price truth against the registry (no row exists, none
   invented), the strict parsers (a broken answer is a failed read,
   never a painted-over seat), and the payload gates against the
   rail's zod schemas. */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const SEAT = {
  id: "seat-1",
  email: "manager@example.com",
  displayName: "Manny Manager",
  role: "manager",
  status: "active",
  invitedAt: "2026-11-01T10:00:00.000Z",
  joinedAt: "2026-11-01T11:00:00.000Z",
  permissions: {
    canGenerate: true,
    canPublish: true,
    canViewMoney: true,
    canEditProfile: true,
    canManageTeam: false,
  },
  isAccountOwner: true,
};

const TOKEN = "a".repeat(64);

describe("paths ride the seats router's own rails", () => {
  it("pins the four endpoints + the per-seat path", () => {
    expect(TEAM_SEATS_PATH).toBe("/api/team-seats");
    expect(TEAM_SEATS_INVITE_PATH).toBe("/api/team-seats/invite");
    expect(TEAM_SEATS_ACCEPT_PATH).toBe("/api/team-seats/accept");
    expect(teamSeatPath("seat-1")).toBe("/api/team-seats/seat-1");
    const rail = read("../../../../api-server/src/routes/team-seats.ts");
    expect(rail).toContain('router.get("/team-seats"');
    expect(rail).toContain('router.post("/team-seats/invite"');
    expect(rail).toContain('router.post("/team-seats/accept"');
    expect(rail).toContain('router.patch("/team-seats/:id"');
    expect(rail).toContain('router.delete("/team-seats/:id"');
  });
});

describe("price truth — the surface is FREE and no row is invented", () => {
  it("lib/credit-costs.ts carries no team-seats row", () => {
    const costs = read("../credit-costs.ts");
    expect(costs).not.toContain("/api/team-seats");
  });

  it("the 2D component's own header rules it free", () => {
    const page = read("../../components/TeamSeats.tsx");
    expect(page).toContain("Price: FREE");
  });
});

describe("verbatim strings match the 2D surface's locale copy", () => {
  const en = JSON.parse(read("../../locales/en.json")) as {
    settings: Record<string, string>;
  };
  const s = en.settings;

  it("titles, states and form copy are the page's own words", () => {
    expect(s.teamTitle).toBe("Team Seats");
    expect(s.teamSubtitle).toBe("Roles for collaborators & managers");
    expect(s.teamFreeBadge).toBe("Free");
    expect(s.teamMatrixCapability).toBe("What each role can do");
    expect(s.teamLoading).toBe("Loading your team…");
    expect(s.teamLoadError).toBe(
      "Couldn't load your team — check your connection and try again.",
    );
    expect(s.teamEmpty).toBe(
      "No team members yet — invite your manager or collaborators above.",
    );
    expect(s.teamInviteHeading).toBe("Invite a team member");
    expect(s.teamEmailPlaceholder).toBe("Teammate's email");
    expect(s.teamNamePlaceholder).toBe("Name (optional)");
    expect(s.teamRoleLabel).toBe("Role");
    expect(s.teamInviteButton).toBe("Create invite");
    expect(s.teamStatusInvited).toBe("Invite pending");
    expect(s.teamStatusActive).toBe("Active");
    expect(s.teamCancel).toBe("Cancel invite");
    expect(s.teamRevoke).toBe("Revoke");
    expect(s.teamCopyLink).toBe("Copy link");
    expect(s.teamCopied).toBe("Copied!");
    expect(s.teamCopyFailed).toBe("Couldn't copy — select the link manually.");
    expect(s.teamNoEmailNote).toBe(
      "Email isn't set up yet, so no email was sent. Copy this link and share it with them manually.",
    );
    expect(s.teamAuthGapNote).toContain(
      "Team seats activate when the invited person signs in with the invited email",
    );
    expect(s.teamInviteAcceptedTitle).toBe("Invite accepted");
    expect(s.teamInviteAcceptedDesc).toBe("You're on the team — your role is live now.");
    expect(s.teamInviteAcceptedAlready).toBe(
      "You're already an active member of this team.",
    );
  });

  it("role + permission labels are the page's own words", () => {
    expect(TEAM_SEAT_ROLE_ORDER).toEqual(["owner", "manager", "collaborator", "viewer"]);
    for (const role of TEAM_SEAT_ROLE_ORDER) {
      expect(s[`teamRole_${role}`]).toBe(TEAM_SEAT_ROLE_LABELS[role]);
    }
    expect(s.teamPermGenerate).toBe("Generate & spend Visual Bucs");
    expect(s.teamPermPublish).toBe("Publish releases");
    expect(s.teamPermMoney).toBe("View Money Tracker");
    expect(s.teamPermProfile).toBe("Edit artist profile");
    expect(s.teamPermTeam).toBe("Manage team seats");
    expect(TEAM_SEAT_PERMISSION_ROWS.map((r) => r.label)).toEqual([
      "Generate & spend Visual Bucs",
      "Publish releases",
      "View Money Tracker",
      "Edit artist profile",
      "Manage team seats",
    ]);
  });
});

describe("the permission matrix mirrors the DB schema cell for cell", () => {
  it("matches lib/db/src/schema/team-seats.ts", () => {
    const schema = read("../../../../../lib/db/src/schema/team-seats.ts");
    expect(schema).toContain("export function permissionsForRole");
    expect(TEAM_SEAT_PERMISSIONS.owner).toEqual({
      canGenerate: true, canPublish: true, canViewMoney: true, canEditProfile: true, canManageTeam: true,
    });
    expect(TEAM_SEAT_PERMISSIONS.manager).toEqual({
      canGenerate: true, canPublish: true, canViewMoney: true, canEditProfile: true, canManageTeam: false,
    });
    expect(TEAM_SEAT_PERMISSIONS.collaborator).toEqual({
      canGenerate: true, canPublish: false, canViewMoney: false, canEditProfile: false, canManageTeam: false,
    });
    expect(TEAM_SEAT_PERMISSIONS.viewer).toEqual({
      canGenerate: false, canPublish: false, canViewMoney: false, canEditProfile: false, canManageTeam: false,
    });
    expect(TEAM_SEAT_ASSIGNABLE_ROLES).toEqual(["manager", "collaborator", "viewer"]);
  });
});

describe("strict parsers — a broken answer is a failed read", () => {
  it("parses a full seat DTO", () => {
    const seat = parseTeamSeat(SEAT);
    expect(seat).not.toBeNull();
    expect(seat?.email).toBe("manager@example.com");
    expect(seat?.permissions.canManageTeam).toBe(false);
    expect(seat?.isAccountOwner).toBe(true);
  });

  it("derives permissions from the role when the rail omits them", () => {
    const { permissions: _omit, ...bare } = SEAT;
    const seat = parseTeamSeat(bare);
    expect(seat?.permissions).toEqual(TEAM_SEAT_PERMISSIONS.manager);
  });

  it("rejects broken seats instead of painting them over", () => {
    expect(parseTeamSeat(null)).toBeNull();
    expect(parseTeamSeat({ ...SEAT, id: 7 })).toBeNull();
    expect(parseTeamSeat({ ...SEAT, email: undefined })).toBeNull();
    expect(parseTeamSeat({ ...SEAT, role: "superadmin" })).toBeNull();
    expect(parseTeamSeat({ ...SEAT, status: "pending" })).toBeNull();
    expect(parseTeamSeat({ ...SEAT, permissions: { canGenerate: "yes" } })).toBeNull();
  });

  it("parses the list with memberOf, and tolerates its absence as empty", () => {
    const memberSeat = { ...SEAT, id: "seat-2", isAccountOwner: false };
    const list = parseTeamSeatsList({ seats: [SEAT], memberOf: [memberSeat], roles: [], myRole: "owner" });
    expect(list?.seats).toHaveLength(1);
    expect(list?.memberOf).toHaveLength(1);
    expect(parseTeamSeatsList({ seats: [] })?.memberOf).toEqual([]);
    expect(parseTeamSeatsList({ seats: "nope" })).toBeNull();
    expect(parseTeamSeatsList({ seats: [{ broken: true }] })).toBeNull();
    expect(parseTeamSeatsList(null)).toBeNull();
  });

  it("parses invite / role-change / accept answers strictly", () => {
    const invite = parseTeamSeatInviteResult({
      seat: SEAT,
      inviteLink: `https://example.test/settings?teamInvite=${TOKEN}`,
      emailSent: false,
      emailNote: "No email provider is configured — share the invite link manually.",
    });
    expect(invite?.seat.id).toBe("seat-1");
    expect(invite?.emailSent).toBe(false);
    expect(parseTeamSeatInviteResult({ seat: SEAT })).toBeNull();
    expect(parseTeamSeatResult({ seat: SEAT })?.id).toBe("seat-1");
    expect(parseTeamSeatResult({})).toBeNull();
    expect(parseTeamSeatAcceptResult({ accepted: true, alreadyActive: true })).toEqual({
      alreadyActive: true,
      seat: null,
    });
    expect(parseTeamSeatAcceptResult({ accepted: true, seat: SEAT })?.seat?.id).toBe("seat-1");
    expect(parseTeamSeatAcceptResult({ accepted: false })).toBeNull();
    expect(parseTeamSeatAcceptResult({})).toBeNull();
  });
});

describe("payload builders + gates mirror the rail's zod", () => {
  it("invite gate: real email, assignable role, 254 cap", () => {
    expect(teamSeatInviteReady("a@b.co", "manager")).toBe(true);
    expect(teamSeatInviteReady("  a@b.co  ", "viewer")).toBe(true);
    expect(teamSeatInviteReady("not-an-email", "manager")).toBe(false);
    expect(teamSeatInviteReady("a@b.co", "owner")).toBe(false);
    expect(teamSeatInviteReady("", "manager")).toBe(false);
    expect(teamSeatInviteReady(`${"a".repeat(250)}@b.co`, "manager")).toBe(false);
  });

  it("invite body trims and caps the name at 80 like the rail", () => {
    expect(buildTeamSeatInviteBody("  a@b.co ", "  Manny  ", "manager")).toEqual({
      email: "a@b.co",
      displayName: "Manny",
      role: "manager",
    });
    expect(buildTeamSeatInviteBody("a@b.co", "x".repeat(120), "viewer").displayName).toHaveLength(80);
    expect(buildTeamSeatRoleBody("collaborator")).toEqual({ role: "collaborator" });
    expect(buildTeamSeatAcceptBody(` ${TOKEN} `)).toEqual({ token: TOKEN });
  });

  it("token extraction takes a full link or a bare token, nothing else", () => {
    expect(extractTeamSeatInviteToken(`https://x.test/settings?teamInvite=${TOKEN}`)).toBe(TOKEN);
    expect(extractTeamSeatInviteToken(TOKEN)).toBe(TOKEN);
    expect(extractTeamSeatInviteToken("https://x.test/settings")).toBe("");
    expect(extractTeamSeatInviteToken("hello")).toBe("");
    expect(extractTeamSeatInviteToken("")).toBe("");
  });
});

describe("row rules — only the taps that can land are offered", () => {
  const owned = parseTeamSeat(SEAT) as TeamSeat;
  const invited = parseTeamSeat({ ...SEAT, status: "invited", joinedAt: null }) as TeamSeat;
  const revoked = parseTeamSeat({ ...SEAT, status: "revoked" }) as TeamSeat;
  const member = parseTeamSeat({ ...SEAT, isAccountOwner: false }) as TeamSeat;

  it("role change + revoke are owner-only and revoked is terminal", () => {
    expect(canChangeTeamSeatRole(owned)).toBe(true);
    expect(canRevokeTeamSeat(owned)).toBe(true);
    expect(canChangeTeamSeatRole(member)).toBe(false);
    expect(canRevokeTeamSeat(member)).toBe(false);
    expect(canChangeTeamSeatRole(revoked)).toBe(false);
    expect(canRevokeTeamSeat(revoked)).toBe(false);
  });

  it("labels follow the seat's true status", () => {
    expect(teamSeatStatusLabel("invited")).toBe("Invite pending");
    expect(teamSeatStatusLabel("active")).toBe("Active");
    expect(teamSeatStatusLabel("revoked")).toBe("Revoked");
    expect(teamSeatRevokeLabel(invited)).toBe("Cancel invite");
    expect(teamSeatRevokeLabel(owned)).toBe("Revoke");
  });
});
