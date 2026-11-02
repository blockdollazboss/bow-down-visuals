/**
 * a11y-stack1300-round-2.test.ts — Stack1300 a11y lane, round 2:
 * the WORLD DESK INTERNALS (the tree round 1's frame pass and the
 * stack900 scanners never entered) plus one checkout observation.
 *
 * Census method: the house scanners from a11y-round-2.test.ts
 * (unlabelledControls / togglesWithoutState / unnamedButtons) ported
 * verbatim below and run over components/world/** + pages/world.tsx.
 * On the round-1 tip they returned EXACTLY the flagged leftovers —
 * 87 unlabelled controls, 13 stateless toggles, 1 unnamed button —
 * which is the cross-check that the census is the flagged one.
 *
 * Fixes pinned here (names/states/keyboard only — no visual change):
 *  W1 all 87 placeholder-only / label-orphaned World desk fields now
 *     carry an aria-label in the surface's own words (the visible
 *     label's or placeholder's noun phrase; no copy invented, no
 *     money words). One helper-level fix: ShopStands' shipField
 *     forwards its placeholder as the label, covering its six
 *     address fields with one edit.
 *  W2 all 13 disclosure-shaped toggles now expose aria-expanded
 *     wired to the very state their onClick flips (round-1 F3's
 *     disclosure precedent). The Pitch & Fix mode buttons open and
 *     close their own compose forms, so they are disclosures too.
 *  W3 the census's one unnamed button — the DM composer's icon-only
 *     attach-by-link button — now carries its own title text as its
 *     aria-label (and its aria-expanded from W2).
 *  W4 the SchedulerDesk month cell was pointer-only: a non-past day
 *     is now a keyboard-operable button surface in round-1 F3's
 *     pattern (role/tabIndex/keydown, nested-chip target guard,
 *     Enter/Space fire the same compose-open the click fires). Past
 *     days stay inert, exactly as their click already was. The
 *     drag-to-move path stays pointer-only BY DESIGN (out of scope —
 *     the list below carries the same move as a plain control).
 *  C1 the embedded checkout's payment error was a plain paragraph —
 *     a screen-reader member heard nothing when a payment failed.
 *     It now carries role="alert", the house pattern for error
 *     paragraphs (HubProjectsSection, WalkInAsPicker, PurchasesPanel).
 *     Same element, same classes, same copy — zero visual change.
 *
 * Acquitted on the read (scanner-clean, deliberately untouched):
 *  fields named by a wrapping <label> or an htmlFor pair (the herald
 *  input, WinnersCircle's host form, LiveDesk's premiere when/duration,
 *  CreateDeskLeaf's label-prop design — its visible label IS the name);
 *  row-action buttons (follow / like / pin / archive) — they pass row
 *  arguments, not boolean flips, so they are actions, not toggles;
 *  SocialDesk's node/thread disclosure buttons (named-function
 *  handlers, outside the toggle scanner's shape) and SocialWave2's
 *  public-toggle (selection setter, not a flip).
 *
 * Explicitly OUT of scope, standing as they were (interaction-design
 * calls, not this lane): the clip drag-move keyboard path, the World
 * step-through z-[70] frame ruling, the coach chat focus-return
 * doctrine question.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const SRC = path.resolve(__dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), "utf8");

function worldSources(): { rel: string; src: string }[] {
  const out: { rel: string; src: string }[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".tsx") && !e.name.includes(".test.")) {
        out.push({
          rel: path.relative(SRC, p).split(path.sep).join("/"),
          src: fs.readFileSync(p, "utf8"),
        });
      }
    }
  };
  walk(path.join(SRC, "components", "world"));
  out.push({ rel: "pages/world.tsx", src: read("pages/world.tsx") });
  return out;
}

function stripBlockComments(src: string): string {
  // String-aware: a naive regex stripper eats `accept="audio/*…"`
  // attribute values as comment starts and corrupts the scan.
  let out = "";
  let i = 0;
  let quote: string | null = null;
  while (i < src.length) {
    const c = src[i];
    if (quote) {
      out += c;
      if (c === "\\") {
        out += src[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      out += c;
      i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 2;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      const end = src.indexOf("\n", i + 2);
      i = end === -1 ? src.length : end;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}
function tagEnd(s: string, i: number): number {
  let depth = 0;
  let quote: string | null = null;
  while (i < s.length) {
    const c = s[i];
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

/* ── class 3 scanner (verbatim from a11y-round-2.test.ts) ──────── */
function unlabelledControls(rawSrc: string): string[] {
  const s = stripBlockComments(rawSrc);
  const wraps: [number, number][] = [];
  for (const m of s.matchAll(/<label\b[^>]*>/g)) {
    const end = s.indexOf("</label>", m.index + m[0].length);
    if (end !== -1) wraps.push([m.index, end]);
  }
  const normId = (x: string) => x.replace(/[`$\\{}]/g, "").replace(/\s+/g, "");
  const htmlFors = new Set(
    [...s.matchAll(/htmlFor=(?:"([^"]+)"|\{`([^`]+)`\}|\{"([^"]+)"\})/g)].map((m) =>
      normId(m[1] ?? m[2] ?? m[3] ?? ""),
    ),
  );
  // Field-lending counts only for the editor's real Field component.
  const importsEditorField = /import\s*\{[^}]*\bField\b[^}]*\}\s*from\s*"[^"]*controls"/.test(s);
  const fieldSpans: [number, number][] = [];
  if (importsEditorField) {
    const stack: number[] = [];
    for (const m of s.matchAll(/<Field\b|<\/Field>/g)) {
      if (m[0].startsWith("</")) {
        const start = stack.pop();
        if (start !== undefined) fieldSpans.push([start, m.index + m[0].length]);
      } else stack.push(m.index);
    }
  }
  const bad: string[] = [];
  for (const m of s.matchAll(/<(input|select|textarea)\b/g)) {
    const end = tagEnd(s, m.index + m[0].length);
    const tag = s.slice(m.index, end + 1);
    if (/aria-label|aria-labelledby|aria-hidden/.test(tag)) continue;
    if (tag.includes('type="hidden"')) continue;
    if (/\{\.\.\./.test(tag)) continue; // spread primitive forwards props
    if (/type="file"/.test(tag) && /className="[^"]*\bhidden\b/.test(tag)) continue;
    if (/\bstyle="/.test(tag)) continue; // embed-snippet string text, not JSX
    const idm = /\bid=(?:"([^"]+)"|\{`([^`]+)`\}|\{"([^"]+)"\})/.exec(tag);
    if (idm && htmlFors.has(normId(idm[1] ?? idm[2] ?? idm[3] ?? ""))) continue;
    if (wraps.some(([a, b]) => a <= m.index && m.index <= b)) continue;
    const elEnd = tag.endsWith("/>") ? end + 1 : elementEnd(s, end + 1, m[1]);
    const lent = fieldSpans.some(([a, b]) => {
      if (!(a <= m.index && elEnd <= b)) return false;
      const openEnd = tagEnd(s, a + "<Field".length);
      return (
        !/\S/.test(s.slice(openEnd + 1, m.index)) &&
        !/\S/.test(s.slice(elEnd, b - "</Field>".length))
      );
    });
    if (lent) continue;
    bad.push(tag.replace(/\s+/g, " ").slice(0, 110));
  }
  return bad;
}

