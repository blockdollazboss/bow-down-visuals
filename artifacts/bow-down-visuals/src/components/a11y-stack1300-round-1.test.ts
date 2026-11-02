/**
 * a11y-stack1300-round-1.test.ts — Stack1300 a11y lane, round 1:
 * the CORE member flows (auth, Create desks' main panels, the embedded
 * checkout panels stack1200 shipped, the World station panels' frame,
 * global chrome). Rounds before this one (a11y-sweep, a11y-round-2,
 * a11y-editor-panels) covered the 2D site tree-wide but EXCLUDED the
 * World tree and predate stack1200's surfaces; this suite pins what
 * round 1 convicted and fixed, plus the frame contracts it acquitted
 * so they cannot silently regress.
 *
 * Fixes pinned here (all names/states/keyboard only — no visual change):
 *  F1 live-shopping's out-of-credits overlay was a modal in shape only
 *     (fixed, backdrop, page-blocking) with no dialog contract.
 *  F2 the editor's Lip Sync Result Preview modal — same shape, same gap.
 *  F3 the clip-generator card header was the only clip-select path and
 *     a plain clickable div: no keyboard path, no state.
 *  F4 the World's room-chat ("say") input was placeholder-only; the
 *     World tree sits outside round-2's label scanner.
 *
 * Ledger resolution pinned here: board items B-1 (#72, editor tool
 * panels' unlabelled-input sweep) and B-3 (#74, Radix dialogs focus
 * trap/return audit) are DEFINED by the stack29-wave3 board lines and
 * were built by the stack200 orphan lane + stack800 lane 5 — the two
 * defining artifacts (the editor-panels audit suite and Sheet's
 * opener-capture focus return) are pinned below so the resolution is
 * verifiable on this tree, not folklore.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const SRC = new URL("../", import.meta.url);

function worldSources(): { rel: string; src: string }[] {
  const out: { rel: string; src: string }[] = [];
  const walk = (dir: URL, prefix: string) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        walk(new URL(`${ent.name}/`, dir), `${prefix}${ent.name}/`);
      } else if (ent.name.endsWith(".tsx") && !ent.name.endsWith(".test.tsx")) {
        out.push({ rel: `${prefix}${ent.name}`, src: readFileSync(new URL(ent.name, dir), "utf8") });
      }
    }
  };
  walk(new URL("world/", new URL("components/", SRC)), "components/world/");
  out.push({ rel: "pages/world.tsx", src: read("../pages/world.tsx") });
  return out;
}

describe("F1 — live-shopping out-of-credits overlay carries the dialog contract", () => {
  const page = read("../pages/live-shopping.tsx");
  it("routes the overlay through useModalA11y", () => {
    expect(page).toContain("useModalA11y");
    expect(page).toContain("outOfCreditsDialogRef = useModalA11y");
  });
  it("the overlay element is a labelled modal dialog", () => {
    const at = page.indexOf("outOfCredits &&");
    const overlay = page.slice(at, at + 700);
    expect(overlay).toContain("ref={outOfCreditsDialogRef}");
    expect(overlay).toContain('role="dialog"');
    expect(overlay).toContain('aria-modal="true"');
    expect(overlay).toContain("tabIndex={-1}");
    expect(overlay).toContain('aria-label={t("outOfCredits.title")}');
  });
});

describe("F2 — Lip Sync Result Preview modal carries the dialog contract", () => {
  const section = read("./editor/sections/LipSyncSection.tsx");
  it("routes the preview modal through useModalA11y", () => {
    expect(section).toContain("useModalA11y");
    expect(section).toContain("previewDialogRef = useModalA11y");
  });
  it("the preview overlay is a labelled modal dialog", () => {
    const at = section.indexOf("Lip Sync Preview Modal");
    const overlay = section.slice(at, at + 900);
    expect(overlay).toContain("ref={previewDialogRef}");
    expect(overlay).toContain('role="dialog"');
    expect(overlay).toContain('aria-modal="true"');
    expect(overlay).toContain('aria-label="Lip Sync Result Preview"');
    expect(overlay).toContain("tabIndex={-1}");
  });
});

describe("F3 — clip-generator card header is keyboard-operable", () => {
  const section = read("./editor/sections/ClipGeneratorSection.tsx");
  it("the select header is a named, state-exposing button surface", () => {
    const at = section.indexOf("Header — click to select");
    const header = section.slice(at, at + 1100);
    expect(header).toContain('role="button"');
    expect(header).toContain("tabIndex={0}");
    expect(header).toContain("aria-pressed={isSelected}");
    expect(header).toContain("Select clip ${index + 1} for insert positioning");
  });
  it("Enter and Space fire the same onSelect the click fires", () => {
    const at = section.indexOf("Header — click to select");
    const header = section.slice(at, at + 1100);
    expect(header).toContain("onKeyDown");
    expect(header).toContain('e.key === "Enter"');
    expect(header).toContain('e.key === " "');
    expect(header).toContain("onSelect()");
    expect(header).toContain("e.target !== e.currentTarget");
  });
});

describe("F4 — the World say input has an accessible name", () => {
  const world = read("../pages/world.tsx");
  it("the room-chat input is labelled, not placeholder-only", () => {
    const at = world.indexOf('data-testid="world-say-input"');
    const input = world.slice(Math.max(0, at - 700), at);
    expect(input).toContain('aria-label="Say something to the room"');
  });
  it("its submit neighbour stays named (pairing intact)", () => {
    expect(world).toContain('aria-label="Send to the room"');
  });
});

describe("World frame contracts (acquitted in round 1 — pinned so they hold)", () => {
  const panel = read("./world/StationPanel.tsx");
  it("the station sheet is an honestly modeless dialog: labelled, named close, Escape closes", () => {
    expect(panel).toContain('role="dialog"');
    expect(panel).toContain("aria-label={name}");
    expect(panel).toContain("aria-label={`Close ${name}`}");
    expect(panel).toContain('e.key === "Escape"');
    /* Modeless by design (the room stays live behind the sheet): it
       must never CLAIM modal semantics it does not implement. */
    expect(panel).not.toContain("aria-modal");
  });
  it("no focus suppression can hide keyboard focus anywhere in the World tree", { timeout: 30_000 }, () => {
    /* The site-wide unlayered :focus-visible gold outline (index.css,
       pinned by a11y-round-2 for the 2D tree) covers the World too —
       unless a surface suppresses outline with an important utility,
       an arbitrary property, or an inline style. Class-based
       outline-none loses to the unlayered rule and is not suppression. */
    const offenders: string[] = [];
    for (const { rel, src } of worldSources()) {
      if (/outline-none!|\[outline:\s*none\]|outline:\s*["']none["']|outlineStyle/.test(src)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("B-1 / B-3 ledger resolution — the defining artifacts stand on this tree", () => {
  it("B-3: Sheet captures its opener and returns focus on close (ui/sheet.tsx)", () => {
    const sheet = read("./ui/sheet.tsx");
    expect(sheet).toContain("openerRef");
    expect(sheet).toContain("onCloseAutoFocus={(event)");
  });
  it("B-1: the editor-panels audit suite is in the tree under its B-1/B-3 header", () => {
    const audit = read("./editor/a11y-editor-panels.test.ts");
    expect(audit).toContain("a11y B-1 #72 + B-3 #74");
  });
  it("B-1 keyboard half: the TimelineSection playhead is a real slider", () => {
    const timeline = read("./editor/sections/TimelineSection.tsx");
    expect(timeline).toContain('role="slider"');
  });
});
