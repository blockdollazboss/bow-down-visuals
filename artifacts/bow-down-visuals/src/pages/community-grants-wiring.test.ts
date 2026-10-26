/**
 * community-grants-wiring.test.ts — Stack-200 N15 source contracts.
 *
 * Pins:
 * - the surface docks INSIDE the shell: a /community-grants route in
 *   App.tsx + a real-name sidebar door in the Social section, beside
 *   Contests / Pitch & Fix (its family) — no standalone microsite;
 * - the honest states exist on the page: no-round, no-candidates,
 *   tie (no invented winner), report-back posted vs still-owed;
 * - the pool is READ from the API — the page contains no pool amount
 *   of its own, and the copy says VB, never cash;
 * - voting is one member one vote in the copy, and vote actions go to
 *   the API (the server holds the one-row rule).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

const page = read("pages/community-grants.tsx");
const app = read("App.tsx");
const sidebar = read("components/layout/app-sidebar.tsx");
const en = JSON.parse(read("locales/en.json")) as any;

describe("community grants — docking", () => {
  it("has a route inside the shell and a real-name Social sidebar door", () => {
    expect(app).toContain('path="/community-grants"');
    expect(app).toContain("CommunityGrantsPage");
    expect(sidebar).toContain('href: "/community-grants"');
    expect(sidebar).toContain('labelKey: "nav.communityGrants"');
    expect(en.nav.communityGrants).toBe("Community Grants");
  });
});

describe("community grants — honesty surface", () => {
  it("carries the honest empty and edge states", () => {
    expect(page).toContain('data-testid="grants-no-round"');
    expect(page).toContain('data-testid="grants-no-candidates"');
    expect(page).toContain('data-testid="grants-result-tie"');
    expect(page).toContain('data-testid="grants-report-owed"');
    expect(page).toContain('data-testid="grants-report-back"');
    expect(en.communityGrants.noRoundTitle).toBe("No round is open right now");
    expect(en.communityGrants.noCandidates).toContain("No candidates yet");
    expect(en.communityGrants.tieBody).toContain("no grant was paid");
  });

  it("reads the pool from the API and never states a cash path", () => {
    expect(page).toContain("round.poolVb");
    expect(page).toContain("/api/community-grants");
    /* No pool-sized literal anywhere on the page (amounts come from the round). */
    expect(page).not.toMatch(/poolVb\s*[:=]\s*\d/);
    expect(en.communityGrants.vbOnlyLine).toContain("never cash");
    expect(JSON.stringify(en.communityGrants)).not.toMatch(/\$\s?\d/);
  });

  it("vote + submit + report-back all go through the API doors", () => {
    expect(page).toContain("/vote`");
    expect(page).toContain("/projects`");
    expect(page).toContain("/report-back`");
    expect(page).toContain('method: "DELETE"');
  });
});
