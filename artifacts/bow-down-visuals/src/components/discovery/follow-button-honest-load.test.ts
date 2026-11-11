/**
 * FollowButton (the discovery follow/unfollow button) —
 * honest load states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * - THE TOGGLE flips only on a proven ok response — the
 *   next state and the parent callback (with the server's
 *   own follower count when it returns one) apply after the
 *   `!r.ok` throw; a failed toggle leaves the button exactly
 *   where it was. The silence is deliberate and documented:
 *   "no toast spam on discovery surfaces" — the truth is
 *   carried by the button NOT flipping, never by a false
 *   flip.
 * - THE INITIAL STATE READ fails into an honest unknown:
 *   a non-ok or thrown read leaves the buttons in their
 *   unknown state ("follow buttons render in unknown
 *   state") rather than asserting not-following for people
 *   the member may already follow.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./FollowButton.tsx");

describe("the button flips only on a proven ok toggle", () => {
  it("the gate and the documented failure doctrine are pinned", () => {
    expect(src).toContain('if (!r.ok) throw new Error(apiErrorMessage(d, "Follow failed"));');
    expect(src).toContain("setFollowing(next);");
    expect(src).toContain("/* the button just doesn't flip — no toast spam on discovery surfaces */");
  });
});

describe("the initial read fails into unknown, never into not-following", () => {
  it("a non-ok read returns without setting state", () => {
    expect(src).toContain("if (!r.ok || cancelled) return;");
    expect(src).toContain("/* follow buttons render in unknown state */");
  });
});
