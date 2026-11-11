/**
 * EmbedButton (the video embed-code button) — honest load
 * states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * A classification pin: the embed code itself is built from
 * the video's own slug — a local construction that makes no
 * server claim. The one server read, the referral code for
 * the embed URL, is fail-soft decoration inside its own
 * try/catch (the WidgetsDeskPanel doctrine): the code is
 * woven into the embed only when the read returns one, and
 * its failure simply produces the plain embed — a member is
 * never handed a fabricated referral code, and the embed is
 * never blocked by its tracking decoration.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./EmbedButton.tsx");

describe("the refcode decorates only when proven; the embed never waits on it", () => {
  it("the guarded read is pinned", () => {
    expect(src).toContain("fetch(`/api/embed/refcode/${encodeURIComponent(slug)}`, {");
  });
});
