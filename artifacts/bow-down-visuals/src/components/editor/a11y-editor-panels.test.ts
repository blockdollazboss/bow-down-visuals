/**
 * a11y-editor-panels.test.ts — Stack-200 orphan lane (a11y B-1 #72 + B-3 #74).
 *
 * B-1: the editor tool panels (67 .tsx files under components/editor +
 * components/video-editor) carried the unlabelled-input pattern the wave-3
 * sweep boarded as its own lane: placeholder-only / label-unassociated
 * inputs, selects and textareas with no accessible name, toggle/picker
 * buttons with no state, and pointer-only seek/place surfaces. This test
 * re-runs that audit as a scanner: every form control in those trees must
 * carry a name (aria-label / aria-labelledby / htmlFor+id pair / <label>
 * wrap), with the only exemptions being aria-hidden hidden file inputs.
 * Editor look is untouched — names, states and keyboard only.
 *
 * B-3: the app's only Radix Dialog surface is ui/sheet.tsx (Sheet), used
 * controlled (open + onOpenChange) with NO SheetTrigger anywhere. Radix's
 * default onCloseAutoFocus focuses context.triggerRef (null here) after
 * preventDefault — which also suppresses FocusScope's restore fallback —
 * so closing a sheet dropped focus to <body>. SheetContent now captures
 * the opener when its DOM mounts and returns focus to it on close.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

function panelSources(): { rel: string; src: string }[] {
  const out: { rel: string; src: string }[] = [];
  const walk = (dirUrl: URL, prefix: string) => {
    for (const ent of readdirSync(dirUrl, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        walk(new URL(`${ent.name}/`, dirUrl), `${prefix}${ent.name}/`);
      } else if (ent.name.endsWith(".tsx") && !ent.name.endsWith(".test.tsx")) {
        out.push({ rel: `${prefix}${ent.name}`, src: readFileSync(new URL(ent.name, dirUrl), "utf8") });
      }
    }
  };
  walk(new URL("./", import.meta.url), "editor/");
  walk(new URL("../video-editor/", import.meta.url), "video-editor/");
  return out;
}

/** Opening-tag end index, tracking quotes and brace depth like a JSX lexer. */
function tagEnd(s: string, i: number): number {
  let depth = 0;
  let quote: string | null = null;
  while (i < s.length) {
    const c = s[i]!;
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) break;
    i++;
  }
  return i;
}

// Only line-start block comments and JSX comments — a naive strip would
// eat string contents like accept="video/*".
const stripBlockComments = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, "");
const normId = (s: string) => s.replace(/[`$\\{}]/g, "").replace(/\s+/g, "");

function unlabelledControls(src: string): string[] {
  const s = stripBlockComments(src);
  const wraps: [number, number][] = [];
  for (const m of s.matchAll(/<label\b[^>]*>/g)) {
    const end = s.indexOf("</label>", m.index + m[0].length);
    if (end !== -1) wraps.push([m.index, end]);
  }
  const htmlFors = new Set([...s.matchAll(/htmlFor=(?:"([^"]+)"|\{`([^`]+)`\}|\{"([^"]+)"\})/g)].map((m) => normId(m[1] ?? m[2] ?? m[3] ?? "")));
  const bad: string[] = [];
  for (const m of s.matchAll(/<(input|select|textarea)\b/g)) {
    const end = tagEnd(s, m.index + m[0].length);
    const tag = s.slice(m.index, end + 1);
    if (tag.includes("aria-label") || tag.includes("aria-labelledby") || tag.includes("aria-hidden")) continue;
    if (tag.includes('type="hidden"')) continue;
    const idm = tag.match(/\bid=(?:"([^"]+)"|\{`([^`]+)`\}|\{"([^"]+)"\})/);
    if (idm && htmlFors.has(normId(idm[1] ?? idm[2] ?? idm[3] ?? ""))) continue;
    if (wraps.some(([a, b]) => a <= m.index && m.index <= b)) continue;
    bad.push(tag.replace(/\s+/g, " ").slice(0, 110));
  }
  return bad;
}

describe("B-1 — every editor-panel form control has an accessible name", () => {
  const panels = panelSources();
  it("the sweep covers the full panel tree (67 files at audit time)", () => {
    expect(panels.length).toBeGreaterThanOrEqual(60);
  });
  it("no input/select/textarea is unlabelled", () => {
    const offenders: string[] = [];
    for (const { rel, src } of panels) {
      for (const tag of unlabelledControls(src)) offenders.push(`${rel}: ${tag}`);
    }
    expect(offenders).toEqual([]);
  });
});

