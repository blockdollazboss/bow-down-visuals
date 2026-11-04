/**
 * admin-desk-components — stack1500 world parity wave #5, census
 * item 46 source-contract pins. The website's /admin benches must
 * exist natively in the palace:
 * - the desk keys off the SERVER's own gate: it probes
 *   /admin/status through the seam constant and renders the
 *   not-authorized state from the rail's own sentence — the gate is
 *   never reimplemented client-side, and every rail re-checks the
 *   ADMIN_EMAILS allowlist itself (fail-closed);
 * - all seventeen benches mount in the one Admin desk, stacked at the
 *   StationPanel's My Studio board;
 * - every path, body and parse rides the admin-desk seam — no bench
 *   component hand-types an /api path;
 * - errors ride the shared plain-text error rail (apiErrorMessage /
 *   plainErrorText), never a raw body field.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("../../components/world/native/AdminDesk.tsx");
const bits = read("../../components/world/native/AdminBenchBits.tsx");
const ops = read("../../components/world/native/AdminOpsDesk.tsx");
const program = read("../../components/world/native/AdminProgramDesk.tsx");
const panel = read("../../components/world/StationPanel.tsx");

const COMPONENTS: Array<[string, string]> = [
  ["AdminDesk", desk],
  ["AdminBenchBits", bits],
  ["AdminOpsDesk", ops],
  ["AdminProgramDesk", program],
];

describe("the gate is the server's, probed — never reimplemented", () => {
  it("the desk probes the seam's status path and parses it strictly", () => {
    expect(desk).toContain("api.call(ADMIN_STATUS_PATH)");
    expect(desk).toContain("parseAdminStatus(data)");
    expect(desk).toContain('setPhase(isAdmin ? "ready" : "denied")');
  });

  it("the denied state carries the rail's own sentence", () => {
    expect(bits).toContain('data-testid="world-admin-denied"');
    expect(bits).toContain("ADMIN_NOT_AUTHORIZED_MESSAGE");
    expect(bits).toContain("isNotAuthorized");
  });

  it("a mid-session 403 flips a bench to denied, not failed", () => {
    expect(bits).toContain("adminDenied(e)");
    for (const [, src] of COMPONENTS) {
      expect(src).toContain("BenchDenied");
    }
  });
});

describe("all seventeen benches mount in the one desk", () => {
  it("the desk renders every bench component", () => {
    for (const name of [
      "ReportsBench",
      "DmcaBench",
      "ContentRemovalBench",
      "PitchFixBench",
      "ReversalsBench",
      "OperatorBench",
      "GearBench",
      "ChallengesBench",
      "GrantsBench",
      "RemixBench",
      "BowBench",
      "DropsBench",
      "SpotlightBench",
      "ContactBench",
      "UsersBench",
      "OrdersBench",
      "DiscordBench",
    ]) {
      expect(desk).toContain(`<${name} isLight={isLight} />`);
    }
  });

  it("the program benches carry their own sections", () => {
    expect(program).toContain('title="Challenges"');
    expect(program).toContain('title="Community Grants"');
    expect(program).toContain('title="Remix King"');
    expect(program).toContain('title="Palace Drops"');
  });

  it("the desk is hung in the StationPanel's my-studio stack", () => {
    expect(panel).toContain('import("@/components/world/native/AdminDesk")');
    expect(panel).toContain("<AdminDesk isLight={isLight} />");
  });
});

describe("paths ride the seam — nothing hand-typed", () => {
  it("every component imports the seam and types no /api path itself", () => {
    for (const [name, src] of COMPONENTS) {
      expect(src, name).toContain('from "@/lib/world/admin-desk"');
      expect(src, name).not.toContain('"/api/');
      expect(src, name).not.toContain("`/api/");
    }
  });

  it("the program benches build every body through the seam", () => {
    for (const builder of [
      "buildLifecycleBody",
      "buildPrizesBody",
      "buildJudgeByVotes",
      "buildJudgeByPicks",
      "buildGrantRoundBody",
      "buildGrantWindowsBody",
      "parseGrantSettleOutcome",
      "buildRemixCreateBody",
      "buildRemixPatchBody",
      "buildRemixSplitPayments",
      "buildDropBody",
      "dropBookingError",
      "parseUpcomingDrops",
    ]) {
      expect(program).toContain(builder);
    }
  });
});

describe("errors ride the shared plain-text rail", () => {
  it("the bits unwrap failures through apiErrorMessage and plainErrorText", () => {
    expect(bits).toContain("apiErrorMessage(");
    expect(bits).toContain("plainErrorText(");
  });

  it("each bench file surfaces failures as plain text, never a raw body", () => {
    for (const [name, src] of COMPONENTS) {
      expect(
        src.includes("plainErrorText") || src.includes("apiErrorMessage"),
        name,
      ).toBe(true);
    }
  });
});
