/**
 * team-seats-desk-components — stack1500 world parity (wave 4a
 * follow-on) source-contract pins. The Settings Team Seats surface
 * must exist as ONE native desk at the My Studio board:
 * - the desk rides the seats router's rails end to end through the
 *   seam (list / invite / accept / role change / revoke), never a
 *   website pull-up of /settings;
 * - the surface is FREE — the desk never reaches for the
 *   confirmed-spend seam and never names a price;
 * - errors travel only through the shared plain-text rail, and a
 *   failed load reads as failed with a retry, never as "no seats";
 * - the desk is hung in the StationPanel's my-studio composition,
 *   at the anchor where the wave-4a TeamDesk composes at join.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("../../components/world/native/TeamSeatsDesk.tsx");
const panel = read("../../components/world/StationPanel.tsx");
const seam = read("./team-seats-desk.ts");

describe("the desk rides the seats rails end to end through the seam", () => {
  it("list, invite, accept, role change and revoke all go through seam paths + builders + parsers", () => {
    expect(desk).toContain("fetch(TEAM_SEATS_PATH");
    expect(desk).toContain("fetch(TEAM_SEATS_INVITE_PATH");
    expect(desk).toContain("fetch(TEAM_SEATS_ACCEPT_PATH");
    expect(desk).toContain("fetch(teamSeatPath(seat.id)");
    expect(desk).toContain("buildTeamSeatInviteBody");
    expect(desk).toContain("buildTeamSeatRoleBody");
    expect(desk).toContain("buildTeamSeatAcceptBody");
    expect(desk).toContain("extractTeamSeatInviteToken");
    expect(desk).toContain("parseTeamSeatsList");
    expect(desk).toContain("parseTeamSeatInviteResult");
    expect(desk).toContain("parseTeamSeatAcceptResult");
    expect(desk).toContain("parseTeamSeatResult");
    expect(desk).toContain('data-testid="world-team-seats"');
    expect(desk).toContain('data-testid="world-team-seats-matrix"');
    expect(desk).toContain('data-testid="world-team-seats-invite"');
    expect(desk).toContain('data-testid="world-team-seats-invite-link"');
    expect(desk).toContain('data-testid="world-team-seats-accept"');
    expect(desk).toContain('data-testid="world-team-seats-list"');
    expect(desk).toContain('data-testid="world-team-seats-memberof"');
  });

  it("the seam's endpoints are the router's, not a parallel invention", () => {
    expect(seam).toContain('TEAM_SEATS_PATH = "/api/team-seats"');
    expect(seam).toContain('TEAM_SEATS_INVITE_PATH = "/api/team-seats/invite"');
    expect(seam).toContain('TEAM_SEATS_ACCEPT_PATH = "/api/team-seats/accept"');
  });
});

describe("the surface stays FREE — no spend seam, no pull-up", () => {
  it("never reaches for the confirmed-spend rail", () => {
    expect(desk).not.toContain("confirmedFetch");
    expect(desk).not.toContain("useConfirmedApi");
    expect(desk).not.toContain("overrideCost");
  });

  it("never walks the walker out to the 2D settings page", () => {
    expect(desk).not.toContain('href="/settings');
    expect(desk).not.toContain("window.location");
    expect(desk).not.toContain("Open on the website");
  });
});

describe("honest states — failure is never dressed as empty", () => {
  it("a failed load renders the error state with a retry, in the page's words", () => {
    expect(desk).toContain("NativeErrorState");
    // The states' words ride the settings page's own catalog keys now
    // (stack100 locale unit 46).
    expect(desk).toContain('t("settings.teamLoadError")');
    expect(desk).toContain("setLoadFailed(true)");
    expect(desk).toContain("NativeEmptyState");
    expect(desk).toContain('t("settings.teamEmpty")');
  });

  it("errors travel only through the shared plain-text rail", () => {
    expect(desk).toContain("plainErrorText");
    expect(desk).toContain("apiErrorMessage");
    expect(desk).not.toContain(".error ??");
    expect(desk).not.toContain("data.error");
  });

  it("revoke is two-tap, and revoked seats get no live actions", () => {
    expect(desk).toContain("armedRevokeId");
    expect(desk).toContain("canRevokeTeamSeat");
    expect(desk).toContain("canChangeTeamSeatRole");
  });
});

describe("the desk is hung in the My Studio composition", () => {
  it("StationPanel lazy-loads it and mounts it in a DeskDoor", () => {
    expect(panel).toContain(
      'import("@/components/world/native/TeamSeatsDesk")',
    );
    expect(panel).toContain("<TeamSeatsDesk isLight={isLight} />");
  });
});
