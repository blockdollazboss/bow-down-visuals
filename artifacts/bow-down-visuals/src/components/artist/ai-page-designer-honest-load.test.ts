/**
 * AiPageDesigner — honest load standard (deep-pins tranche 4,
 * batch C). Three paid confirmed flows (theme design, bio,
 * banner) share one shape: a decline returns with nothing set
 * and nothing applied; a non-ok answer — a 402 included, there
 * is no separate out-of-credits branch — throws into an error
 * toast BEFORE any success state, so a failed charge can never
 * become a design, a bio draft, or a banner; success state is
 * set only from the ok answer. Preview-before-apply is real:
 * generate only stores the design locally and moves to the
 * reveal step — the profile changes solely in applyDesign,
 * which itself refuses to run without a design. The two free
 * reads are honest enhancements: the vertical hint is set only
 * when the payload carries a tip for the chosen vertical (a
 * failed read is swallowed and claims nothing), and the palette
 * is set only from a successful client-side extraction — a
 * failure is a toast and the palette stays as it was.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./ai-page-designer.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("generate — the design is set only from an ok answer, and apply is separate", () => {
  const body = slice(src, "async function generate(regen = false) {", "function applyDesign() {");

  it("a short vibe is refused before any fetch; a decline returns with nothing set", () => {
    expect(body).toContain("if (vibe.trim().length < 10) {");
    expect(body).toContain("if (!res) return; /* credit confirmation dismissed */");
  });

  it("non-ok throws before setDesign; the reveal step follows the set", () => {
    expect(body).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, "Design failed"));');
    expect(body.indexOf("setDesign({ themeConfig: data.themeConfig, sections: data.sections, rationale: data.rationale });")).toBeGreaterThan(
      body.indexOf("if (!res.ok) throw"),
    );
    expect(body.indexOf("setStep(3);")).toBeGreaterThan(body.indexOf("setDesign({"));
    expect(body).toContain('toast({ title: "The designer stumbled"');
  });

  it("applyDesign refuses without a design and is the only design-to-profile door", () => {
    const apply = slice(src, "function applyDesign() {", "async function writeBio() {");
    expect(apply).toContain("if (!design) return;");
    expect(apply).toContain("theme_config: design.themeConfig,");
    expect(apply).toContain("designedAt: new Date().toISOString(),");
  });
});

describe("bio + banner — same checked shape", () => {
  it("the bio draft is set only after the ok check", () => {
    const body = slice(src, "async function writeBio() {", "async function generateBanner() {");
    expect(body).toContain("if (!res) return; /* credit confirmation dismissed */");
    expect(body).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, "Bio failed"));');
    expect(body.indexOf("setBioDraft(data.bio);")).toBeGreaterThan(body.indexOf("if (!res.ok) throw"));
  });

  it("the banner is applied only after the ok check; the landed toast follows the apply", () => {
    const body = slice(src, "async function generateBanner() {", "const previewProfile");
    expect(body).toContain("if (!res) return; /* credit confirmation dismissed */");
    expect(body).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, "Banner failed"));');
    expect(body.indexOf("onApply({ banner_url: data.url });")).toBeGreaterThan(body.indexOf("if (!res.ok) throw"));
    expect(body.indexOf('toast({ title: "Banner landed"')).toBeGreaterThan(body.indexOf("onApply({ banner_url: data.url });"));
  });
});

describe("the free reads — enhancements that claim nothing on failure", () => {
  it("the vertical hint is set only when the payload carries a tip for this vertical", () => {
    const body = slice(src, "fetch(`/api/ai-page-designer/vertical-hints?vertical=${vertical}`)", "}, [vertical]);");
    expect(body).toContain("const v = (j.verticals ?? []).find((x: { id: string }) => x.id === vertical);");
    expect(body).toContain("if (v?.tip) setHint(v.tip);");
    expect(body).toContain(".catch(() => undefined);");
  });

  it("the palette is set only from a successful extraction; failure is a toast", () => {
    const body = slice(src, "async function samplePalette() {", "function applyStarterTemplate() {");
    expect(body).toContain('toast({ title: "No art to sample yet"');
    expect(body.indexOf("setPalette(colors);")).toBeGreaterThan(body.indexOf("const colors = await extractPalette(art, 5);"));
    expect(body).toContain('toast({ title: "Couldn\'t sample that image"');
    expect(body).toContain("setPaletteLoading(false);");
  });
});
