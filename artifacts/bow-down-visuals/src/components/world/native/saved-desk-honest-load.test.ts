/**
 * SavedDesk (the in-World saved-items desk) — honest load
 * states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * The native twin of the library SavedPanel, held to the
 * same law: the saves load throws on non-ok and parses
 * through its response validator (savesOfResponse) before
 * an item renders; failure lands on the desk's dedicated
 * load-error line (savedLoadError), with the loading line
 * rendered ahead of it — a failed load never reads as an
 * empty saves list. The unsave write throws on non-ok
 * ("unsave failed") — an item leaves the desk only from the
 * proven response path.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./SavedDesk.tsx");

describe("the saves load proven; unsave claims only on ok", () => {
  it("the throws, the parser, and the error line are pinned", () => {
    expect(src).toContain('if (!res.ok) throw new Error("load failed");');
    expect(src).toContain("const parsed = savesOfResponse(await res.json().catch(() => ({})));");
    expect(src).toContain('t("worldCatalogLibrary.savedLoadError")');
    expect(src).toContain('if (!res.ok) throw new Error("unsave failed");');
  });
});
