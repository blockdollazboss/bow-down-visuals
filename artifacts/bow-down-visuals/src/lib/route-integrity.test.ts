/**
 * route-integrity.test.ts — Stack-100 #3, Lane A (dead links / 404 audit).
 *
 * THE INCIDENT. The Stack-100 #2 push report (Oct 23, 2026) linked seven
 * paths that were never routes — page-file names and bare index paths:
 * /sponsor-dashboard, /tip-page, /nfc-card-profile, /group-detail,
 * /challenge, /albums, /hashtag. Every one served the 404 ("Lost in the
 * vault?") to the owner. App.tsx now carries redirect aliases for all
 * seven; this test is the tripwire so the CLASS never ships again:
 *
 *   1. Every literal internal link written in app source — href/to props,
 *      nav/menu config path fields, navigate/setLocation calls, location
 *      assignments, window.open — must resolve against the real route
 *      table extracted from App.tsx (both Switches), or name a file that
 *      actually exists under public/ (static assets are served, not
 *      routed). /api/* literals are API calls, not pages — out of scope.
 *   2. Every redirect target written in App.tsx must itself resolve to
 *      a declared route (an alias to nowhere is still a dead link).
 *   3. The seven incident paths stay aliased to live routes (pinned via
 *      ROUTE_MATRIX, the same census the gate consumes).
 *
 * Scope notes (deliberate, not gaps):
 *   - Test files are excluded: fixtures are data, not navigation (the
 *     link-in-bio fixture's owner-typed "/shop" URL and the chat-door
 *     parser's malformed "/x" doors are user-shaped data by design).
 *   - Template literals are judged on their static shape: `${…}` becomes
 *     a placeholder segment that matches any single route segment, and a
 *     placeholder glued onto a segment (e.g. `/content-calendar${qs}`,
 *     a query suffix) truncates the path there. A template with NO
 *     static segment (e.g. `/${tab}`) cannot be judged statically and
 *     is skipped — its value sets are pinned by their own page tests.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ROUTE_MATRIX } from "./public-routes";

const srcRoot = fileURLToPath(new URL("..", import.meta.url));
const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const publicRoot = path.resolve(srcRoot, "../public");

/* ---------- route table ---------- */
const routePatterns = [
  ...new Set([...appSource.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1])),
];

function segMatch(linkSeg: string, routeSeg: string): boolean {
  if (linkSeg === ":x") return true; // link placeholder matches any one segment
  if (routeSeg.startsWith(":")) return linkSeg.length > 0;
  return linkSeg === routeSeg;
}

function resolvesToRoute(p: string): boolean {
  const segs = p.split("/").filter(Boolean);
  return routePatterns.some((pat) => {
    const rsegs = pat.split("/").filter(Boolean);
    if (rsegs.length !== segs.length) return false;
    return rsegs.every((rs, i) => segMatch(segs[i], rs));
  });
}

/* ---------- public assets (served files, not routes) ---------- */
function walkFiles(dir: string, base: string, out: Set<string>) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, base, out);
    else out.add(path.relative(base, p).split(path.sep).join("/"));
  }
  return out;
}
const publicFiles = existsSync(publicRoot)
  ? walkFiles(publicRoot, publicRoot, new Set<string>())
  : new Set<string>();

