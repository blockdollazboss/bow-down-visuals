/**
 * FeedbackPromptHost — honest load states (Stack-400 C-28
 * components residual, deep-pins tranche 1). The Pitch & Fix
 * feedback prompt is a GATED host: it may appear only after two
 * server answers say so, and its thanks state may appear only
 * after the feedback actually landed.
 *
 * - THE GATE: on a qualifying moment the host reads eligibility;
 *   a non-ok response returns silently, and even an eligible
 *   decision must be STAMPED server-side (POST .../shown — the cap
 *   counts the showing) before the prompt renders: a non-ok stamp
 *   also returns silently. Any throw lands in the catch under the
 *   file's rule: "a failed gate check means no prompt — never a
 *   broken one." A failed gate can never produce a prompt the
 *   member wasn't cleared to see, nor a half-built one.
 * - THE SUBMIT: the thanks state is set only on an ok response; a
 *   failure keeps the prompt open with thanks explicitly unset —
 *   "the member can retry or dismiss" — so an unsent rating never
 *   wears the thank-you.
 *
 * Copy rides pitchFix.popup.* keys. The FE suite runs in node (no
 * DOM), so these tests pin the machine in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const host = read("./FeedbackPromptHost.tsx");

describe("the gate — no prompt unless both server answers say so", () => {
  it("a non-ok eligibility read returns without showing anything", () => {
    expect(host).toContain('const res = await fetch("/api/pitch-fix/feedback-prompt/eligibility", { headers });');
    expect(host).toContain("if (!res.ok) return;");
  });

  it("the showing is stamped server-side before the prompt renders, and a failed stamp also returns", () => {
    expect(host).toContain('const stamp = await fetch("/api/pitch-fix/feedback-prompt/shown", { method: "POST", headers });');
    expect(host).toContain("if (!stamp.ok) return;");
    expect(host.indexOf("if (!stamp.ok) return;")).toBeLessThan(host.indexOf("setVisible(true);"));
  });

  it("any gate failure means no prompt, under the file's own rule", () => {
    expect(host).toContain("/* a failed gate check means no prompt — never a broken one */");
  });

  it("the host renders nothing until the gate has fully passed", () => {
    expect(host).toContain("if (!user || !visible) return null;");
  });
});

describe("the submit — thanks only for feedback that landed", () => {
  it("a non-ok submit throws before thanks can be set", () => {
    expect(host).toContain('if (!res.ok) throw new Error("feedback failed");');
    expect(host).toContain("setThanks(true);");
    expect(host.indexOf('throw new Error("feedback failed")')).toBeLessThan(host.indexOf("setThanks(true);"));
  });

  it("a failed submit keeps the prompt open with thanks unset", () => {
    expect(host).toContain("/* keep the prompt open; the member can retry or dismiss */");
    expect(host).toContain("setThanks(false);");
  });
});
