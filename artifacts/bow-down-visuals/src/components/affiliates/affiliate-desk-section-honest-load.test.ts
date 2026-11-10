/**
 * AffiliateDeskSection — honest load states (Stack-400 C-28
 * components residual, deep-pins tranche 1). The earnings surface's
 * affiliate desk loads three rails in parallel (desk totals, my
 * codes, offers). The desk is the load-bearing read: a non-ok desk
 * response or a malformed desk payload THROWS, and the section
 * lands on its failure branch — an explicit "Couldn't load your
 * affiliate picture" with the section-isolation promise ("the rest
 * of your earnings are unaffected") and a retry that re-runs the
 * load. Codes and offers are secondary: each records only on its
 * own ok response. The claim action's failure lands on the same
 * honest branch rather than painting a code that was never minted.
 * Render order is the contract: failure, then loading, then the
 * loaded desk — whose own genuine empty ("Nobody is reselling your
 * products yet…") is reachable only behind a loaded desk.
 *
 * Copy is literal on this surface. The FE suite runs in node (no
 * DOM), so these tests pin the machine in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("./AffiliateDeskSection.tsx");

describe("the desk load throws on failure — it never paints an empty desk", () => {
  it("desk, codes and offers all start null (unloaded)", () => {
    expect(desk).toContain("const [desk, setDesk] = useState<Desk | null>(null);");
    expect(desk).toContain("const [codes, setCodes] = useState<MyCode[] | null>(null);");
    expect(desk).toContain("const [offers, setOffers] = useState<Offer[] | null>(null);");
  });

  it("a non-ok desk response and a malformed payload both throw", () => {
    expect(desk).toContain('if (!d.ok) throw new Error("desk failed");');
    expect(desk).toContain('if (!desk) throw new Error("desk payload malformed");');
  });

  it("codes and offers record only on their own ok responses", () => {
    expect(desk).toContain("if (c.ok) setCodes(normalizeAffiliateCodes(await c.json()));");
    expect(desk).toContain("if (o.ok) setOffers(normalizeAffiliateOffers(await o.json()));");
  });

  it("the effect turns a thrown load into the failed state", () => {
    expect(desk).toContain("load().catch(() => { if (!cancelled) setFailed(true); });");
  });

  it("a failed claim lands on the same honest branch", () => {
    expect(desk).toContain('if (!res.ok) throw new Error("claim failed");');
  });
});

describe("render order: failure (isolated, retryable), loading, then the desk", () => {
  it("the three branches appear in contract order", () => {
    const failIdx = desk.indexOf("Couldn&apos;t load your affiliate picture — the rest of your earnings are unaffected.");
    const loadIdx = desk.indexOf("Loading your affiliate picture…");
    const deskIdx = desk.indexOf("You owe affiliates");
    expect(failIdx).toBeGreaterThan(-1);
    expect(loadIdx).toBeGreaterThan(failIdx);
    expect(deskIdx).toBeGreaterThan(loadIdx);
  });

  it("the failure branch's retry re-runs the load", () => {
    expect(desk).toContain("onClick={() => setReloadKey((k) => k + 1)}");
    expect(desk).toContain("}, [load, reloadKey]);");
  });

  it("the genuine empty copy lives behind the loaded desk", () => {
    expect(desk).toContain("Nobody is reselling your products yet.");
    expect(desk.indexOf("Nobody is reselling your products yet.")).toBeGreaterThan(
      desk.indexOf("Loading your affiliate picture…"),
    );
  });
});
