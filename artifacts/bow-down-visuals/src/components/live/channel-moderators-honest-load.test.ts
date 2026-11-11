/**
 * ChannelModerators (live channel moderator management) —
 * honest load states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * A four-state LoadState machine (loading / ready / error /
 * noprofile) whose header states its own doctrine —
 * "honest: loading, a real empty state, server errors
 * surface":
 * - A NO-PROFILE answer (400 with code NO_PROFILE) lands on
 *   its own noprofile state — the truth "you have no channel
 *   profile yet", never dressed as a load error or an empty
 *   moderator list.
 * - THE WRITES settle on exact statuses: an add counts only
 *   on 201, a remove only on 200 — any other answer leaves
 *   the proven list untouched.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./ChannelModerators.tsx");

describe("no-profile is its own state; writes settle on exact statuses", () => {
  it("the machine and the status gates are pinned", () => {
    expect(src).toContain('type LoadState = "loading" | "ready" | "error" | "noprofile";');
    expect(src).toContain('if (status === 400 && json?.code === "NO_PROFILE") {');
    expect(src).toContain("if (status === 201) {");
    expect(src).toContain("if (status === 200) setModerators((json.moderators ?? []) as ModeratorDto[]);");
  });
});
