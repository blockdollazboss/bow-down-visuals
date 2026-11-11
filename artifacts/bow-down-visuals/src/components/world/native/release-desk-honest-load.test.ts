/**
 * ReleaseDesk (the World distribution desk) — honest load
 * states (Stack-400 C-28 components residual, deep-pins
 * tranche 2).
 *
 * - THE MAIN LOAD fires three reads together and judges them
 *   separately, exactly like the 2D page: the RELEASES leg is
 *   the desk — a non-ok releases read throws into loadFailed
 *   and nothing records. The pricing and vault legs are
 *   additive: a miss records null pricing / a zero vault count
 *   and the load still lands.
 * - PRICING'S ABSENCE IS HONEST DEGRADATION, not a fake price:
 *   the submit action refuses to run without pricing
 *   (`!pricing` returns) and the child surfaces receive
 *   `pricing ?? undefined`, so no price is ever invented.
 * - THE VAULT COUNT can only ADD a suffix: it renders solely
 *   when releases exist AND the count is positive, so a failed
 *   vault read (recorded 0) claims nothing.
 * - THE WIZARD'S SONG PICKER is a documented best-effort read:
 *   songs record only on ok, and the audio-link field is the
 *   always-working fallback — "never a dead end".
 *
 * NO FIX in this lane — every family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("./ReleaseDesk.tsx");

const load = desk.slice(desk.indexOf("const load = useCallback(async () => {"), desk.indexOf("useEffect(() => {\n    void load();"));

describe("the main load: the releases leg is the desk, the other two are additive", () => {
  it("a non-ok releases read throws into loadFailed before anything records", () => {
    expect(load).toContain('if (!rRes.ok) throw new Error("releases");');
    expect(load).toContain("setReleases(parseReleaseList(await rRes.json().catch(() => null)));");
    expect(load.indexOf('throw new Error("releases")')).toBeLessThan(load.indexOf("setReleases(parseReleaseList"));
    expect(load).toContain("setLoadFailed(false);");
    expect(load).toContain("setLoadFailed(true);");
  });

  it("pricing and vault record conditionally on their own ok, inside the same load", () => {
    expect(load).toContain("setPricing(pRes.ok ? parseReleasePricing(await pRes.json().catch(() => null)) : null);");
    expect(load).toContain("setVaulted(vRes.ok ? parseVaultedCount(await vRes.json().catch(() => null)) : 0);");
  });
});

describe("absent pricing invents nothing", () => {
  it("the submit refuses to run without pricing and children get undefined, not a guess", () => {
    expect(desk).toContain('if (busy || !selected || selected.status !== "draft" || !pricing) return;');
    expect(desk).toContain("const effectivePricing = pricing ?? undefined;");
  });

  it("the vault suffix renders only behind a positive proven count", () => {
    expect(desk).toContain("releases.length > 0 && vaulted > 0");
  });
});

describe("the wizard's song picker is best-effort with a working fallback", () => {
  it("songs record only on ok; the link field is the documented fallback", () => {
    expect(desk).toContain("if (!cancelled && res.ok) setSongs(parseReleaseSongs(await res.json().catch(() => null)));");
    expect(desk).toContain("/* the link field is the fallback, never a dead end */");
  });
});
