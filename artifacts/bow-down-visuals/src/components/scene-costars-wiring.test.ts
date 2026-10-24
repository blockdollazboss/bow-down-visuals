/**
 * scene-costars-wiring.test.ts — source pins for the Co-Stars fix.
 *
 * The contracts pinned here:
 *  (D2) Scene Studio's linked co-stars carry their vault id + reference
 *       photo, and BOTH visual paths — the proposed reference set and
 *       the composite cast photo — are built from mergeSceneCast
 *       (picked + linked). Before the fix both were built from manual
 *       picks only, so a linked co-star was prompt text and the model
 *       invented their face.
 *  (D8) The prompt-text merge dedupes by vault id, never by name (two
 *       distinct characters can share a name).
 *  (D3) The Linked Characters manager removes an unlinked row only
 *       when the server confirms (res.ok) — the DELETE 404s for a
 *       missing/not-owned link, and dropping the row anyway would lie
 *       about who is still cast.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const studio = readFileSync(new URL("./SceneStudio.tsx", import.meta.url), "utf8");
const manager = readFileSync(new URL("./LinkedCharactersSection.tsx", import.meta.url), "utf8");

describe("D2 — linked co-stars anchor Scene Studio generation", () => {
  it("the links fetch keeps the vault id and the reference photo", () => {
    expect(studio).toContain("id: l.character.id as string");
    expect(studio).toContain("imageUrl: (l.character.reference_image_url as string | null) ?? null");
  });

  it("the proposed reference set is built from the merged cast", () => {
    expect(studio).toContain("coStars: mergeSceneCast({");
    expect(studio).toContain("linked: coStars.map((c) => ({ id: c.id, name: c.name, imageUrl: c.imageUrl }))");
  });

  it("the composite cast photo is built from the merged cast too", () => {
    const merges = studio.match(/mergeSceneCast\(\{/g) ?? [];
    expect(merges.length).toBeGreaterThanOrEqual(2);
    expect(studio).toContain(".filter((c) => !!c.imageUrl && /^https:\\/\\//i.test(c.imageUrl))");
  });

  it("the merge helper is imported from the scene-references lib", () => {
    expect(studio).toContain("mergeSceneCast");
    expect(studio).toContain('from "@/lib/scene-references"');
  });
});

describe("D8 — prompt-text merge dedupes by vault id, not by name", () => {
  it("sceneCoStarsWithLinks keys on ids", () => {
    expect(studio).toContain("const seenIds = new Set(sceneCoStars.map((o) => o.id));");
    expect(studio).not.toContain("out.some((o) => o.name === c.name)");
    expect(studio).not.toContain("matched by name to avoid dupes");
  });
});

describe("D3 — unlink only removes the row on server confirmation", () => {
  it("handleUnlink gates the optimistic removal on res.ok", () => {
    expect(manager).toContain("const res = await fetch(`/api/artist-vaults/${vault.id}/links/${linkId}`");
    expect(manager).toContain("if (res.ok) {");
    const unlinkBlock = manager.slice(manager.indexOf("async function handleUnlink"));
    expect(unlinkBlock.indexOf("if (res.ok)")).toBeGreaterThan(-1);
    expect(unlinkBlock.indexOf("if (res.ok)")).toBeLessThan(
      unlinkBlock.indexOf("setLinks((prev) => prev.filter((l) => l.id !== linkId))"),
    );
  });
});
