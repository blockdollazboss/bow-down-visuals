/**
 * admin-bench-reads.test.ts — stack1200 admin-benches lane contracts.
 *
 * The census behind this lane: three admin rail families had NO
 * frontend surface at all — challenge prizes/lifecycle/judge,
 * community-grants round admin, and remix-king event admin. Two of
 * the three also had no LIST read an admin bench could ride:
 *  - challenges: the public lists only show upcoming/live, so a
 *    challenge in judging (the state the judge verb exists for) was
 *    invisible; GET /admin/challenges is the bench's spine.
 *  - remix-king: every public read hides draft events, so the team's
 *    own unpublished events were invisible; GET /admin/remix-king/events
 *    is the bench's spine, drafts included.
 * Community grants needed no addition — the public surface read
 * (current + past rounds) already carries every round.
 *
 * Both new reads sit behind the SAME fail-closed guard as every
 * other admin door (requireAuth + requireAdmin); the guard sweep
 * carries them behaviorally, these pins hold their registration and
 * composition in source.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(__dirname, p), "utf8");
const challenges = read("../challenge-engine.ts");
const remixKing = read("../remix-king.ts");
const grants = read("../community-grants.ts");

describe("admin bench reads — challenges", () => {
  it("GET /admin/challenges sits behind requireAuth + requireAdmin", () => {
    expect(challenges).toContain('router.get("/admin/challenges", requireAuth, requireAdmin');
  });

  it("the list carries the figures the bench decides from", () => {
    for (const field of [
      "effective_status",
      "starts_at",
      "ends_at",
      "judging_ends_at",
      "entry_count",
      "prize_pool_credits",
      "winners_announced",
    ]) {
      expect(challenges).toContain(field);
    }
  });

  it("the admin verbs the bench fires are the rail's own, unchanged", () => {
    expect(challenges).toContain('"/admin/challenges/:slug/prizes", requireAuth, requireAdmin');
    expect(challenges).toContain('"/admin/challenges/:slug/lifecycle", requireAuth, requireAdmin');
    expect(challenges).toContain('"/admin/challenges/:slug/judge", requireAuth, requireAdmin');
  });
});

describe("admin bench reads — remix king", () => {
  it("GET /admin/remix-king/events sits behind requireAuth + requireAdmin", () => {
    expect(remixKing).toContain('router.get("/admin/remix-king/events", requireAuth, requireAdmin');
  });

  it("the list composes the public view's parts plus the release's payments", () => {
    expect(remixKing).toContain("getEventView(store, e.id)");
    expect(remixKing).toContain("store.listPayments(view.release.id)");
  });

  it("drafts stay hidden from the PUBLIC event view (the admin list is the only draft read)", () => {
    expect(remixKing).toContain('view.event.status === "draft"');
  });
});

describe("admin bench reads — community grants needed no new read", () => {
  it("the public surface already returns current + past rounds", () => {
    expect(grants).toContain('router.get("/community-grants", publicApiLimiter');
    expect(grants).toContain("getGrantsSurface");
  });
});