describe("B-1 — shared editor primitives carry names and states", () => {
  const controls = read("./controls.tsx");
  const shared = read("./sections/shared.tsx");
  it("Field lends its visible label to a single unnamed control", () => {
    expect(controls).toContain('cloneElement(only, { "aria-label": label }');
  });
  it("TextInput names itself from aria-label or its placeholder; Dropdown accepts aria-label", () => {
    expect(controls).toContain("aria-label={ariaLabel ?? placeholder}");
    expect(controls).toContain("aria-label={ariaLabel}");
  });
  it("Chip and Segmented expose pressed state; Collapsible exposes expanded state", () => {
    expect(controls).toContain("aria-pressed={active}");
    expect(controls).toContain("aria-pressed={value === opt.value}");
    expect(controls).toContain("aria-expanded={open}");
    expect(controls).toContain("aria-controls={panelId}");
  });
  it("IconBtn is named by its title, not title-only", () => {
    expect(shared).toContain("aria-label={title}");
  });
  it("toggle/picker buttons across the panels expose aria-pressed", () => {
    let count = 0;
    for (const { src } of panelSources()) count += src.split("aria-pressed").length - 1;
    expect(count).toBeGreaterThanOrEqual(70);
  });
});

describe("B-1 — pointer-only surfaces gained keyboard paths", () => {
  it("TimelineSection playhead strip is a keyboard slider", () => {
    const s = read("./sections/TimelineSection.tsx");
    expect(s).toContain('role="slider"');
    expect(s).toContain('aria-label="Seek the master player"');
    expect(s).toContain('e.key === "ArrowRight"');
    expect(s).toContain('e.key === "Home"');
  });
  it("Keyframes track adds a keyframe from the keyboard at the playhead", () => {
    const s = read("./sections/KeyframesSection.tsx");
    expect(s).toContain('data-testid="keyframes-track"');
    expect(s).toContain('e.key !== "Enter" && e.key !== " "');
  });
  it("MotionTrack subject picker nudges the box with arrow keys", () => {
    const s = read("./sections/MotionTrackCard.tsx");
    expect(s).toContain('data-testid="motion-track-picker"');
    expect(s).toContain('e.key === "ArrowLeft"');
    expect(s).toContain("setBoxX(");
    expect(s).toContain("setBoxY(");
  });
});

/**
 * B-1 round 2 (stack800 lane 5) — the control classes the round-1 tag
 * scanner could not see. Round 1 scanned literal <input>/<select>/
 * <textarea> tags; the panels also carry Radix <Slider>/<Switch>
 * controls and icon-only <button>s, which round 1 never enumerated.
 * The census this scanner produced on the joined tree (Oct 29):
 *  - 26 <Slider> usages, ALL single-child-wrapped in <Field>, whose
 *    cloneElement lends aria-label onto the Slider — but ui/slider.tsx
 *    spread props onto Radix's Root span, so the focusable Thumb
 *    (role="slider") never received the name. One mechanism fix in
 *    ui/slider.tsx (forward aria-label/labelledby to the Thumb) names
 *    every one of them with its visible Field label.
 *  - 13 <Switch> usages whose visible label is a sibling <p> — never
 *    programmatically associated with the Radix button — plus the
 *    AiCaptionSuite emoji switch, whose <Field> lends its label to a
 *    wrapper <div> (ignored by AT, as Field's own comment warns).
 *  - 13 icon-only / title-only <button> sites (zoom, delete, dismiss,
 *    timeline markers, colour swatches) with no accessible name.
 *  - LipSyncSection's local Toggle rendered its label as content but
 *    exposed no switch state; its "Use Lip Sync Result" switch button
 *    had neither name nor state.
 * The scans below are heuristic source censuses in the same spirit as
 * round 1: they fail if any of these classes regresses.
 */

/** Spans of <Field>…</Field> blocks (Fields do not nest in these trees). */
function fieldSpans(s: string): [number, number][] {
  const spans: [number, number][] = [];
  const stack: number[] = [];
  for (const m of s.matchAll(/<Field\b|<\/Field>/g)) {
    if (m[0].startsWith("</")) {
      const start = stack.pop();
      if (start !== undefined) spans.push([start, m.index + m[0].length]);
    } else stack.push(m.index);
  }
  return spans;
}

