/**
 * Operator door mapping — the systematic pin (Oct 23 audit).
 *
 * A reply's gold door buttons are built from ONE place
 * (buildReplyDoors in operator-chat.ts), which copies the matched
 * knowledge entry's path verbatim. The Phase-2 verification found one
 * wrong door; this suite audits EVERY entry's door against the real
 * route table so the whole class fails the suite from now on:
 *
 *   1. Every knowledge entry's path — and every nextSteps hand-off
 *      path — resolves, segment by segment, against the App.tsx route
 *      table (":param" segments align with the route's own params).
 *   2. Every query door (?tab= / ?panel= / ?sub= / ?mode= / ?view= /
 *      ?subtab=) names a value the host page actually accepts. The
 *      accepted sets are RE-DERIVED from each page's own source (its
 *      deep-link parser), never hand-copied — a page renaming a tab
 *      breaks this suite until the knowledge is regenerated.
 *   3. A door a member can actually receive (buildReplyDoors over
 *      every entry's own name) is always CONCRETE — never a ":param"
 *      template path — and itself passes checks 1–2. Parameterized
 *      entries ("/artist/:slug", "/sponsors/:id", …) are page
 *      templates: they ground answers, they are never destinations.
 *      The verified defect was exactly this: "Sponsors" matched the
 *      Sponsor Deal Detail template and the reply's door pointed at
 *      the literal "/sponsors/:id".
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OPERATOR_FEATURES, findFeatures } from "../operator-knowledge";
import { buildReplyDoors } from "../operator-chat";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FE_SRC = path.resolve(HERE, "..", "..", "..", "..", "bow-down-visuals", "src");
const read = (p: string) => readFileSync(p, "utf8");
const fe = (...parts: string[]) => read(path.join(FE_SRC, ...parts));

/* ── Route table, re-derived from App.tsx (same idiom as the
      knowledge suite's coverage half). */
function deriveRoutePatterns(): string[] {
  const src = fe("App.tsx");
  const patterns = new Set<string>();
  const re = /<Route\b([\s\S]*?)(?:<\/Route>|\/>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const p = m[1]!.match(/path="([^"]+)"/)?.[1];
    if (p && p !== "*") patterns.add(p);
  }
  return [...patterns];
}
const ROUTE_PATTERNS = deriveRoutePatterns();

function segments(p: string): string[] {
  return p.split("?")[0]!.split("/").filter((s) => s !== "");
}

/** A knowledge path resolves when some route pattern has the same
    shape: static segments equal, params aligning either way. */
function resolvesToRoute(kbPath: string): boolean {
  const ks = segments(kbPath);
  return ROUTE_PATTERNS.some((r) => {
    const rs = segments(r);
    if (rs.length !== ks.length) return false;
    return ks.every((k, i) => k === rs[i] || k.startsWith(":") || rs[i]!.startsWith(":"));
  });
}

function isConcrete(p: string): boolean {
  return segments(p).every((s) => !s.startsWith(":"));
}

/* ── Accepted query values, re-derived per host page ─────────────────
   Each extractor reads the page's own deep-link acceptance code. If a
   page's shape changes so an extractor finds nothing, the non-empty
   assertions below fail loudly — the alarm working as intended. */

