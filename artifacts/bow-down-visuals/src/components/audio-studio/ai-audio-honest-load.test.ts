/**
 * AiAudio (the audio studio's AI panels — sample-pack + SFX
 * library) — honest load states (Stack-400 C-28 components
 * residual, deep-pins tranche 2).
 *
 * - THE SFX LIBRARY MERGE is the standard's own case study,
 *   documented on the code: the server's sounds merge INTO the
 *   local list (deduped by id/url), and a failed merge gets
 *   its own failure state + retry (librarySyncFailed) "instead
 *   of the first-run empty claim (Q1's empty-lie pattern)". A
 *   non-ok response throws, and a payload whose items aren't
 *   an array throws too — the merge never runs on an unproven
 *   payload, and a member with local sounds is unaffected
 *   either way: the list on screen is real.
 * - THE SAMPLE-PACK CATALOG is progressive enhancement: it
 *   records (and seeds the genre/key picks) only on ok; a
 *   failed read leaves the panel on its built-in defaults and
 *   claims nothing about a catalog it didn't get.
 *
 * NO FIX in this lane — every family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const panel = read("./AiAudio.tsx");

describe("the SFX merge: failure is a state, never the first-run empty claim", () => {
  it("non-ok and non-array payloads throw into librarySyncFailed", () => {
    expect(panel).toContain('if (!res.ok) throw new Error("sfx library load failed");');
    expect(panel).toContain('if (!Array.isArray(items)) throw new Error("sfx library load failed");');
    expect(panel).toContain("setLibrarySyncFailed(false);");
    expect(panel).toContain("setLibrarySyncFailed(true);");
  });

  it("the standard is written on the code", () => {
    expect(panel).toContain("a failed merge gets its own failure state + retry");
    expect(panel).toContain("instead of the first-run empty claim (Q1's empty-lie pattern");
  });

  it("the merge adds only proven server items to the real local list", () => {
    expect(panel).toContain("if (!next.some((p) => p.id === it.id || p.url === it.url)) {");
  });
});

describe("the sample-pack catalog is progressive enhancement", () => {
  it("it records and seeds only on ok", () => {
    expect(panel).toContain('const res = await fetch("/api/sample-pack/catalog");');
    expect(panel).toContain("if (!res.ok) return;");
    expect(panel).toContain("setCatalog(data);");
    expect(panel).toContain("/* catalog is progressive enhancement */");
  });
});
