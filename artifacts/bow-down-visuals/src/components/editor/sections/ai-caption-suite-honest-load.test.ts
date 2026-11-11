/**
 * AiCaptionSuite (the editor's caption suite) — honest load
 * classification (Stack-400 C-28 components residual,
 * deep-pins tranche 2). The suite is a generation surface; its
 * one read is the transcription capability probe, and its shape
 * is deliberate:
 *
 * - THE PROBE fails OPEN, and says why by its placement: the
 *   keyReady flag exists only to show the "not set up" warning,
 *   and the warning appears only on a PROVEN not-ready (an
 *   answer that parses with ready === false). A declined
 *   confirmation, a thrown probe, or a payload without the
 *   field all leave the suite open — because the truth is
 *   enforced where it costs something: the priced generate
 *   call itself, whose failure lands in the suite's generation
 *   error states. No data is fabricated and no load is claimed;
 *   contrast the fail-closed gates (PhotoBenches), where the
 *   probe guards a bench that would otherwise present a dead
 *   tool as ready — here the generate call IS the guard.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const suite = read("./AiCaptionSuite.tsx");

describe("the capability probe: the warning shows only on a proven not-ready", () => {
  it("keyReady records the payload's proven answer; uncertainty leaves the suite open", () => {
    expect(suite).toContain('const res = await confirmedFetch("/api/auto-captions/info", { skipConfirm: true });');
    expect(suite).toContain("setKeyReady(data.ready ?? true);");
    expect(suite).toContain("if (!cancelled) setKeyReady(true);");
    expect(suite).toContain("Check whether the server can transcribe (honest key-missing state)");
  });
});
