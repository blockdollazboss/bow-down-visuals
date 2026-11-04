import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  TEAMS_PATH,
  TEAM_FALLBACK_OFF_HINT,
  TEAM_FALLBACK_ON_HINT,
  TEAM_INVITE_ROLES,
  TEAM_NAME_MAX,
  TEAM_ROLES,
  TEAM_SHARED_VAULTS_NOTE,
  TEAM_TIER_GATE_MESSAGE,
  activeTeamFromList,
  buildCreateTeamPayload,
  buildFallbackPayload,
  buildFundPayload,
  buildGroupProductPayload,
  buildInvitePayload,
  buildRenamePayload,
  buildRolePayload,
  canChangeRoles,
  canRemoveMember,
  fundAmountFromInput,
  groupPublicPath,
  inviteEmailValid,
  isTeamAdmin,
  isTeamOwner,
  isTierGateError,
  parseFundResult,
  parseGroupOwn,
  parseMemberRow,
  parseSpending,
  parseTeamDetail,
  parseTeamList,
  parseTeamRow,
  roleRank,
  teamAcceptPath,
  teamDeclinePath,
  teamDetailPath,
  teamFundPath,
  teamGroupProductsPath,
  teamGroupProfilePath,
  teamInvitePath,
  teamLeavePath,
  teamMemberPath,
  teamNameReady,
  teamSpendingPath,
  type TeamRow,
} from "./team-desk";
import { getCreditCost } from "../credit-costs";

/* ─── Team desk seam (stack1500 world parity, wave #4a item 19) ────
   The My Studio board's Team desk rides the 2D /team page's own
   rails. These tests pin the seam: the paths are the routes' own
   endpoints (read from the route files, never re-typed from
   memory), NO team rail carries a registry price (the fund amount
   is the member's own, carried by the confirmed rail's override —
   not a price), the builders carry the page's field names and
   gates, the role rules are the page's + the rail's, the verbatim
   strings match the page's i18n, and every parser maps its rail's
   answer field-for-field — with a broken or incomplete answer
   reading as a failed read (null), never painted-over content. */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const teamRow = (over: Partial<TeamRow> = {}): TeamRow => ({
  id: "team-1",
  name: "Blockdollaz Media",
  logoUrl: null,
  ownerId: "user-owner",
  credits: 250,
  allowPersonalFallback: true,
  myRole: "owner",
  myStatus: "active",
  ...over,
});

describe("rails + prices", () => {
  it("the paths are the team routes' own endpoints", () => {
    expect(TEAMS_PATH).toBe("/api/teams");
    expect(teamDetailPath("t1")).toBe("/api/teams/t1");
    expect(teamInvitePath("t1")).toBe("/api/teams/t1/invite");
    expect(teamAcceptPath("t1")).toBe("/api/teams/t1/accept");
    expect(teamDeclinePath("t1")).toBe("/api/teams/t1/decline");
    expect(teamMemberPath("t1", "m1")).toBe("/api/teams/t1/members/m1");
    expect(teamLeavePath("t1")).toBe("/api/teams/t1/leave");
    expect(teamFundPath("t1")).toBe("/api/teams/t1/fund");
    expect(teamSpendingPath("t1")).toBe("/api/teams/t1/spending");
    expect(teamGroupProfilePath("t1")).toBe("/api/teams/t1/group-profile");
    expect(teamGroupProductsPath("t1")).toBe("/api/teams/t1/group-profile/products");
    expect(groupPublicPath("crown-duo")).toBe("/api/group-profiles/crown-duo");

    const routes = read("../../../../api-server/src/routes/teams.ts");
    for (const p of [
      '"/teams"',
      '"/teams/:id"',
      '"/teams/:id/invite"',
      '"/teams/:id/accept"',
      '"/teams/:id/decline"',
      '"/teams/:id/members/:memberId"',
      '"/teams/:id/leave"',
      '"/teams/:id/fund"',
      '"/teams/:id/spending"',
    ]) {
      expect(routes, p).toContain(p);
    }
    const groupRoutes = read("../../../../api-server/src/routes/group-profiles.ts");
    for (const p of [
      '"/teams/:teamId/group-profile"',
      '"/teams/:teamId/group-profile/products"',
      '"/group-profiles/:slug"',
    ]) {
      expect(groupRoutes, p).toContain(p);
    }
    const page = read("../../pages/team.tsx");
    for (const p of ["/api/teams", "/spending", "/fund", "/invite", "/accept", "/decline", "/leave"]) {
      expect(page, p).toContain(p);
    }
  });

  it("no team rail carries a registry price — funding is the member's own amount, not a price", () => {
    for (const p of [
      TEAMS_PATH,
      teamDetailPath("t1"),
      teamFundPath("t1"),
      teamInvitePath("t1"),
      teamGroupProfilePath("t1"),
    ]) {
      expect(getCreditCost(p), p).toBeNull();
    }
  });

  it("the tier gate sentence is the route's own, verbatim", () => {
    const routes = read("../../../../api-server/src/routes/teams.ts");
    expect(routes).toContain(TEAM_TIER_GATE_MESSAGE);
    expect(isTierGateError(403, TEAM_TIER_GATE_MESSAGE)).toBe(true);
    expect(isTierGateError(403, "Not a member of this team.")).toBe(false);
    expect(isTierGateError(500, TEAM_TIER_GATE_MESSAGE)).toBe(false);
  });

  it("the shared-vaults note + fallback hints are the page's i18n, verbatim", () => {
    const en = JSON.parse(read("../../locales/en.json")) as {
      team: Record<string, string>;
    };
    expect(TEAM_SHARED_VAULTS_NOTE).toBe(en.team["sharedVaultsNote"]);
    expect(TEAM_FALLBACK_ON_HINT).toBe(en.team["fallbackOnHint"]);
    expect(TEAM_FALLBACK_OFF_HINT).toBe(en.team["fallbackOffHint"]);
  });
});

