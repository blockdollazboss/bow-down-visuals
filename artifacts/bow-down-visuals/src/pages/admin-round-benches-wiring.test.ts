/**
 * ADMIN ROUND BENCHES — WIRING (stack1200, 2026-11-01).
 *
 * The census that found the page-less rails: the challenge engine's
 * per-challenge admin (prizes/lifecycle/judge), the Community Grants
 * rounds admin, and the Remix King events admin all had ADMIN_EMAILS-
 * guarded endpoints with NO surface in /admin — while the benches
 * stack1100 docked (payment reversals, operator actions, studio-gear
 * queue) proved the shape a bench takes. This lane docks the three
 * round benches in the same idiom and pins the wiring here:
 *
 *   - /admin mounts all three benches (imports + JSX) for admins;
 *   - each bench reads through the strict lib parser for its rail and
 *     fires exactly the write verbs its API supports;
 *   - failure and empty are different states (load-error panel + retry
 *     AND a separate empty message, per bench);
 *   - the pitch & fix rewards/process action — previously reachable
 *     only as a side effect — has its own explicit control.
 *
 * Source-pin style, matching admin-bench-wiring.test.ts (stack1100 X1).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) =>
  readFileSync(resolve(here, rel), "utf8");

const admin = read("./admin.tsx");
const challenges = read("../components/ChallengeAdmin.tsx");
const grants = read("../components/CommunityGrantsAdmin.tsx");
const remix = read("../components/RemixKingAdmin.tsx");
const lib = read("../lib/admin-benches.ts");

describe("/admin mounts the three round benches", () => {
  it("imports and renders ChallengeAdmin, CommunityGrantsAdmin, RemixKingAdmin", () => {
    expect(admin).toContain(
      'import { ChallengeAdmin } from "@/components/ChallengeAdmin"',
    );
    expect(admin).toContain(
      'import { CommunityGrantsAdmin } from "@/components/CommunityGrantsAdmin"',
    );
    expect(admin).toContain(
      'import { RemixKingAdmin } from "@/components/RemixKingAdmin"',
    );
    expect(admin).toContain("<ChallengeAdmin authHeaders={authHeaders} />");
    expect(admin).toContain(
      "<CommunityGrantsAdmin authHeaders={authHeaders} />",
    );
    expect(admin).toContain("<RemixKingAdmin authHeaders={authHeaders} />");
  });

  it("the benches render inside the signed-in admin tree (after the gear queue)", () => {
    const gear = admin.indexOf("<StudioGearQueueAdmin");
    expect(gear).toBeGreaterThan(-1);
    expect(admin.indexOf("<ChallengeAdmin")).toBeGreaterThan(gear);
    expect(admin.indexOf("<CommunityGrantsAdmin")).toBeGreaterThan(gear);
    expect(admin.indexOf("<RemixKingAdmin")).toBeGreaterThan(gear);
  });
});

describe("challenge bench — rail wiring", () => {
  it("lists through the new admin read and the strict parser", () => {
    expect(challenges).toContain('"/api/admin/challenges"');
    expect(challenges).toContain("parseAdminChallenges");
    expect(lib).toContain("export function parseAdminChallenges");
  });

  it("loads the selected challenge's public detail for entries and prizes", () => {
    expect(challenges).toContain("`/api/challenges/${encodeURIComponent(slug)}`");
    expect(challenges).toContain("parseChallengeDetail");
  });

  it("fires exactly the rail's write verbs: prizes, lifecycle, judge", () => {
    expect(challenges).toContain("/prizes`");
    expect(challenges).toContain("/lifecycle`");
    expect(challenges).toContain("/judge`");
    expect(challenges).toContain('method: "POST"');
  });

  it("judging is a confirmed, one-shot-looking action with a result panel", () => {
    expect(challenges).toContain('data-testid="challenge-judge-confirm"');
    expect(challenges).toContain('data-testid="challenge-judge-result"');
    expect(challenges).toContain("parseJudgeResult");
  });

  it("the weekly pool cap is the lib constant, enforced inside the draft rules", () => {
    expect(lib).toContain("CHALLENGE_PRIZE_POOL_CAP_VB = 1000");
    expect(lib).toContain("total > CHALLENGE_PRIZE_POOL_CAP_VB");
    expect(challenges).toContain("prizeDraftError");
  });

  it("failure and empty are different states", () => {
    expect(challenges).toContain("admin.challenges.loadErrorTitle");
    expect(challenges).toContain("admin.challenges.empty");
    expect(challenges).toContain('data-testid="challenge-admin-bench"');
  });
});

describe("community grants bench — rail wiring", () => {
  it("reads the public surface (current + past rounds) via the strict parser", () => {
    expect(grants).toContain('"/api/community-grants"');
    expect(grants).toContain("parseGrantsAdmin");
    expect(lib).toContain("export function parseGrantsAdmin");
  });

  it("fires the rounds verbs: open (POST), windows (PATCH), settle (POST)", () => {
    expect(grants).toContain('"/api/admin/community-grants/rounds"');
    expect(grants).toContain("/rounds/${surface.round.id}`");
    expect(grants).toContain("/settle`");
    expect(grants).toContain('method: "PATCH"');
  });

  it("settle is confirmed and its outcome renders from the parsed result", () => {
    expect(grants).toContain('data-testid="grant-settle-confirm"');
    expect(grants).toContain("parseGrantSettleOutcome");
    expect(lib).toContain("export function parseGrantSettleOutcome");
    expect(grants).toContain('"already_settled"');
  });

  it("windows lock once the grant is paid (the PATCH-side rail, mirrored)", () => {
    expect(grants).toContain("grantWindowsEditable");
    expect(lib).toContain("export function grantWindowsEditable");
  });

  it("failure and empty are different states", () => {
    expect(grants).toContain("admin.grants.loadErrorTitle");
    expect(grants).toContain("admin.grants.empty");
    expect(grants).toContain('data-testid="community-grants-admin-bench"');
  });
});

describe("remix king bench — rail wiring", () => {
  it("lists through the new admin read (drafts included) and the strict parser", () => {
    expect(remix).toContain('"/api/admin/remix-king/events"');
    expect(remix).toContain("parseRemixAdminEvents");
    expect(lib).toContain("export function parseRemixAdminEvents");
  });

  it("fires the full verb set the API supports", () => {
    expect(remix).toContain('"/api/admin/remix-king/events"');
    expect(remix).toContain("/events/${bundle.event.id}`");
    expect(remix).toContain("/status`");
    expect(remix).toContain("/entries/${entryId}/shortlist`");
    expect(remix).toContain("/events/${bundle.event.id}/winner`");
    expect(remix).toContain("/releases/${bundle.release.id}/split-payments`");
  });

  it("status moves come from the mirrored transition map, never free-form", () => {
    expect(remix).toContain("remixStatusTargets");
    expect(lib).toContain("REMIX_TRANSITIONS");
    // cancelled is the one destructive move and it is confirmed.
    expect(remix).toContain('data-testid="remix-cancel-confirm"');
  });

  it("crowning is confirmed; splits are validated by the shared draft rules", () => {
    expect(remix).toContain('data-testid="remix-crown-confirm"');
    expect(remix).toContain("splitDraftError");
    expect(lib).toContain("export function splitDraftError");
  });

  it("failure and empty are different states", () => {
    expect(remix).toContain("admin.remixKing.loadErrorTitle");
    expect(remix).toContain("admin.remixKing.empty");
    expect(remix).toContain('data-testid="remix-king-admin-bench"');
  });
});

describe("pitch & fix — the rewards/process action has its own control", () => {
  it("the inbox posts to /api/admin/pitch-fix/rewards/process from a named button", () => {
    expect(admin).toContain('"/api/admin/pitch-fix/rewards/process"');
    expect(admin).toContain('data-testid="pitch-fix-process-rewards"');
    expect(admin).toContain("admin.pitchFix.processRewards");
  });
});

describe("locale keys the benches reference all exist in en", () => {
  const en = JSON.parse(read("../locales/en.json")) as {
    admin: Record<string, unknown>;
  };

  it("admin.challenges / admin.grants / admin.remixKing carry the bench copy", () => {
    for (const section of ["challenges", "grants", "remixKing"] as const) {
      const node = en.admin[section] as Record<string, unknown>;
      expect(node, section).toBeTruthy();
      expect(typeof node.title).toBe("string");
      expect(typeof node.loadErrorTitle).toBe("string");
      expect(typeof node.empty).toBe("string");
      expect(typeof node.actionError).toBe("string");
      expect(typeof node.footerNote).toBe("string");
    }
  });

  it("pitchFix carries the process-rewards copy", () => {
    const pf = en.admin.pitchFix as Record<string, unknown>;
    expect(typeof pf.processRewards).toBe("string");
    expect(typeof pf.processRewardsDone).toBe("string");
    expect(typeof pf.processRewardsFailed).toBe("string");
    expect(typeof pf.processRewardsNone).toBe("string");
  });
});