/** End index (exclusive) of the JSX element whose opening tag ends at `from`. */
function elementEnd(s: string, from: number, tag: string): number {
  let depth = 1;
  const re = new RegExp(`<${tag}\\b|</${tag}>`, "g");
  re.lastIndex = from;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m[0].startsWith("</")) {
      depth--;
      if (depth === 0) return m.index + m[0].length;
    } else {
      const e = tagEnd(s, m.index + m[0].length);
      if (s[e - 1] !== "/") depth++;
      re.lastIndex = e + 1;
    }
  }
  return s.length;
}

/**
 * True when the element at `idx` is the ONLY child element of a <Field>
 * — the one case where Field's cloneElement lends the field's label
 * directly onto the control (see controls.tsx Field).
 */
function fieldLent(s: string, idx: number, elEnd: number): boolean {
  for (const [a, b] of fieldSpans(s)) {
    if (!(a <= idx && elEnd <= b)) continue;
    const openEnd = tagEnd(s, a + "<Field".length);
    const before = s.slice(openEnd + 1, idx);
    const after = s.slice(elEnd, b - "</Field>".length);
    if (/[^\s]/.test(before) || /[^\s]/.test(after)) return false;
    return true;
  }
  return false;
}

/** Visible-text test for button content: real words/numbers or any
 *  expression that renders a value ({f}, {label}, {t("…")}); icon-only
 *  content (elements + whitespace + symbol glyphs) fails. */
function hasRenderableText(inner: string): boolean {
  const stripped = inner.replace(/<[^>]*>/g, " ");
  if (/[\p{L}\p{N}]/u.test(stripped)) return true;
  return /\{[^{}]*[A-Za-z_$][^{}]*\}/.test(stripped);
}

function unnamedPrimitives(src: string): string[] {
  const s = stripBlockComments(src);
  const bad: string[] = [];
  for (const m of s.matchAll(/<(Slider|Switch)\b/g)) {
    const end = tagEnd(s, m.index + m[0].length);
    const tag = s.slice(m.index, end + 1);
    if (tag.includes("aria-label") || tag.includes("aria-labelledby")) continue;
    if (fieldLent(s, m.index, end + 1)) continue;
    bad.push(tag.replace(/\s+/g, " ").slice(0, 110));
  }
  return bad;
}

function unnamedButtons(src: string): string[] {
  const s = stripBlockComments(src);
  const bad: string[] = [];
  for (const m of s.matchAll(/<button\b/g)) {
    const end = tagEnd(s, m.index + m[0].length);
    const tag = s.slice(m.index, end + 1);
    if (tag.includes("aria-label") || tag.includes("aria-labelledby")) continue;
    if (tag.endsWith("/>")) {
      bad.push(tag.replace(/\s+/g, " ").slice(0, 110));
      continue;
    }
    const elEnd = elementEnd(s, end + 1, "button");
    if (fieldLent(s, m.index, elEnd)) continue;
    const inner = s.slice(end + 1, elEnd - "</button>".length);
    if (!hasRenderableText(inner)) bad.push(tag.replace(/\s+/g, " ").slice(0, 110));
  }
  return bad;
}

