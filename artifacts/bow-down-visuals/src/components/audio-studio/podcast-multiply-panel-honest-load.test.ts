/**
 * PodcastMultiplyPanel (the episode-to-publish-kit tool) —
 * honest action states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * An action panel with no mount load, pinned for its money
 * honesty:
 * - THE MULTIPLY call gates the kit on ok + the proven kit
 *   id (`!res.ok || !data.kitId`), and its failure line
 *   states the money truth in plain words — "nothing was
 *   charged for a kit you didn't get" — the one claim a
 *   failed paid action must make accurately (the endpoint
 *   settles only on a delivered kit).
 * - A NETWORK failure gets its own distinct line ("the kit
 *   wasn't built") rather than borrowing the server's
 *   vocabulary — the panel never pretends it heard an answer
 *   it didn't get.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./PodcastMultiplyPanel.tsx");

describe("the kit applies only from an ok response carrying its id", () => {
  it("the gate and both honest failure lines are pinned", () => {
    expect(src).toContain("if (!res.ok || !data.kitId) {");
    expect(src).toContain('setError(apiErrorMessage(data, "The publish kit couldn\'t be built — nothing was charged for a kit you didn\'t get."));');
    expect(src).toContain('setError("Network hiccup — the kit wasn\'t built.");');
  });
});