describe("role rules", () => {
  it("ranks owner above admin above member, unknown below all", () => {
    expect(roleRank("owner")).toBeGreaterThan(roleRank("admin"));
    expect(roleRank("admin")).toBeGreaterThan(roleRank("member"));
    expect(roleRank("nope")).toBe(-1);
    expect(roleRank(null)).toBe(-1);
    expect(TEAM_ROLES).toEqual(["owner", "admin", "member"]);
    expect(TEAM_INVITE_ROLES).toEqual(["admin", "member"]);
    expect(isTeamAdmin("owner")).toBe(true);
    expect(isTeamAdmin("admin")).toBe(true);
    expect(isTeamAdmin("member")).toBe(false);
    expect(isTeamOwner("owner")).toBe(true);
    expect(isTeamOwner("admin")).toBe(false);
  });

  it("role changes: owner only, active non-owner targets only", () => {
    expect(canChangeRoles("owner", { role: "member", status: "active" })).toBe(true);
    expect(canChangeRoles("owner", { role: "admin", status: "active" })).toBe(true);
    expect(canChangeRoles("owner", { role: "owner", status: "active" })).toBe(false);
    expect(canChangeRoles("owner", { role: "member", status: "invited" })).toBe(false);
    expect(canChangeRoles("admin", { role: "member", status: "active" })).toBe(false);
    expect(canChangeRoles("member", { role: "member", status: "active" })).toBe(false);
  });

  it("removals: owner removes anyone but the owner; an admin removes members only", () => {
    expect(canRemoveMember("owner", { role: "admin" })).toBe(true);
    expect(canRemoveMember("owner", { role: "member" })).toBe(true);
    expect(canRemoveMember("owner", { role: "owner" })).toBe(false);
    expect(canRemoveMember("admin", { role: "member" })).toBe(true);
    expect(canRemoveMember("admin", { role: "admin" })).toBe(false);
    expect(canRemoveMember("member", { role: "member" })).toBe(false);
    expect(canRemoveMember(null, { role: "member" })).toBe(false);
  });

  it("the active team is the active-status membership", () => {
    expect(activeTeamFromList([teamRow({ myStatus: "invited" })])).toBeNull();
    expect(
      activeTeamFromList([
        teamRow({ id: "a", myStatus: "invited" }),
        teamRow({ id: "b", myStatus: "active" }),
      ])?.id,
    ).toBe("b");
    expect(activeTeamFromList([])).toBeNull();
  });
});

describe("payload builders + gates", () => {
  it("team names trim and cap at the rail's 80", () => {
    expect(TEAM_NAME_MAX).toBe(80);
    expect(teamNameReady("  Crew  ")).toBe(true);
    expect(teamNameReady("   ")).toBe(false);
    expect(teamNameReady("x".repeat(81))).toBe(false);
    expect(buildCreateTeamPayload("  Crew  ")).toEqual({ name: "Crew" });
    expect(buildRenamePayload(" New Name ")).toEqual({ name: "New Name" });
    expect(buildFallbackPayload(false)).toEqual({ allowPersonalFallback: false });
  });

  it("invites carry the page's email gate + lowercasing + role clamp", () => {
    expect(inviteEmailValid("Teammate@Email.com")).toBe(true);
    expect(inviteEmailValid("not-an-email")).toBe(false);
    expect(inviteEmailValid("a@b")).toBe(false);
    expect(buildInvitePayload("  Teammate@Email.com ", "admin")).toEqual({
      email: "teammate@email.com",
      role: "admin",
    });
    expect(buildInvitePayload("a@b.co", "owner")).toEqual({ email: "a@b.co", role: "member" });
    expect(buildRolePayload("admin")).toEqual({ role: "admin" });
    expect(buildRolePayload("owner")).toEqual({ role: "member" });
  });

  it("fund amounts floor to whole Bucs and refuse zero / junk", () => {
    expect(fundAmountFromInput("250")).toBe(250);
    expect(fundAmountFromInput("250.9")).toBe(250);
    expect(fundAmountFromInput("0")).toBeNull();
    expect(fundAmountFromInput("-5")).toBeNull();
    expect(fundAmountFromInput("abc")).toBeNull();
    expect(fundAmountFromInput("")).toBeNull();
    expect(buildFundPayload(250, "key-1")).toEqual({ credits: 250, idempotencyKey: "key-1" });
  });

  it("group product payloads trim the title and carry kind + cents", () => {
    expect(buildGroupProductPayload({ kind: "merch", title: "  Tee  ", priceCents: 2500 })).toEqual({
      kind: "merch",
      title: "Tee",
      priceCents: 2500,
    });
  });
});

