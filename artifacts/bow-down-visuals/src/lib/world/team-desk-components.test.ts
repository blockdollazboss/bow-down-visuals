import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/* ─── TeamDesk component contracts (stack1500 wave #4a) ─────────────
   Source-level pins for the Team native desk: it rides every rail
   through the seam (paths/parsers never hand-typed), the pool
   funding is the one spend and it rides the confirmed rail with
   the member's own amount as the override, every honest state the
   page has (tier gate, spending-unavailable, group-not-ready
   failure, out-of-Bucs) has its panel, errors only travel the
   shared plain-text rail, and the desk mounts in the My Studio
   board's stack. */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const desk = read("../../components/world/native/TeamDesk.tsx");
const panel = read("../../components/world/StationPanel.tsx");

describe("TeamDesk rides the seam", () => {
  it("imports the seam's paths, builders, parsers and role rules", () => {
    for (const name of [
      "TEAMS_PATH",
      "teamDetailPath",
      "teamInvitePath",
      "teamFundPath",
      "teamSpendingPath",
      "teamGroupProfilePath",
      "parseTeamList",
      "parseTeamDetail",
      "parseSpending",
      "parseFundResult",
      "parseGroupOwn",
      "buildCreateTeamPayload",
      "buildInvitePayload",
      "buildFundPayload",
      "buildGroupProductPayload",
      "canChangeRoles",
      "canRemoveMember",
      "isTeamAdmin",
      "isTierGateError",
      "fundAmountFromInput",
      "inviteEmailValid",
      "TEAM_SHARED_VAULTS_NOTE",
    ]) {
      expect(desk, name).toContain(name);
    }
    expect(desk).toContain('from "@/lib/world/team-desk"');
    expect(desk).toContain('from "@/lib/group-profile-view"');
  });

  it("never re-types a /api/teams path inline", () => {
    expect(desk).not.toMatch(/["'`]\/api\/teams/);
    expect(desk).not.toMatch(/["'`]\/api\/group-profiles/);
    // The public read rides the page lib's own fetcher (it owns the
    // public path + the typed 404), never a hand-typed URL here.
    expect(desk).toContain("fetchPublicGroupProfile(slug)");
  });
});

describe("the funding spend", () => {
  it("rides the confirmed rail with the member's own amount as the override", () => {
    expect(desk).toContain("confirmedFetch");
    expect(desk).toContain("overrideCost: amount");
    expect(desk).toContain('overrideFeature: "Team Pool Funding"');
  });

  it("out-of-Bucs is its own state naming the Visual Buc Packs desk", () => {
    expect(desk).toContain('data-testid="world-team-out-of-credits"');
    expect(desk).toContain('out_of_credits');
    expect(desk).toMatch(/Visual Buc Packs desk\s+in the Treasury/);
  });
});

describe("honest states", () => {
  it("the tier gate renders instead of dying on the list 403", () => {
    expect(desk).toContain('data-testid="world-team-tier-gate"');
    expect(desk).toContain("TEAM_TIER_GATE_MESSAGE");
    expect(desk).toContain("isTierGateError");
  });

  it("a failed spending read is its own card with a retry, never silent", () => {
    expect(desk).toContain('data-testid="world-team-spending-error"');
    expect(desk).toContain("Team spending couldn&rsquo;t load");
    expect(desk).toContain('data-testid="world-team-spending"');
  });

  it("a failed group read has its own retry panel", () => {
    expect(desk).toContain('data-testid="world-team-group-error"');
    expect(desk).toContain('data-testid="world-team-group"');
  });

  it("the public preview is honest when the page is not public", () => {
    expect(desk).toContain('data-testid="world-team-public-preview"');
    expect(desk).toContain('previewState === "missing"');
    expect(desk).toContain("answering yet");
  });

  it("errors only travel the shared plain-text rail", () => {
    expect(desk).toContain("apiErrorMessage");
    expect(desk).toContain("plainErrorText");
    // The one raw-field read is the 402 classification flag, never a
    // rendered message (the MoviesDesk precedent); rendered errors
    // are the plain-text state only.
    expect(desk).not.toMatch(/\{data\.error\}/);
    expect(desk).not.toMatch(/\{res\.error\}/);
    expect(desk).not.toMatch(/err\.body/);
  });
});

describe("every station panel is present", () => {
  it("all sections carry their test ids", () => {
    for (const id of [
      'data-testid="world-team-desk"',
      'data-testid="world-team-create"',
      'data-testid="world-team-invites"',
      'data-testid="world-team-pool"',
      'data-testid="world-team-fund"',
      'data-testid="world-team-invite-form"',
      'data-testid="world-team-members"',
      'data-testid="world-team-group-product"',
      'data-testid="world-team-danger"',
    ]) {
      expect(desk, id).toContain(id);
    }
  });

  it("the fallback toggle is a pressed-state button and the vault note is present", () => {
    expect(desk).toContain('data-testid="world-team-fallback-toggle"');
    expect(desk).toContain("aria-pressed={team.allowPersonalFallback}");
    expect(desk).toContain("TEAM_SHARED_VAULTS_NOTE");
  });

  it("destructive actions are two-tap confirms, never one-click", () => {
    expect(desk).toContain("Tap again to leave");
    expect(desk).toContain("Tap again to delete");
    expect(desk).toContain("Tap again to remove");
  });

  it("there is no pull-up of the 2D /team page", () => {
    expect(desk).not.toContain('href="/team"');
    expect(desk).not.toContain('to="/team"');
    expect(desk).not.toContain("Open on the website");
  });
});

describe("StationPanel mount", () => {
  it("the desk is lazy-loaded and stacked in the My Studio board, after AcademyDesk", () => {
    expect(panel).toContain(
      'import("@/components/world/native/TeamDesk")',
    );
    const academyIdx = panel.indexOf("<AcademyDesk isLight={isLight} />");
    const teamIdx = panel.indexOf("<TeamDesk isLight={isLight} />");
    expect(teamIdx).toBeGreaterThan(academyIdx);
    expect(panel).toContain('station.id === "my-studio"');
  });
});
