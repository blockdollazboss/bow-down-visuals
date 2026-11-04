import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/* ─── Team invite access — /team page (Stack 100, owner ruling
   Nov 4, 2026) ─────────────────────────────────────────────────────
   Shot Caller ★4 gates CREATING a team only. Anyone invited can see
   their invite and join at any rank; any member sees their team.
   These pins hold the 2D page to that split: the list rail's
   canCreate flag decides create-form vs locked create card, the
   pending-invites card renders ABOVE that decision (reachable at
   any rank), and the gate card honestly says invites can be
   accepted at any rank.

   LOCALE NOTE: team.inviteAnyRankNote's non-English values are
   agent-drafted translations, UNREVIEWED. It is not money copy.
   team.createTeamHint is a money-class key (it states the ★4 / 300
   points earning terms) and stays exactly as the core left it in
   every catalog — this lane did not touch it anywhere. */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const page = read("./team.tsx");
const routes = read("../../api-server/src/routes/teams.ts");

const LOCALES = ["en", "es", "fr", "de", "it", "pt", "ar", "hi", "ja", "ko"] as const;

describe("/team page — participation split", () => {
  it("the create decision rides the list rail's canCreate flag", () => {
    expect(page).toContain("setCanCreate(data.canCreate === true)");
    expect(page).toContain("!canCreate ? (");
    expect(page).toContain('data-testid="team-create-gate"');
  });

  it("pending invites render above the create decision — reachable at any rank", () => {
    const invitesIdx = page.indexOf('t("team.pendingInvites")');
    const gateIdx = page.indexOf('data-testid="team-create-gate"');
    const formIdx = page.indexOf('t("team.createTeam")}');
    expect(invitesIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeGreaterThan(invitesIdx);
    // The enabled create form only exists past the gate branch.
    expect(formIdx).toBeGreaterThan(gateIdx);
  });

  it("the locked card reuses the earned-rank hint and adds the any-rank invite note", () => {
    const gate = page.slice(page.indexOf('data-testid="team-create-gate"'));
    expect(gate).toContain('t("team.createTeamHint")');
    expect(gate).toContain('t("team.inviteAnyRankNote")');
    // No create form inside the locked card.
    expect(gate.slice(0, gate.indexOf("</Card>"))).not.toContain("handleCreate");
  });
});

describe("the rail split the page rides", () => {
  it("GET /teams carries canCreate and never answers the gate sentence", () => {
    const get = routes.slice(routes.indexOf('router.get("/teams"'), routes.indexOf('router.get("/teams/:id"'));
    expect(get).toContain("canCreate");
    expect(get).not.toContain("res.status(403)");
  });

  it("POST /teams keeps the fail-closed ★4 gate sentence", () => {
    const post = routes.slice(routes.indexOf('router.post("/teams"'), routes.indexOf('router.get("/teams"'));
    expect(post).toContain("isShotCallerOrHigher");
    expect(post).toContain("Team Workspace requires Shot Caller tier or higher.");
  });
});

describe("locale — inviteAnyRankNote in all 10 catalogs", () => {
  it("every catalog carries the key; en is the source sentence verbatim", () => {
    for (const lang of LOCALES) {
      const cat = JSON.parse(read(`../locales/${lang}.json`)) as {
        team: Record<string, string>;
      };
      expect(cat.team["inviteAnyRankNote"], lang).toBeTruthy();
      expect(cat.team["inviteAnyRankNote"]!.length, lang).toBeGreaterThan(20);
    }
    const en = JSON.parse(read("../locales/en.json")) as { team: Record<string, string> };
    expect(en.team["inviteAnyRankNote"]).toBe(
      "Joining is different: if someone invites you to a team, you can accept and join at any rank — your invites show up right here.",
    );
  });

  it("the money-class createTeamHint keeps its earning terms in en", () => {
    const en = JSON.parse(read("../locales/en.json")) as { team: Record<string, string> };
    expect(en.team["createTeamHint"]).toContain("Shot Caller (★4)");
    expect(en.team["createTeamHint"]).toContain("never a plan you can buy");
    expect(en.team["createTeamHint"]).toContain("300 points");
  });
});