describe("B-1 round 2 — Radix sliders/switches and icon buttons carry names", () => {
  it("no <Slider>/<Switch> in the editor trees is unnamed (tag aria or Field-lent)", () => {
    const offenders: string[] = [];
    for (const { rel, src } of panelSources()) {
      for (const tag of unnamedPrimitives(src)) offenders.push(`${rel}: ${tag}`);
    }
    expect(offenders).toEqual([]);
  });
  it("no icon-only <button> in the editor trees lacks an accessible name", () => {
    const offenders: string[] = [];
    for (const { rel, src } of panelSources()) {
      for (const tag of unnamedButtons(src)) offenders.push(`${rel}: ${tag}`);
    }
    expect(offenders).toEqual([]);
  });
  it("ui/slider forwards aria-label/labelledby to the focusable Thumb, not just the Root span", () => {
    const slider = read("../ui/slider.tsx");
    expect(slider).toContain('"aria-label": ariaLabel');
    expect(slider).toContain("aria-label={ariaLabel}");
    expect(slider).toContain("aria-labelledby={ariaLabelledBy}");
    expect(slider).toContain("<SliderPrimitive.Thumb");
  });
  it("LipSyncSection's Toggle exposes switch state and its result switch is named + stated", () => {
    const s = read("./sections/LipSyncSection.tsx");
    expect(s).toContain('role="switch"');
    expect(s).toContain("aria-checked={value}");
    expect(s).toContain('aria-label="Use Lip Sync Result"');
    expect(s).toContain("aria-checked={selectedClipEdit.useLipSync}");
  });
  it("the round-2 named sites stay named (spot pins)", () => {
    expect(read("./TimelineDock.tsx")).toContain('aria-label="Zoom out"');
    expect(read("./TimelineDock.tsx")).toContain('aria-label="Zoom in"');
    expect(read("./sections/BrandingSection.tsx")).toContain('aria-label="Remove custom logo"');
    expect(read("./sections/BrandingSection.tsx")).toContain('aria-label="Enable Watermark"');
    expect(read("./sections/CaptionsSection.tsx")).toContain("aria-label={label}");
    expect(read("./sections/CaptionsSection.tsx")).toContain('aria-label="Show Caption Safe Area"');
    expect(read("./sections/CaptionsSection.tsx")).toContain('aria-label="Delete caption line"');
    expect(read("./sections/AiCaptionSuite.tsx")).toContain('aria-label={t("captionSuite.emojiLabel")}');
    expect(read("./sections/AiCaptionSuite.tsx")).toContain('aria-label={t("captionSuite.endCardLabel")}');
    expect(read("./music/AiAutoMix.tsx")).toContain('aria-label="Clean radio mode"');
    expect(read("./sections/BeatSyncSection.tsx")).toContain("aria-label={t(`${ns}.markerSeek`");
    expect(read("./sections/KeyframesSection.tsx")).toContain("aria-label={`${k.time.toFixed(2)}s keyframe");
    expect(read("./sections/MotionGraphicsSection.tsx")).toContain("aria-label={c}");
    expect(read("./sections/ProToolsSection.tsx")).toContain("aria-label={c}");
    expect(read("./sections/MotionTrackCard.tsx")).toContain("aria-label={`Remove anchor at ${a.t.toFixed(1)}s`}");
    expect(read("./sections/PreProductionSection.tsx")).toContain('aria-label="Remove"');
    expect(read("./sections/StudioEditorSection.tsx")).toContain('aria-label="Clear selection"');
    expect(read("./sections/LipSyncSection.tsx")).toContain('aria-label="Dismiss"');
  });
});

describe("B-3 — Radix dialogs (Sheet) trap and return focus", () => {
  const sheet = read("../ui/sheet.tsx");
  const editorPage = read("../../pages/video-editor.tsx");
  const sidebar = read("../ui/sidebar.tsx");
  it("the app has no SheetTrigger — every Sheet is controlled, so Radix's trigger-based focus return cannot work unaided", () => {
    expect(editorPage).toContain("<Sheet open={mobileSheetOpen} onOpenChange={setMobileSheetOpen}>");
    expect(sidebar).toContain("<Sheet open={openMobile} onOpenChange={setOpenMobile}");
    expect(editorPage).not.toContain("SheetTrigger");
    expect(sidebar).not.toContain("SheetTrigger");
  });
  it("SheetContent captures the opener at mount and returns focus to it on close", () => {
    expect(sheet).toContain("openerRef");
    expect(sheet).toContain("onCloseAutoFocus={(event) => {");
    expect(sheet).toContain("opener.focus()");
    expect(sheet).toContain("document.contains(opener)");
    // a caller-supplied onCloseAutoFocus still wins
    expect(sheet).toContain("if (onCloseAutoFocus) {");
  });
  it("both sheets keep their Radix Title + Description (no unnamed-dialog warnings)", () => {
    expect(editorPage).toContain("<SheetTitle");
    expect(editorPage).toContain("<SheetDescription");
    expect(sidebar).toContain("<SheetTitle>Sidebar</SheetTitle>");
    expect(sidebar).toContain("<SheetDescription>");
  });
  it("the hand-rolled-dialog hook contract is unchanged (trap/escape/return)", () => {
    const hook = read("../../hooks/use-modal-a11y.ts");
    expect(hook).toContain("previouslyFocused.focus()");
    expect(hook).toContain('e.key === "Escape"');
  });
});