/* ---------- link literal extraction ---------- */
const LINK_RES: { kind: string; re: RegExp }[] = [
  { kind: "href", re: /\bhref\s*=\s*(?:\{\s*)?["'`](\/[^"'`{}\s]*)["'`]/g },
  { kind: "href-tpl", re: /\bhref\s*=\s*\{\s*`(\/[^`]*?)`/g },
  { kind: "to", re: /\bto\s*=\s*(?:\{\s*)?["'`](\/[^"'`{}\s]*)["'`]/g },
  { kind: "to-tpl", re: /\bto\s*=\s*\{\s*`(\/[^`]*?)`/g },
  { kind: "path-prop", re: /\b(?:path|route|url|link)\s*:\s*["'`](\/[^"'`{}\s]*)["'`]/g },
  { kind: "path-prop-tpl", re: /\b(?:path|route|url|link)\s*:\s*`(\/[^`]*?)`/g },
  { kind: "nav-call", re: /\b(?:navigate|setLocation|push|replace)\(\s*["'`](\/[^"'`{}\s]*)["'`]/g },
  { kind: "nav-call-tpl", re: /\b(?:navigate|setLocation|push|replace)\(\s*`(\/[^`]*?)`/g },
  { kind: "loc-assign", re: /\b(?:window\.)?location(?:\.href)?\s*=\s*["'`](\/[^"'`{}\s]*)["'`]/g },
  { kind: "window-open", re: /\bwindow\.open\(\s*["'`](\/[^"'`{}\s]*)["'`]/g },
];

/** Normalize a raw literal to a judgeable path, or null to skip it. */
function normalize(raw: string): string | null {
  if (raw.startsWith("//")) return null; // protocol-relative external
  if (raw.startsWith("/api/") || raw === "/api") return null; // API call
  let p = raw.replace(/\$\{[^}]*\}/g, ":x");
  p = p.split(/[?#]/)[0];
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  if (p === "") p = "/";
  const segs = p.split("/").filter(Boolean);
  const out: string[] = [];
  for (const s of segs) {
    if (s === ":x") {
      out.push(":x");
    } else if (s.endsWith(":x")) {
      // placeholder glued onto the END of a static segment — a dynamic
      // suffix (e.g. `/content-calendar${qs}`): keep the static segment
      // and stop — the rest is not statically knowable.
      out.push(s.slice(0, -":x".length));
      break;
    } else if (s.includes(":x")) {
      // placeholder filling a segment whose captured text runs on into
      // a nested template (e.g. `/genre/${g}${cond ? "" : `?…`}`): the
      // segment is a value — judge it as a placeholder and stop.
      out.push(":x");
      break;
    } else {
      out.push(s);
    }
  }
  if (out.length === 0) return "/";
  // no static anchor at all (e.g. "/:x" from `/${tab}`) — unjudgeable
  if (out.every((s) => s === ":x")) return null;
  return "/" + out.join("/");
}

function walkSource(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules") continue;
      walkSource(p, out);
    } else if (/\.(tsx?|jsx?)$/.test(e.name) && !/\.test\.(tsx?|jsx?)$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

describe("route integrity — no literal internal link points at a non-route", () => {
  it(
    "every literal internal link in app source resolves to a route or a public asset",
    () => {
      const failures: string[] = [];
      let checked = 0;
      for (const file of walkSource(srcRoot)) {
        const text = readFileSync(file, "utf8");
        for (const { kind, re } of LINK_RES) {
          re.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = re.exec(text))) {
            const p = normalize(m[1]);
            if (p === null) continue;
            checked++;
            if (resolvesToRoute(p)) continue;
            if (publicFiles.has(p.slice(1))) continue;
            const line = text.slice(0, m.index).split("\n").length;
            failures.push(
              `${path.relative(srcRoot, file)}:${line} [${kind}] ${m[1]} -> ${p} (no route, no public asset)`,
            );
          }
        }
      }
      // Vacuity guard: a scan that found almost nothing must not pass.
      expect(checked).toBeGreaterThan(500);
      expect(failures).toEqual([]);
    },
    120_000,
  );

  it("every redirect target written in App.tsx resolves to a declared route", () => {
    const bad: string[] = [];
    for (const m of appSource.matchAll(
      /<(?:Redirect|QueryPreservingRedirect|CreateRedirect)\b[^>]*\bto="([^"]+)"/g,
    )) {
      const target = m[1].split(/[?#]/)[0];
      if (!resolvesToRoute(target)) bad.push(`${m[1]} (no route)`);
    }
    expect(bad).toEqual([]);
  });

  it("the seven Stack-100 #2 report paths stay aliased to live routes", () => {
    const incident = [
      "/sponsor-dashboard",
      "/tip-page",
      "/nfc-card-profile",
      "/group-detail",
      "/challenge",
      "/albums",
      "/hashtag",
    ];
    for (const p of incident) {
      const entry = ROUTE_MATRIX.find((e) => e.path === p);
      expect(entry, `${p} must be classified in ROUTE_MATRIX`).toBeDefined();
      expect(entry!.disposition).toBe("redirect");
      const target = entry!.redirectTo!.split(/[?#]/)[0];
      expect(
        resolvesToRoute(target),
        `${p} -> ${entry!.redirectTo} must land on a real route`,
      ).toBe(true);
    }
  });
});
