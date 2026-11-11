/**
 * StreamSummaryCard (the post-stream summary card) — honest
 * load states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * A four-state machine (loading / ready / hidden / error):
 * - LOADING has its own card ("Loading your stream
 *   summary…") — never a blank or a premature summary.
 * - A 403 or 404 lands on HIDDEN, its own truth: the
 *   summary isn't this member's to see (or doesn't exist),
 *   so the card withdraws — it is neither an error alarm
 *   nor a fabricated summary.
 * - ANY OTHER failure lands on the error state, and the
 *   payload parse is null-safe (res.json().catch(() =>
 *   null)) — an unparseable body can never become summary
 *   numbers.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./StreamSummaryCard.tsx");

describe("loading, hidden, and error are three different truths", () => {
  it("the machine and the status split are pinned", () => {
    expect(src).toContain('type State = "loading" | "ready" | "hidden" | "error";');
    expect(src).toContain("if (res.status === 403 || res.status === 404) {");
    expect(src).toContain('data-testid="stream-summary-loading"');
    expect(src).toContain("Loading your stream summary…");
  });
});
