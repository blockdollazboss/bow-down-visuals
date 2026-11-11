/**
 * StoryViewer (the story playback viewer) — honest load
 * states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * A classification pin for a props-fed viewer: the stories
 * it plays are handed to it by the profile/feed surfaces
 * that loaded them (their own pins carry those loads). Its
 * one write — the per-story VIEW record — is a
 * fire-and-forget beacon inside a guarded catch: a view is
 * analytics, and its failure is invisible BY DESIGN (the
 * viewer never errors over a count it couldn't record, and
 * no count is ever displayed from it). Playback failures
 * land in the viewer's own catch handling rather than
 * trapping the story rail.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./StoryViewer.tsx");

describe("the view record is a beacon, never a gate or a displayed count", () => {
  it("the beacon call and its guard are pinned", () => {
    expect(src).toContain("fetch(`/api/stories/${s.id}/view`, {");
    expect(src).toContain("}).catch(() => {});");
  });
});
