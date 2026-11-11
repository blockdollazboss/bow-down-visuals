/**
 * VaultDripSection (drip-schedule unreleased songs) —
 * honest load states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * - FIX (this tranche): THE SONGS LOAD never checked its
 *   response and its catch was commented "empty state" — a
 *   failed /api/songs read (or an error body with no songs
 *   field) rendered "No songs in your vault yet — make one
 *   first", asserting an empty vault the load never proved.
 *   The loader now throws on non-ok into a dedicated
 *   songsFailed state, rendered BETWEEN loading and the
 *   genuine empty state with the data-safe copy ("Your
 *   vault couldn't load just now — your songs are safe…")
 *   and a retry that re-runs the real load.
 * - THE DRAFT-CREATION loop is partial-progress honest: a
 *   per-item failure throws naming the exact song ("Draft
 *   failed for \"…\"") into the error line, so a batch never
 *   reports all-drafted when one draft failed.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./VaultDripSection.tsx");

describe("FIX: the songs load errors honestly instead of asserting an empty vault", () => {
  it("non-ok throws into songsFailed; the failed branch precedes the empty branch", () => {
    expect(src).toContain('if (!res.ok) throw new Error("songs load failed");');
    expect(src).toContain("setSongsFailed(true);");
    const failedIdx = src.indexOf(") : songsFailed ? (");
    const emptyIdx = src.indexOf(") : songs.length === 0 ? (");
    expect(failedIdx).toBeGreaterThan(-1);
    expect(emptyIdx).toBeGreaterThan(failedIdx);
    expect(src).toContain("Your vault couldn't load just now — your songs are safe, this page just couldn't reach them.");
    expect(src).toContain("No songs in your vault yet — make one first, then drip it.");
    expect(src).not.toContain("/* empty state */");
  });
});

describe("draft creation names the exact song that failed", () => {
  it("the per-item throw is pinned", () => {
    expect(src).toContain('if (!res.ok) throw new Error(`Draft failed for "${item.title}"`);');
  });
});
