/**
 * community-grants-routes.test.ts — Stack-200 N15 route contracts.
 *
 * The money and admin doors are only as real as their middleware:
 * - opening / adjusting / settling a round requires requireAuth +
 *   requireAdmin (the fail-closed ADMIN_EMAILS gate from routes/admin);
 * - voting, submitting, and reporting back require requireAuth —
 *   guests can read the public surface but can never vote;
 * - pre-migration honesty is wired: reads degrade, writes 503;
 * - the router is registered in routes/index.ts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(__dirname, p), "utf8");
const routes = read("../community-grants.ts");
const index = read("../index.ts");

describe("community grants — route gates", () => {
  it("admin doors (open / windows / settle) sit behind requireAuth + requireAdmin", () => {
    expect(routes).toContain('"/admin/community-grants/rounds", requireAuth, requireAdmin');
    expect(routes).toContain('"/admin/community-grants/rounds/:id", requireAuth, requireAdmin');
    expect(routes).toContain('"/admin/community-grants/rounds/:id/settle", requireAuth, requireAdmin');
  });

  it("member doors (project / vote / withdraw / report-back) sit behind requireAuth", () => {
    expect(routes).toContain('"/community-grants/:id/projects", requireAuth');
    expect(routes).toContain('"/community-grants/:id/vote", requireAuth');
    expect(routes).toContain('"/community-grants/:id/report-back", requireAuth');
    expect(routes).toMatch(/router\.delete\("\/community-grants\/:id\/vote", requireAuth/);
  });

  it("the public surface is a plain GET with optional session only", () => {
    expect(routes).toMatch(/router\.get\("\/community-grants", publicApiLimiter/);
  });

  it("pre-migration: writes 503, the read degrades to the empty surface", () => {
    expect(routes).toContain('code: "not_ready"');
    expect(routes).toContain("res.json({ current: null, past: [] })");
  });

  it("the router is registered", () => {
    expect(index).toContain("communityGrantsRouter");
    expect(index).toContain('from "./community-grants"');
  });
});