/** All `"value"` literals compared with === against `lhs` in `src`. */
function eqValues(src: string, lhs: string): Set<string> {
  const out = new Set<string>();
  const re = new RegExp(`${lhs}\\s*===\\s*"([^"]+)"`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.add(m[1]!);
  return out;
}

/** The slice of `src` from `startMarker` through the first `endMarker`. */
function slice(src: string, startMarker: string, endMarker: string): string {
  const a = src.indexOf(startMarker);
  expect(a, `marker "${startMarker}"`).toBeGreaterThanOrEqual(0);
  const b = src.indexOf(endMarker, a);
  expect(b, `end marker "${endMarker}"`).toBeGreaterThan(a);
  return src.slice(a, b + endMarker.length);
}

interface ParamRule {
  /** Query param name. */
  param: string;
  /** Values the host page accepts for it (re-derived). */
  accepted: Set<string>;
}

/** host base path -> its query-param rules. A door to a listed host
    may only carry ruled params; a door to an unlisted host may carry
    no query at all (a new deep-link host must be audited to be added). */
const HOST_RULES: Record<string, ParamRule[]> = {};

function buildHostRules() {
  // /create — isPanel() in pages/create.tsx is the panel whitelist.
  const create = fe("pages", "create.tsx");
  HOST_RULES["/create"] = [
    { param: "panel", accepted: eqValues(slice(create, "function isPanel", "}"), "p") },
  ];

  // /my-projects — MY_PROJECTS_TABS in lib/my-projects-tabs.ts.
  const mpt = fe("lib", "my-projects-tabs.ts");
  const tabArray = slice(mpt, "MY_PROJECTS_TABS = [", "]");
  HOST_RULES["/my-projects"] = [
    {
      param: "tab",
      accepted: new Set([...tabArray.matchAll(/"([^"]+)"/g)].map((x) => x[1]!)),
    },
  ];

  // /video-editor — EDITOR_SECTION_IDS in lib/editor-sections.ts,
  // minus the two ids the editor's deep-link effect refuses to select
  // (pages/video-editor.tsx: deepTab !== "templates" / "pro-tools").
  const sections = fe("lib", "editor-sections.ts");
  const sectionIds = new Set(
    [...slice(sections, "export const EDITOR_SECTIONS = [", "];") // the file's ids are written with escaped quotes
      .matchAll(/id:\s*\\?"([^"\\]+)\\?"/g)].map((x) => x[1]!),
  );
  sectionIds.delete("templates");
  sectionIds.delete("pro-tools");
  HOST_RULES["/video-editor"] = [{ param: "tab", accepted: sectionIds }];

  // /audio-studio — the tab useState initializer's whitelist, plus the
  // "cleanup" default it falls back to (so ?tab=cleanup lands there).
  const audio = fe("pages", "audio-studio.tsx");
  const audioTabs = eqValues(slice(audio, 'get("tab")', 'return "cleanup"'), "q");
  audioTabs.add("cleanup");
  // ?sub= is read by the nested AI Audio page (pages/ai-audio.tsx):
  // samples / sfx explicitly, beats as its default.
  const aiAudio = fe("pages", "ai-audio.tsx");
  const aiSubs = eqValues(slice(aiAudio, 'get("sub")', 'return "beats"'), "q");
  aiSubs.add("beats");
  // ?mode= is read inside the studio's sections: the mastering mode
  // (quick | master) and the stems mode (vocals | instrumental).
  const audioModes = new Set<string>();
  for (const m of audio.matchAll(/get\("mode"\)[\s\S]{0,240}/g)) {
    for (const v of m[0].matchAll(/===\s*"([^"]+)"/g)) audioModes.add(v[1]!);
    const ternary = m[0].match(/\?\s*"[^"]+"\s*:\s*"([^"]+)"/);
    if (ternary) audioModes.add(ternary[1]!);
  }
  HOST_RULES["/audio-studio"] = [
    { param: "tab", accepted: audioTabs },
    { param: "sub", accepted: aiSubs },
    { param: "mode", accepted: audioModes },
  ];

  // /branding-kit — the tab initializer's whitelist; ?subtab= is read
  // by the shop tab's content (pages/branding-shop.tsx).
  const kit = fe("pages", "branding-kit.tsx");
  HOST_RULES["/branding-kit"] = [
    { param: "tab", accepted: eqValues(slice(kit, 'get("tab")', '"brand"'), "q") },
    { param: "subtab", accepted: eqValues(fe("pages", "branding-shop.tsx"), 'q\\.get\\("subtab"\\)') },
  ];

  // /analytics-hub — the deep-link effect's tab chain.
  const hub = fe("pages", "analytics-hub.tsx");
  HOST_RULES["/analytics-hub"] = [
    { param: "tab", accepted: eqValues(hub, 'params\\.get\\("tab"\\)') },
  ];

  // /brand-deals — the mainTab initializer's forced-tab values.
  const deals = fe("pages", "brand-deals.tsx");
  HOST_RULES["/brand-deals"] = [{ param: "tab", accepted: eqValues(deals, "forced") }];

  // /coach — CoachTab union + MOVED_COACH_TABS keys (moved tabs
  // redirect onward, so they are honest doors too); ?view= is read by
  // the money tab's MoneyTrackerPanel (ledger is its default).
  const coach = fe("pages", "coach.tsx");
  const coachTabs = new Set<string>([
    ...slice(coach, "type CoachTab =", ";").matchAll(/"([^"]+)"/g),
  ].map((x) => x[1]!));
  for (const k of slice(coach, "MOVED_COACH_TABS", "}").matchAll(/"([^"]+)":/g)) {
    coachTabs.add(k[1]!);
  }
  const tracker = fe("components", "coach", "MoneyTrackerPanel.tsx");
  const coachViews = eqValues(slice(tracker, 'get("view")', 'return "ledger"'), "v");
  coachViews.add("ledger");
  HOST_RULES["/coach"] = [
    { param: "tab", accepted: coachTabs },
    { param: "view", accepted: coachViews },
  ];

  // /community — the tab ternary: replies, else moderate.
  const community = fe("pages", "community.tsx");
  HOST_RULES["/community"] = [
    { param: "tab", accepted: eqValues(slice(community, 'get("tab")', '"moderate"'), 'get\\("tab"\\)') },
  ];
  HOST_RULES["/community"]![0]!.accepted.add("moderate");

  // /distribute — the tab ternary: plan, else releases.
  const distribute = fe("pages", "distribute.tsx");
  const distTabs = eqValues(slice(distribute, 'get("tab")', '"releases"'), 'get\\("tab"\\)');
  distTabs.add("releases");
  HOST_RULES["/distribute"] = [{ param: "tab", accepted: distTabs }];

  // /go-live — the tab initializer's whitelist, plus its default
  // ("broadcast") and the moved-tab shim value ("shopping").
  const live = fe("pages", "go-live.tsx");
  const liveTabs = eqValues(slice(live, 'get("tab")', 'return "broadcast"'), "q");
  liveTabs.add("broadcast");
  liveTabs.add("shopping");
  HOST_RULES["/go-live"] = [{ param: "tab", accepted: liveTabs }];

  // /hooks — the deep-link effect's tab chain.
  const hooks = fe("pages", "hooks.tsx");
  HOST_RULES["/hooks"] = [{ param: "tab", accepted: eqValues(hooks, "tabParam") }];

  // /scheduler — ?tab= values the initializer maps (plan → calendar),
  // plus "calendar" itself: it is the initializer's default, so a
  // ?tab=calendar door lands on the calendar.
  const scheduler = fe("pages", "scheduler.tsx");
  const schedTabs = eqValues(scheduler, 'q\\.get\\("tab"\\)');
  schedTabs.add("calendar");
  HOST_RULES["/scheduler"] = [{ param: "tab", accepted: schedTabs }];

  // /academy — the tab TABS keys plus MOVED_ACADEMY_TABS keys (moved
  // tabs redirect to real routes).
  const academy = fe("pages", "academy.tsx");
  const academyTabs = new Set<string>();
  for (const k of slice(academy, "const TABS", "]").matchAll(/key:\s*"([^"]+)"/g)) {
    academyTabs.add(k[1]!);
  }
  for (const k of slice(academy, "MOVED_ACADEMY_TABS", "}").matchAll(/"([^"]+)":/g)) {
    academyTabs.add(k[1]!);
  }
  HOST_RULES["/academy"] = [{ param: "tab", accepted: academyTabs }];

  // /thumbnail-studio — the tab initializer's whitelist.
  const thumbs = fe("pages", "thumbnail-studio.tsx");
  HOST_RULES["/thumbnail-studio"] = [
    { param: "tab", accepted: eqValues(slice(thumbs, 'get("tab")', '"library"'), "param") },
  ];

  // /label-pitch — the Mode union; ?mode= selects it (and ?tab=sync is
  // the page's own alias for playlists).
  const pitch = fe("pages", "label-pitch.tsx");
  const modes = new Set<string>([
    ...slice(pitch, "type Mode =", ";").matchAll(/"([^"]+)"/g),
  ].map((x) => x[1]!));
  HOST_RULES["/label-pitch"] = [
    { param: "mode", accepted: modes },
    { param: "tab", accepted: new Set(["sync"]) },
  ];
}
buildHostRules();