/* ── class 2 scanner (verbatim from a11y-round-2.test.ts) ──────── */
function hasRenderableText(inner: string): boolean {
  const text = inner.replace(/<[^>]*>/g, " ");
  if (/[A-Za-z0-9]/.test(text)) return true;
  for (const m of inner.matchAll(/\{([^{}]*)\}/g)) {
    if (/[A-Za-z_$][\w$.[\]'"]*/.test(m[1])) return true;
  }
  return false;
}
function unnamedButtons(rawSrc: string): string[] {
  const s = stripBlockComments(rawSrc);
  const hiddenSpans: [number, number][] = [];
  for (const m of s.matchAll(/<div\b/g)) {
    const e = tagEnd(s, m.index + m[0].length);
    if (/className="[^"]*\bhidden\b/.test(s.slice(m.index, e + 1))) {
      hiddenSpans.push([m.index, elementEnd(s, e + 1, "div")]);
    }
  }
  const bad: string[] = [];
  const check = (start: number, tag: string, inner: string) => {
    if (/aria-label|aria-labelledby/.test(tag)) return;
    if (hasRenderableText(inner)) return;
    if (/<img[^>]*\balt=\{?("[^"]+"|[A-Za-z_$])/.test(inner)) return; // named by img alt
    if (hiddenSpans.some(([a, b]) => a <= start && start <= b)) return;
    bad.push(tag.replace(/\s+/g, " ").slice(0, 110));
  };
  for (const m of s.matchAll(/<button\b/g)) {
    const end = tagEnd(s, m.index + m[0].length);
    const tag = s.slice(m.index, end + 1);
    if (tag.endsWith("/>")) continue;
    check(m.index, tag, s.slice(end + 1, elementEnd(s, end + 1, "button")));
  }
  for (const m of s.matchAll(/role="button"/g)) {
    const start = s.lastIndexOf("<", m.index);
    const tagName = /^<([A-Za-z][\w.]*)/.exec(s.slice(start, start + 40))?.[1] ?? "";
    if (tagName === "button" || !tagName) continue;
    const end = tagEnd(s, start + 1);
    const tag = s.slice(start, end + 1);
    if (tag.endsWith("/>")) {
      check(start, tag, "");
    } else {
      check(start, tag, s.slice(end + 1, elementEnd(s, end + 1, tagName)));
    }
  }
  return bad;
}

/* ── class 5 scanner (verbatim from a11y-round-2.test.ts) ──────── */
const CLICK_SETTER = /onClick=\{[^}]*?(set[A-Z]\w*|toggle\w*)\s*\(/g;
const FLIP_ARG = /\(\s*(!|\(?\s*\w+\s*\)?\s*=>\s*!|prev\s*=>\s*!)/;
const DISCLOSURE_ARG = /\(\s*\w+\s*(===|!==)\s*[^)]*\?/;
function togglesWithoutState(rawSrc: string): string[] {
  const s = stripBlockComments(rawSrc);
  const bad: string[] = [];
  for (const m of s.matchAll(CLICK_SETTER)) {
    const after = s.slice(m.index, m.index + 140);
    const callAt = after.search(/(set[A-Z]\w*|toggle\w*)\s*\(/);
    const argText = after.slice(callAt);
    if (!FLIP_ARG.test(argText) && !DISCLOSURE_ARG.test(argText)) continue;
    const bStart = s.lastIndexOf("<button", m.index);
    if (bStart < 0) continue;
    const bEnd = tagEnd(s, bStart + "<button".length);
    if (bEnd < m.index) continue;
    const tag = s.slice(bStart, bEnd + 1);
    if (/aria-expanded|aria-pressed|aria-checked|aria-selected|role=/.test(tag)) continue;
    bad.push(tag.replace(/\s+/g, " ").slice(0, 110));
  }
  return bad;
}

describe("W1 — every World desk field has an accessible name", () => {
  it("no unlabelled input/select/textarea anywhere in the World tree", {
    timeout: 60_000,
  }, () => {
    const offenders: string[] = [];
    for (const { rel, src } of worldSources()) {
      for (const tag of unlabelledControls(src)) offenders.push(`${rel}: ${tag}`);
    }
    expect(offenders).toEqual([]);
  });
  it("the shipField helper forwards its placeholder as the label (six address fields, one edit)", () => {
    const stands = read("components/world/native/ShopStands.tsx");
    const at = stands.indexOf("const shipField");
    const helper = stands.slice(at, at + 400);
    expect(helper).toContain("aria-label={placeholder}");
  });
});

describe("W2 — every World desk disclosure exposes its state", () => {
  it("no stateless toggle anywhere in the World tree", { timeout: 30_000 }, () => {
    const offenders: string[] = [];
    for (const { rel, src } of worldSources()) {
      for (const tag of togglesWithoutState(src)) offenders.push(`${rel}: ${tag}`);
    }
    expect(offenders).toEqual([]);
  });
  it("the Pitch & Fix mode buttons are wired as the disclosures they are", () => {
    const board = read("components/world/native/PitchFixBoard.tsx");
    expect(board).toContain('aria-expanded={mode === "pitch"}');
    expect(board).toContain('aria-expanded={mode === "fix"}');
  });
});

describe("W3 — every World desk button has an accessible name", () => {
  it("no unnamed button anywhere in the World tree", { timeout: 30_000 }, () => {
    const offenders: string[] = [];
    for (const { rel, src } of worldSources()) {
      for (const tag of unnamedButtons(src)) offenders.push(`${rel}: ${tag}`);
    }
    expect(offenders).toEqual([]);
  });
  it("the DM attach-by-link button carries its own title as its name, plus its state", () => {
    const desk = read("components/world/native/SocialDesk.tsx");
    const at = desk.indexOf('data-testid="world-dm-attach-link"');
    const btn = desk.slice(Math.max(0, at - 500), at + 300);
    expect(btn).toContain('aria-label="Attach by link instead"');
    expect(btn).toContain("aria-expanded={showLink}");
  });
});

describe("W4 — the SchedulerDesk day cell is keyboard-operable (round-1 F3 pattern)", () => {
  const desk = read("components/world/native/SchedulerDesk.tsx");
  const at = desk.indexOf('data-testid="world-scheduler-cal-day"');
  const cell = desk.slice(at, at + 1900);
  it("a non-past day is a named, focusable button surface; a past day stays inert", () => {
    expect(cell).toContain('role={isPast ? undefined : "button"}');
    expect(cell).toContain("tabIndex={isPast ? undefined : 0}");
    expect(cell).toContain("Start a post on");
  });
  it("Enter and Space fire the same compose-open the click fires, guarded from nested chips", () => {
    expect(cell).toContain("onKeyDown");
    expect(cell).toContain("e.target !== e.currentTarget");
    expect(cell).toContain('e.key === "Enter"');
    expect(cell).toContain('e.key === " "');
    expect(cell).toContain("e.preventDefault()");
    expect(cell).toContain("setEditing(null)");
    expect(cell).toContain("composeWhenForDay(cell.date!)");
    /* the keyboard path honours the same past-day refusal as the click */
    expect(cell).toContain("if (isPast) return;");
  });
});

describe("C1 — the embedded checkout's payment error is announced", () => {
  const checkout = read("components/checkout/EmbeddedCheckout.tsx");
  it("the error paragraph is a live region (role=alert, the house error pattern)", () => {
    expect(checkout).toContain(
      '{error && <p role="alert" className="text-xs text-red-400 leading-snug">{error}</p>}',
    );
  });
  it("the honest failure copy is unchanged — nothing was charged, try again", () => {
    expect(checkout).toContain(
      "Payment wasn't completed — nothing was charged. Try again.",
    );
  });
});
