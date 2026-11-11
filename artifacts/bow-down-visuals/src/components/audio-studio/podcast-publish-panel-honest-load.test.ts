/**
 * PodcastPublishPanel (the podcast feed settings panel) —
 * honest load states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * - THE FEED LOAD is a three-state chain: the loading line
 *   renders only while `me === null && !loadError`, the
 *   load-error branch renders on its own condition, and the
 *   settings form waits for the proven feed record — a
 *   failed load never paints a blank settings form as the
 *   member's saved feed. The loader throws on non-ok
 *   (String(res.status)) into loadError.
 * - THE SETTINGS SAVE throws on non-ok the same way, so a
 *   refused save never leaves edited values standing as if
 *   they were stored.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./PodcastPublishPanel.tsx");

describe("the feed load: loading, error, proven — never a blank form", () => {
  it("non-ok throws into loadError; the branches are condition-split", () => {
    /* the throw guards BOTH the load and the settings save */
    expect(src.split("if (!res.ok) throw new Error(String(res.status));").length - 1).toBe(2);
    expect(src).toContain("{me === null && !loadError && (");
    expect(src).toContain("{loadError && (");
    expect(src).toContain('t("podcast.publish.loadError")');
  });
});
