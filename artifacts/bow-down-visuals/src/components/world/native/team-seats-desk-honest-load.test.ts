/**
 * TeamSeatsDesk — honest load standard (deep-pins tranche 3,
 * batch 9). The seats load: non-ok throws with the status, an
 * unparsed list throws too, and failure lands in loadFailed — never
 * in an empty team. The four seat writes each throw the server's
 * words on non-ok into the desk's notice slot BEFORE anything local
 * moves: invite, accept (the list reloads only after an ok accept),
 * role change, revoke (two-tap armed — the revoke button must be
 * armed first, and the row only drops after the ok answer).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./TeamSeatsDesk.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the seats load — failure is never an empty team", () => {
  it("non-ok and unparsed both throw into loadFailed", () => {
    expect(src).toContain("if (!res.ok) throw new Error(`team seats ${res.status}`);");
    expect(src).toContain('if (!parsed) throw new Error("team seats shape");');
    expect(src).toContain("if (!cancelled) setLoadFailed(true);");
    expect(src.indexOf("if (!cancelled) setList(parsed);")).toBeGreaterThan(src.indexOf('throw new Error("team seats shape")'));
  });
});

describe("the seat writes — server words before local moves", () => {
  it("invite/accept/role/revoke each throw on non-ok first", () => {
    expect(src).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, t("worldTeamLegal.seatsInviteStatusError", { status: res.status })));');
    expect(src).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, t("worldTeamLegal.seatsAcceptStatusError", { status: res.status })));');
    expect(src).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, t("worldTeamLegal.seatsRoleStatusError", { status: res.status })));');
    const revoke = slice(src, "async function revoke(seat: TeamSeat) {", "</div>\n  );\n}");
    expect(revoke).toContain("if (armedRevokeId !== seat.id) {");
    expect(revoke).toContain("if (!res.ok) {");
  });
});
