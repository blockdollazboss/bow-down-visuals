/**
 * PublishToShowcase (publish a work to the showcase) —
 * honest action states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * An action surface with no mount load: the publish write
 * throws on non-ok with the server's own message (the
 * errPublishFallback behind it) into the error surface — a
 * work is never shown as published on an unproven write,
 * and the failure the member sees is the server's reason,
 * not a generic shrug.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./PublishToShowcase.tsx");

describe("published is claimed only from an ok response", () => {
  it("the throw is pinned", () => {
    expect(src).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, t("showcasePublish.errPublishFallback")));');
  });
});
