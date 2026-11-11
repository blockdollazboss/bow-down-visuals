/**
 * DiscoveryCards (the discovery feed's track/video cards) —
 * honest load states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * A classification pin for a props-fed card family: the
 * cards render what the feed's proven pages hand them. Their
 * one self-owned read — the member's repost state for a
 * track — is held to the FollowButton doctrine: ok-gated
 * (`if (!r.ok || cancelled) return;`), applied only when
 * the payload value is actually a boolean
 * (`typeof state === "boolean"`), and its failure leaves
 * the state UNKNOWN, with the source stating why that's
 * safe: "the toggle still settles it from the server's
 * answer". A card never asserts reposted/not-reposted from
 * a failed read.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./cards.tsx");

describe("repost state applies only from a proven boolean", () => {
  it("the ok gate, the type gate, and the doctrine are pinned", () => {
    expect(src).toContain("if (!r.ok || cancelled) return;");
    expect(src).toContain('if (!cancelled && typeof state === "boolean") setReposted(state);');
    expect(src).toContain("/* unknown state — the toggle still settles it from the server's answer */");
  });
});
