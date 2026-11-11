/**
 * AiAutoMix — honest load standard (deep-pins tranche 5).
 * No mount list load exists here — the plan is props-driven
 * — so the pinned surface is the paid generate: a cancelled
 * credit confirmation returns silently; a non-ok response
 * throws the server's words BEFORE onChange can apply a
 * plan; the applied plan and the "Mix Plan ready" toast are
 * built only from a real response body; out_of_credits is
 * its own ending (panel + balance refresh), never a generic
 * failure toast. The render flow beside it follows the same
 * law: no token is an error, never a fake render.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./AiAutoMix.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("generate — the plan applies only from a checked response", () => {
  it("cancel silent; !ok throws before onChange; the ready toast is built from the real plan", () => {
    const body = slice(src, "async function handleGenerate() {", "return (");
    expect(body).toContain("if (!res) return; /* user cancelled the credit confirmation */");
    expect(body).toContain("if (!res.ok) {");
    expect(body).toContain('throw new Error(apiThrowMessage(err, "Mix plan failed"));');
    expect(body).toContain("const generatedPlan = (await res.json()) as AiMixPlan;");
    expect(body).toContain("onChange({ ...settings, musicStudio: { ...ms, aiMix: opts, aiMixPlan: generatedPlan } });");
    expect(body.indexOf("if (!res.ok) {")).toBeLessThan(body.indexOf("const generatedPlan = (await res.json()) as AiMixPlan;"));
    expect(body.indexOf("const generatedPlan = (await res.json()) as AiMixPlan;")).toBeLessThan(
      body.indexOf("onChange({ ...settings, musicStudio:"),
    );
    // the toast distinguishes a real AI plan from the offline fallback — neither is faked
    expect(body).toContain('generatedPlan.fallback\n          ? "Generated an offline plan — AI was unavailable."');
  });

  it("out_of_credits is its own ending; other failures toast the server's words", () => {
    const body = slice(src, "async function handleGenerate() {", "return (");
    const catchPart = slice(body, "} catch (err) {", "} finally {");
    expect(catchPart).toContain('if (msg === "out_of_credits") {');
    expect(catchPart).toContain("setOutOfCredits(true);");
    expect(catchPart).toContain("refreshProfile();");
    expect(catchPart).toContain('toast({ title: "Mix plan failed", description: msg, variant: "destructive" });');
    expect(catchPart).not.toContain("onChange");
  });
});

describe("the render beside it — same law", () => {
  it("no token throws a sign-in error instead of rendering", () => {
    expect(src).toContain('if (!token) throw new Error("You need to be signed in to render audio.");');
  });
});
