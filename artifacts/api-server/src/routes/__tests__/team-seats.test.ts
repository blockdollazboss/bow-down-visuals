/** Unit tests for the Team Seats permission matrix (pure, no DB). */
import { describe, expect, it } from "vitest";
import { TEAM_SEAT_ROLES, TEAM_SEAT_STATUSES, permissionsForRole } from "@workspace/db";

describe("team seats permission matrix", () => {
  it("exposes exactly the four DistroKid-style roles", () => {
    expect([...TEAM_SEAT_ROLES]).toEqual(["owner", "manager", "collaborator", "viewer"]);
  });

  it("exposes invited/active/revoked statuses", () => {
    expect([...TEAM_SEAT_STATUSES]).toEqual(["invited", "active", "revoked"]);
  });

  it("owner can do everything", () => {
    const p = permissionsForRole("owner");
    expect(Object.values(p).every(Boolean)).toBe(true);
  });

  it("manager can generate, publish, view money, edit profile — but not manage team", () => {
    expect(permissionsForRole("manager")).toEqual({
      canGenerate: true,
      canPublish: true,
      canViewMoney: true,
      canEditProfile: true,
      canManageTeam: false,
    });
  });

  it("collaborator can only generate/spend credits", () => {
    expect(permissionsForRole("collaborator")).toEqual({
      canGenerate: true,
      canPublish: false,
      canViewMoney: false,
      canEditProfile: false,
      canManageTeam: false,
    });
  });

  it("viewer is read-only", () => {
    const p = permissionsForRole("viewer");
    expect(Object.values(p).some(Boolean)).toBe(false);
  });

  it("unknown role falls back to viewer", () => {
    expect(permissionsForRole("hacker")).toEqual(permissionsForRole("viewer"));
  });
});
