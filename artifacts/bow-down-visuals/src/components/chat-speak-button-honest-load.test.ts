/**
 * ChatSpeakButton (hear a chat reply spoken) — honest action
 * states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * A four-state machine (idle | loading | playing | error)
 * with an honest pre-state: the "casting" view is a plainly
 * not-ready chip ("his voice is still being cast") that no
 * one can tap into a charge. The speak call itself:
 * - a cancelled spend confirmation (null result) returns to
 *   idle — no request, no charge, nothing claimed;
 * - the audio url is cached ONLY from a proven result, and
 *   replay from that cache is local and free (documented in
 *   the source — a replay never re-charges);
 * - a failure lands on the error state with the note routed
 *   through the house error-note mapper.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./ChatSpeakButton.tsx");

describe("the speak call separates cancel, success, failure", () => {
  it("a cancelled confirmation returns to idle claiming nothing", () => {
    expect(src).toContain("if (result === null) {");
    expect(src).toContain("/* Spend confirmation cancelled — no request, no charge. */");
    expect(src).toContain('setState("idle");');
  });

  it("the url is cached only from a proven result; failure lands on the error state", () => {
    expect(src).toContain("urlRef.current = result.audioPlayUrl;");
    expect(src).toContain("/* Already synthesized once — replay is local and free. */");
    expect(src).toContain('setState("error");');
    expect(src).toContain('type SpeakState = "idle" | "loading" | "playing" | "error";');
  });
});