describe("parsers", () => {
  it("team rows map field-for-field; broken rows read as failed", () => {
    expect(parseTeamRow(teamRow())).toEqual(teamRow());
    expect(parseTeamRow({ ...teamRow(), logoUrl: "https://x/y.png" })?.logoUrl).toBe(
      "https://x/y.png",
    );
    expect(parseTeamRow({ ...teamRow(), allowPersonalFallback: undefined })?.allowPersonalFallback).toBe(true);
    expect(parseTeamRow({ name: "No id" })).toBeNull();
    expect(parseTeamRow({ ...teamRow(), credits: "lots" })).toBeNull();
    expect(parseTeamRow(null)).toBeNull();
    expect(parseTeamRow("team")).toBeNull();
  });

  it("member rows keep the invite-pending state honest", () => {
    const m = parseMemberRow({
      id: "m1",
      teamId: "t1",
      userId: null,
      email: "pal@email.com",
      role: "member",
      status: "invited",
      joinedAt: null,
    });
    expect(m?.status).toBe("invited");
    expect(m?.userId).toBeNull();
    expect(parseMemberRow({ id: "m1" })).toBeNull();
  });

  it("the list maps teams + invites with the joined team name", () => {
    const parsed = parseTeamList({
      teams: [teamRow()],
      invites: [
        {
          id: "i1",
          teamId: "t9",
          email: "me@email.com",
          role: "admin",
          status: "invited",
          team: { id: "t9", name: "Other Crew" },
        },
        { id: "broken" },
      ],
    });
    expect(parsed?.teams).toHaveLength(1);
    expect(parsed?.invites).toHaveLength(1);
    expect(parsed?.invites[0]?.team?.name).toBe("Other Crew");
    expect(parseTeamList({ teams: [] })).toBeNull();
    expect(parseTeamList(null)).toBeNull();
  });

  it("detail requires a real team + member list", () => {
    const d = parseTeamDetail({
      team: teamRow(),
      members: [
        { id: "m1", teamId: "team-1", userId: "u1", email: "a@b.co", role: "owner", status: "active", joinedAt: "2026-01-01" },
      ],
      myRole: "owner",
    });
    expect(d?.myRole).toBe("owner");
    expect(d?.members).toHaveLength(1);
    expect(parseTeamDetail({ team: null, members: [] })).toBeNull();
    expect(parseTeamDetail({ team: teamRow() })).toBeNull();
  });

  it("spending rows keep email-or-null + numeric totals", () => {
    const rows = parseSpending({
      spending: [
        { userId: "u1", email: "a@b.co", action: "song_generate", total: 400 },
        { userId: "u2", email: null, action: "image_generate", total: "100" },
        { userId: "", email: null, action: "x", total: 1 },
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows?.[1]?.total).toBe(100);
    expect(parseSpending({})).toBeNull();
    expect(parseSpending(null)).toBeNull();
  });

  it("fund results carry the updated team + the duplicate flag", () => {
    expect(parseFundResult({ team: teamRow({ credits: 500 }) })?.duplicate).toBe(false);
    expect(parseFundResult({ team: teamRow(), duplicate: true })?.duplicate).toBe(true);
    expect(parseFundResult({ duplicate: true })).toBeNull();
  });

  it("group own view: full, unset, and broken shapes", () => {
    const full = parseGroupOwn({
      group: {
        id: "g1",
        teamId: "t1",
        slug: "crown-duo",
        displayName: "Crown Duo",
        bio: "Two crowns.",
        avatarUrl: null,
        bannerUrl: null,
        splitTerms: [{ userId: "u1", sharePct: 60 }, { userId: "u2", sharePct: 40 }],
        isPublished: true,
        createdAt: "2026-01-01",
        updatedAt: "2026-01-02",
      },
      members: [
        { userId: "u1", role: "owner", displayName: "Boss", slug: null, avatarUrl: null, sharePct: 60 },
      ],
      products: [
        { id: "p1", kind: "download", title: "Beat Pack", description: "", priceCents: 500, compareAtCents: null, inventory: -1, mediaUrls: [] },
      ],
    });
    expect(full?.group?.slug).toBe("crown-duo");
    expect(full?.group?.splitTerms).toHaveLength(2);
    expect(full?.members[0]?.sharePct).toBe(60);
    expect(full?.products[0]?.priceCents).toBe(500);

    const unset = parseGroupOwn({ group: null, members: [], products: [] });
    expect(unset?.group).toBeNull();
    expect(unset?.members).toEqual([]);

    expect(parseGroupOwn({ group: null })).toBeNull();
    expect(parseGroupOwn({ group: { id: "g1" }, members: [], products: [] })).toBeNull();
    expect(parseGroupOwn(null)).toBeNull();
  });
});
