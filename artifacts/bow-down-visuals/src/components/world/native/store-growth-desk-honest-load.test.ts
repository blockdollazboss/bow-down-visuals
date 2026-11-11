/**
 * StoreGrowthDesk — honest load standard (deep-pins tranche 3,
 * batch 9). The load is an explicit four-state machine
 * (loading / no-profile / ready / failed): guests fire no load; a
 * 404 money-checklist is the honest no-profile state; a non-ok
 * checklist, a slug-less body, a non-ok products read or an
 * unparsed list all throw into "failed" — the desk never reads a
 * failed chain as an empty store. Every write (price, create,
 * addon/bump) throws the SERVER's error string first (its own
 * fallback key after), and local state adopts only the parsed saved
 * row (parseSavedGrowthProduct / parseBumpSave) — a saved note can
 * only follow a parsed save.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./StoreGrowthDesk.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the load — a four-state machine, 404 is no-profile, not failure", () => {
  it("every broken link in the chain throws into failed; ready only from a parsed list", () => {
    const body = slice(src, "const load = async () => {", "useEffect(() => {");
    expect(body).toContain('if (checkRes.status === 404) { setState("no-profile"); return; }');
    expect(body).toContain('if (!checkRes.ok) throw new Error("checklist");');
    expect(body).toContain('if (!slug) throw new Error("checklist");');
    expect(body).toContain('if (!listRes.ok) throw new Error("products");');
    expect(body).toContain('if (!parsed) throw new Error("products");');
    expect(body).toContain('setState("failed");');
    expect(body.indexOf('setState("ready");')).toBeGreaterThan(body.indexOf("if (!parsed) throw"));
    expect(src).toContain("if (isGuest) return;");
  });
});

describe("the writes — the server's words first, parsed rows only", () => {
  it("price/create/addon throw the server's error string before local state adopts anything", () => {
    expect(src).toContain('if (!res.ok) throw new Error(typeof data["error"] === "string" ? data["error"] : t("worldCommerceStands.growthPriceSaveFailed"));');
    expect(src).toContain('if (!res.ok) throw new Error(typeof data["error"] === "string" ? data["error"] : t("worldCommerceStands.growthCreateFailed"));');
    expect(src).toContain('if (!res.ok) throw new Error(typeof data["error"] === "string" ? data["error"] : t("worldCommerceStands.growthAddonSaveFailed"));');
    expect(src).toContain("const saved = parseSavedGrowthProduct(data);");
    expect(src).toContain("const saved = parseBumpSave(data);");
  });
});
