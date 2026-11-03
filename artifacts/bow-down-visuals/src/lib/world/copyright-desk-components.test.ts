/**
 * copyright-desk-components — stack1500 world parity wave #3
 * item 23 source-contract pins. The Copyright desk must sit
 * in the Get Paid board stack as a ({ isLight, isGuest })
 * desk with the house GuestGate, with:
 * - the draft form (work-type chips, the schema's fields,
 *   the published gate) and the ask thread in-panel, both
 *   riding the confirmed-spend seam at the registry prices
 *   with a decline running nothing and a 402 landing in the
 *   out-of-Bucs state;
 * - the draft rendered whole (description + filing notes);
 * - the page's disclaimer verbatim at the foot and NO DMCA
 *   intake (that public form stays a website surface);
 * - light/dark parity via the desk's isLight branches.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("../../components/world/native/CopyrightDesk.tsx");
const panel = read("../../components/world/StationPanel.tsx");

describe("the desk shape + the Get Paid mount", () => {
  it("is a named ({ isLight, isGuest }) desk rooted at its testid, guests gated", () => {
    expect(desk).toContain("export function CopyrightDesk({ isLight, isGuest }: { isLight: boolean; isGuest: boolean })");
    expect(desk).toContain('data-testid="world-copyright-desk"');
    expect(desk).toContain("if (isGuest) return <GuestGate isLight={isLight} />;");
    expect(desk).toContain('data-testid="world-copyright-desk-signin"');
  });

  it("StationPanel stacks it at the Get Paid board behind a DeskDoor", () => {
    expect(panel).toContain('const CopyrightDesk = lazy(() => import("@/components/world/native/CopyrightDesk")');
    expect(panel).toContain("<CopyrightDesk isLight={isLight} isGuest={isGuest} />");
  });
});

describe("the runs ride the confirmed-spend seam", () => {
  it("both rails go through confirmedFetch with registry overrides", () => {
    expect(desk).toContain("confirmedFetch(COPYRIGHT_DRAFT_PATH, {");
    expect(desk).toContain("overrideCost: COPYRIGHT_DRAFT_COST");
    expect(desk).toContain("overrideFeature: COPYRIGHT_FEATURE_DRAFT");
    expect(desk).toContain("confirmedFetch(COPYRIGHT_ASK_PATH, {");
    expect(desk).toContain("overrideCost: COPYRIGHT_ASK_COST");
    expect(desk).toContain("overrideFeature: COPYRIGHT_FEATURE_ASK");
    expect(desk).toContain("res.status === 402");
    expect(desk).toContain("Treasury");
  });

  it("the form carries the schema's fields; the draft renders whole", () => {
    for (const needle of [
      "COPYRIGHT_WORK_TYPES.map",
      'data-testid="world-copyright-desk-title"',
      'data-testid="world-copyright-desk-published"',
      'data-testid="world-copyright-desk-draft-result"',
      "draft.filingNotes.map",
      'data-testid="world-copyright-desk-thread"',
    ]) {
      expect(desk, needle).toContain(needle);
    }
  });

  it("the disclaimer sits at the foot; no DMCA intake rides along", () => {
    expect(desk).toContain('data-testid="world-copyright-desk-disclaimer"');
    expect(desk).toContain("{COPYRIGHT_DISCLAIMER}");
    expect(desk.toLowerCase()).not.toContain("dmca");
  });
});

describe("light/dark parity — theme-switched surfaces", () => {
  it("the desk branches its surfaces on isLight", () => {
    expect(desk).toContain('isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"');
    expect(desk).toContain('isLight ? "text-[#6B5B36]" : "text-white/50"');
  });
});
