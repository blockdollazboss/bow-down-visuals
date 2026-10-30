/**
 * Round-2 accessibility pins (stack900, lane K3) — the whole 2D site,
 * following lane05's source-scanner pattern (a11y-editor-panels.test.ts).
 * World files are out of scope (their panels have their own nav family).
 *
 * Classes pinned:
 *  1. dialogs wired to the house focus contract (useModalA11y) and the
 *     keyboard-operable custom surfaces fixed this round;
 *  2. no icon-only button without an accessible name;
 *  3. no form field without a label association (placeholder-only is
 *     not a label) — with the acquittals encoded below;
 *  4. the global :focus-visible outline stays UNLAYERED (so Tailwind's
 *     layered outline-none can never suppress it) and no !-important or
 *     inline outline suppression exists in the tree;
 *  5. no toggle-shaped button without an aria state attribute.
 *
 * Acquittals (evidence in ~/workspace/stack900-a11y-round-2-report.md):
 *  - display:none file inputs are ref-triggered by named visible
 *    controls; they are absent from the a11y tree by construction.
 *  - ui/input + ui/textarea forward {...props}; callers name them.
 *  - an <input> inside pages/email-list.tsx's generated embed-snippet
 *    STRING is text, not a rendered control (string-literal style="…"
 *    attribute — JSX style is always an expression).
 *  - a button whose only child is an <img alt="…"> is named by the alt.
 *  - controls inside a display:none container are not rendered.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const SRC = path.resolve(__dirname, "..");
const WORLD = (rel: string) =>
  rel.startsWith("pages/world") || rel.startsWith("components/world");

function allSources(): { rel: string; src: string }[] {
  const out: { rel: string; src: string }[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".tsx") && !e.name.includes(".test.")) {
        const rel = path.relative(SRC, p).split(path.sep).join("/");
        if (!WORLD(rel)) out.push({ rel, src: fs.readFileSync(p, "utf8") });
      }
    }
  };
  walk(SRC);
  return out;
}
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), "utf8");

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

/* ── class 3 scanner ─────────────────────────────────────────────── */
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

/* ── class 2 scanner ─────────────────────────────────────────────── */
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

/* ── class 5 scanner ───────────────────────────────────────────────
 * Two toggle shapes, both proven against the tree this round:
 *  flip       — a setter called with a boolean negation
 *               (setX(!x), setX((p) => !p), toggleX(!x));
 *  disclosure — a setter called with an identity ternary
 *               (setX(cur === id ? null : id)) — accordion/panel shape.
 * Selection setters (setX(value)) and list mutators (setX(prev =>
 * prev.filter(...))) are NOT toggles and stay out of scope. */
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

describe("round 2 — class 3: every form field has an accessible name", () => {
  it("no unlabelled input/select/textarea anywhere on the 2D site", {
    timeout: 60_000,
  }, () => {
    const offenders: string[] = [];
    for (const { rel, src } of allSources()) {
      for (const tag of unlabelledControls(src)) offenders.push(`${rel}: ${tag}`);
    }
    expect(offenders).toEqual([]);
  });
});

describe("round 2 — class 2: every button has an accessible name", () => {
  it("no unnamed button or role=button anywhere on the 2D site", {
    timeout: 60_000,
  }, () => {
    const offenders: string[] = [];
    for (const { rel, src } of allSources()) {
      for (const tag of unnamedButtons(src)) offenders.push(`${rel}: ${tag}`);
    }
    expect(offenders).toEqual([]);
  });
});

describe("round 2 — class 5: toggles expose their state", () => {
  it("no toggle-shaped button without aria-pressed/expanded/checked/selected", {
    timeout: 60_000,
  }, () => {
    const offenders: string[] = [];
    for (const { rel, src } of allSources()) {
      for (const tag of togglesWithoutState(src)) offenders.push(`${rel}: ${tag}`);
    }
    expect(offenders).toEqual([]);
  });
});

describe("round 2 — class 4: keyboard focus can never be suppressed", () => {
  const css = read("index.css");
  it("the global :focus-visible gold outline lives OUTSIDE any @layer", () => {
    const withoutLayers = css.replace(/@layer[^{]*\{(?:[^{}]|\{[^{}]*\})*\}/g, "");
    expect(withoutLayers).toContain(":focus-visible");
    expect(withoutLayers).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid/);
  });
  it("no !-important outline utility or inline outline suppression in the tree", {
    timeout: 60_000,
  }, () => {
    const offenders: string[] = [];
    for (const { rel, src } of allSources()) {
      // !-important outline utilities or inline style={{ outline: "none" }}
      if (/!outline-|outline-[\w[\]]*!|outline\s*:\s*["']none["']/.test(src)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});

describe("round 2 — class 1: the dialog focus contract", () => {
  const hook = read("hooks/use-modal-a11y.ts");
  it("useModalA11y is stack-aware (one Escape closes one dialog)", () => {
    expect(hook).toContain("openStack");
  });
  const wired = [
    "pages/shop.tsx",
    "components/AwayDigestModal.tsx",
    "components/DailyBonusModal.tsx",
    "components/ExtensionPromoModal.tsx",
    "components/DiscordAnnounceModal.tsx",
    "components/FacebookPostModal.tsx",
    "components/InstagramPostModal.tsx",
    "components/TikTokPostModal.tsx",
    "components/XPostModal.tsx",
    "components/GenerateArtistImageModal.tsx",
    "components/HelpPanel.tsx",
    "components/MysteryCrate.tsx",
    "components/QRCode.tsx",
    "components/QRLogin.tsx",
    "components/ShareForReview.tsx",
    "components/TemplatePicker.tsx",
    "components/LoadingScreenModal.tsx",
    "components/SpotlightModal.tsx",
    "components/player/AddToPlaylist.tsx",
    "components/social/ReportButton.tsx",
    "components/song/CoverSongModal.tsx",
    "components/song/HarmonyGeneratorModal.tsx",
    "components/song/SingingVoiceModal.tsx",
    "components/song/VocalPolishModal.tsx",
    "components/song/LrcExportModal.tsx",
    "components/wave8/SponsorPipeline.tsx",
    "contexts/CreditConfirmContext.tsx",
    "components/ShareMenu.tsx",
    "components/OnboardingTour.tsx",
    "components/PhotoLightbox.tsx",
    "components/cheat-code-easter-egg.tsx",
    "components/milestones/BragModal.tsx",
    "components/retention/LevelUpModal.tsx",
    "components/retention/SharkDropModal.tsx",
    "components/social/StoryViewer.tsx",
    "components/TeleprompterPlayer.tsx",
    "components/cheat-code-jackpot.tsx",
  ];
  it.each(wired)("%s routes its dialog through useModalA11y", (rel) => {
    expect(read(rel)).toContain("useModalA11y");
  });
  it("the custom surfaces fixed this round are keyboard-operable", () => {
    expect(read("components/player/StreamingPlayerBar.tsx")).toContain('role="slider"');
    expect(read("components/player/StreamingPlayerBar.tsx")).toContain("onKeyDown");
    expect(read("components/player-upgrades/DuelCover.tsx")).toContain("onKeyDown");
    expect(read("components/audio/DeverbPanel.tsx")).toContain('role="button"');
    expect(read("components/audio/LufsPanel.tsx")).toContain('role="button"');
    expect(read("components/audio/VocalTunePanel.tsx")).toContain('role="button"');
    expect(read("components/SongSegmentPicker.tsx")).toContain('role: "slider"');
    expect(read("components/discovery/NotificationsBell.tsx")).toContain('role="button"');
  });
});
