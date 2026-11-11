/**
 * LinkedCharactersSection (a vault's co-star cast list) —
 * honest load states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * - THE CAST LOAD is a four-state chain: spinner, then the
 *   load-error row (with a retry wired to the real loader —
 *   the source says it in as many words: a failed load is NOT
 *   an empty cast), then the genuine "No linked characters
 *   yet.", then the rows. The loader throws on non-ok.
 * - THE UNLINK only drops the row when the server actually
 *   unlinked it (the DELETE 404s for a missing/not-owned
 *   link); a failure keeps the row.
 * - FIX (this tranche): THE LINK POST was the one silent
 *   write left — a failed POST just stopped the spinner, the
 *   pick stayed put, and nothing anywhere said the link
 *   didn't land, so an unchanged cast read as a choice. The
 *   handler now sets a linkError line on non-ok AND on a
 *   thrown request, cleared at the start of every attempt.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./LinkedCharactersSection.tsx");

describe("the cast load: loading, error, empty, rows — in that order", () => {
  it("the loader throws on non-ok into a dedicated error state, never into the list", () => {
    expect(src).toContain("if (!res.ok) throw new Error();");
    expect(src).toContain("setLoadError(true);");
    expect(src).toContain("setLinks(data.links ?? []);");
  });

  it("the render chain is loading → error (with retry) → genuine empty → rows", () => {
    const loadingIdx = src.indexOf("{loading ? (");
    const errorIdx = src.indexOf(") : loadError ? (");
    const emptyIdx = src.indexOf(") : links.length === 0 ? (");
    expect(loadingIdx).toBeGreaterThan(-1);
    expect(errorIdx).toBeGreaterThan(loadingIdx);
    expect(emptyIdx).toBeGreaterThan(errorIdx);
    expect(src).toContain('data-testid="btn-retry-links"');
    expect(src).toContain("No linked characters yet.");
  });
});

describe("the writes only claim what the server proved", () => {
  it("unlink drops the row only on an ok DELETE", () => {
    expect(src).toContain("if (res.ok) {\n        setLinks((prev) => prev.filter((l) => l.id !== linkId));");
  });

  it("FIX: a failed link POST now surfaces a failure line instead of silence", () => {
    expect(src).toContain("const [linkError, setLinkError] = useState(false);");
    expect(src).toContain("setLinkError(false);");
    expect(src).toContain("setLinkError(true);");
    expect(src).toContain('data-testid="link-error"');
    expect(src).toContain("Couldn&apos;t link that character");
  });
});
