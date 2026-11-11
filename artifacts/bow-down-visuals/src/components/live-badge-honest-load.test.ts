/**
 * LiveBadge (the "live now" presence badge) — honest load
 * states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * A presence claim held to the truthful-presence law: the
 * badge lights ONLY from a proven ok answer from the live
 * endpoint — a non-ok response returns before any state is
 * set, and a thrown read leaves the badge exactly as it
 * was. A failed check can never light a "live" badge for a
 * stream that isn't, and presence is never asserted from an
 * error body.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./LiveBadge.tsx");

describe("the badge lights only from a proven live answer", () => {
  it("the ok gate at the door is pinned", () => {
    expect(src).toContain('fetch("/api/discord-bot/live")');
    expect(src).toContain("if (!res.ok) return;");
  });
});