/** Check one door path's query against its host's rules. Returns a
    list of problems (empty = the door lands where it promises). */
function queryProblems(fullPath: string): string[] {
  const problems: string[] = [];
  const [base, qs] = fullPath.split("?");
  if (!qs) return problems;
  const rules = HOST_RULES[base!];
  if (!rules) {
    problems.push(`${fullPath}: query door to unruled host ${base}`);
    return problems;
  }
  const params = new URLSearchParams(qs);
  for (const [key, value] of params.entries()) {
    const rule = rules.find((r) => r.param === key);
    if (!rule) {
      problems.push(`${fullPath}: param ${key} is not a ruled param for ${base}`);
    } else if (!rule.accepted.has(value)) {
      problems.push(
        `${fullPath}: ${key}=${value} is not accepted by ${base} (accepted: ${[...rule.accepted].join(", ")})`,
      );
    }
  }
  return problems;
}

describe("operator door mapping — every knowledge door against the real route table", () => {
  it("the re-derived host vocabularies are non-empty (extractors still read the pages)", () => {
    for (const [host, rules] of Object.entries(HOST_RULES)) {
      for (const rule of rules) {
        expect(rule.accepted.size, `${host} ?${rule.param}=`).toBeGreaterThan(0);
      }
    }
  });

  it("every knowledge entry's path resolves to a real route", () => {
    const bad = OPERATOR_FEATURES.filter((f) => f.path && !resolvesToRoute(f.path)).map(
      (f) => `${f.id} (${f.name}) -> ${f.path}`,
    );
    expect(bad).toEqual([]);
  });

  it("every nextSteps hand-off path resolves to a real route", () => {
    const bad: string[] = [];
    for (const f of OPERATOR_FEATURES) {
      for (const s of f.nextSteps) {
        if (!resolvesToRoute(s.path)) bad.push(`${f.id} next "${s.label}" -> ${s.path}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("every knowledge door's query names values the host page accepts", () => {
    const problems: string[] = [];
    for (const f of OPERATOR_FEATURES) {
      if (f.path) problems.push(...queryProblems(f.path).map((p) => `${f.id}: ${p}`));
      for (const s of f.nextSteps) {
        problems.push(...queryProblems(s.path).map((p) => `${f.id} next: ${p}`));
      }
    }
    expect(problems).toEqual([]);
  });

  it("every door a member can receive is concrete, resolves, and passes the query rules", () => {
    const problems: string[] = [];
    for (const f of OPERATOR_FEATURES) {
      for (const door of buildReplyDoors(f.name)) {
        if (!isConcrete(door.path)) {
          problems.push(`${f.id} (${f.name}): door carries a template path ${door.path}`);
        }
        if (!resolvesToRoute(door.path)) {
          problems.push(`${f.id} (${f.name}): door ${door.path} matches no route`);
        }
        problems.push(...queryProblems(door.path).map((p) => `${f.id} (${f.name}): ${p}`));
      }
    }
    expect(problems).toEqual([]);
  });

  it("regression: the Sponsors door skips the deal template to the first concrete match", () => {
    // Knowledge still leads with the template entry — it is the
    // richest description of a sponsor deal — but the DOOR must skip
    // it: the verified defect was a door to the literal
    // "/sponsors/:id". The door now takes the first CONCRETE entry in
    // the same ranking (today: Sponsor Post), so door and ranking can
    // never disagree about which features exist — only templates are
    // passed over.
    expect(findFeatures("Sponsors", 1)[0]?.id).toBe("sponsors--id");
    const firstConcrete = findFeatures("Sponsors", 8).find(
      (f) => f.path && isConcrete(f.path),
    )!;
    const doors = buildReplyDoors("Sponsors");
    expect(doors.length).toBeGreaterThan(0);
    expect(doors[0]!.path).toBe(firstConcrete.path);
    expect(doors[0]!.path).toBe("/sponsors/post");
    expect(doors[0]!.label).toBe(`Open ${firstConcrete.name}`);
  });

  it("regression: a question naming only a template page gets no broken door", () => {
    // "Paid Series" matches only template entries head-on; the reply
    // may carry no door at all — never one with a literal :id in it.
    for (const door of buildReplyDoors("Paid Series")) {
      expect(isConcrete(door.path)).toBe(true);
    }
  });
});
