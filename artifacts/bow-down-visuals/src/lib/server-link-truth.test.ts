/**
 * server-link-truth.test.ts — Stack900 Lane J4 (route truth, server side).
 *
 * THE GAP. route-integrity.test.ts sweeps every literal link in the
 * FRONTEND source against the App.tsx route table — but a whole family
 * of user-tappable destinations is built on the SERVER, where that
 * sweep never looks: transactional email buttons (composed with
 * baseUrlForEmail()), OAuth return redirects (APP_PUBLIC_URL), Stripe
 * return/cancel URLs (getBaseUrl(req)), share links (siteOrigin()),
 * and the notification link:/href: fields the bell and push payloads
 * carry into the app. Lane J4's audit found FOUR dead doors in that
 * family, every one invisible to the frontend sweep:
 *
 *   1. Split-invite email → /distribution?splitInvite=<token> — no
 *      such route, and the token had no consumer anywhere. Fixed:
 *      the invite ensures the release's share slug and links the
 *      public agreement page /splits/:slug (distribution.ts).
 *   2. Payout email → /money — no such route. The Money Tracker lives
 *      at /coach. Fixed in royalties.ts.
 *   3. Team-invite email → /teams — no such route. The Team page is
 *      /team. Fixed in teams.ts.
 *   4. Spotify presave callback → bare /presave on failure — only
 *      /presave/:slug existed. Fixed with a front-door alias in
 *      App.tsx (/presave → /distribute), pinned below.
 *
 * This suite is the tripwire so the class never ships again:
 *   1. Every absolute bowdownvisuals.com URL written in api-server
 *      source resolves against the real route table (or names a
 *      public asset).
 *   2. Every `${siteBase}/path` template in api-server source — where
 *      siteBase is one of the canonical site-root producers
 *      (baseUrlForEmail(), APP_PUBLIC_URL, siteOrigin(), getBaseUrl(),
 *      or a local assigned from one of them) — resolves. Provider and
 *      storage bases (WaveSpeed, Sync Labs, Cloudflare WHIP, R2…)
 *      are NOT site bases and are deliberately not judged: their
 *      expressions never take those producers' shapes.
 *   3. Every notification link:/href: path literal in api-server
 *      source resolves (the bell/push doors the app renders).
 *   4. Concatenated `+ "/path"` link tails resolve too.
 *   5. The embed family stays honest: every EmbedKind the frontend
 *      offers is a page the server's embed router actually serves.
 *   6. Bare /presave stays front-doored (ROUTE_MATRIX + App.tsx).
 *
 * Scope notes (deliberate, not gaps):
 *   - Test files are excluded: fixtures are data, not navigation
 *     (same rule as route-integrity).
 *   - /api/* literals are API calls, not pages — the fetch-route
 *     suites own those.
 *   - Dynamic links are judged by shape: `${…}` becomes a placeholder
 *     segment matching any single route segment (route-integrity's
 *     normalize, reused verbatim in spirit).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ROUTE_MATRIX } from "./public-routes";

const srcRoot = fileURLToPath(new URL("..", import.meta.url));
const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const apiRoot = path.resolve(srcRoot, "../../api-server/src");
const publicRoot = path.resolve(srcRoot, "../public");

/* ---------- route table (App.tsx, both Switches) ---------- */
const routePatterns = [
  ...new Set([...appSource.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1])),
];
const redirectMap = new Map<string, string>();
for (const m of appSource.matchAll(
  /<Route\s+path="([^"]+)"[^>]*>\s*<(?:Redirect|QueryPreservingRedirect|CreateRedirect)\s+to="([^"]+)"/g,
)) {
  redirectMap.set(m[1], m[2]);
}

function segMatch(linkSeg: string, routeSeg: string): boolean {
  if (linkSeg === ":x") return true;
  if (routeSeg.startsWith(":")) return linkSeg.length > 0;
  return linkSeg === routeSeg;
}
function matchesRoute(p: string): boolean {
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

/** Judge a destination: route, redirect-to-route, public asset, or dead. */
function resolves(p: string, depth = 0): boolean {
  let clean = p.split(/[?#]/)[0];
  if (clean.length > 1 && clean.endsWith("/")) clean = clean.slice(0, -1);
  if (clean === "") clean = "/";
  if (matchesRoute(clean)) return true;
  if (depth < 6 && redirectMap.has(clean)) return resolves(redirectMap.get(clean)!, depth + 1);
  return publicFiles.has(clean.slice(1));
}

/** Normalize a raw literal to a judgeable path, or null to skip it. */
function normalize(raw: string): string | null {
  if (raw.startsWith("//")) return null;
  if (raw.startsWith("/api/") || raw === "/api") return null;
  let p = raw.replace(/\$\{[^}]*\}/g, ":x");
  p = p.split(/[?#]/)[0];
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  if (p === "") p = "/";
  const segs = p.split("/").filter(Boolean);
  const out: string[] = [];
  for (const s of segs) {
    if (s === "$") out.push(":x"); // capture remnant of a following ${…}
    else if (s === ":x") out.push(":x");
    else if (s.endsWith(":x")) { out.push(s.slice(0, -":x".length)); break; }
    else if (s.includes(":x")) { out.push(":x"); break; }
    else out.push(s);
  }
  if (out.length === 0) return "/";
  if (out.every((s) => s === ":x")) return null;
  return "/" + out.join("/");
}

/* ---------- api-server source walk (real source only) ---------- */
function walkSource(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "__tests__") continue;
      walkSource(p, out);
    } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}
const apiFiles = walkSource(apiRoot);

/* ---------- extraction ---------- */
const ABS_RE = /https?:\/\/(?:www\.)?bowdownvisuals\.com(\/[^\s"'`<>\)\]}]*)?/g;
/* Path captures consume whole ${…} chunks as single units — a template
   tail like /store/buy/${kind}/${id} must arrive at normalize() intact
   (a bare "$" left behind by a cut-off capture is not a path). */
const NOTIF_RE =
  /\b(?:link|href)\s*:\s*(?:["'](\/[^"'\s]*)["']|`(\/(?:[^\s`{}]|\$\{[^}]*\})+)`)/g;
const CONCAT_RE = /\+\s*["'`](\/[A-Za-z0-9\-._~/%]+)["'`]/g;

/** Expressions that ARE the site's root origin (never a provider's). */
const PRODUCER_EXPRS = [
  "baseUrlForEmail()",
  "APP_PUBLIC_URL",
  "PUBLIC_BASE_URL",
  "SITE_URL",
  "siteOrigin()",
];
const PRODUCER_RHS =
  /(baseUrlForEmail\(|APP_PUBLIC_URL|siteOrigin\(|getBaseUrl\(|PUBLIC_BASE_URL|SITE_URL|bowdownvisuals\.com)/;

/** Locals in this file assigned from a site-root producer. (File-scoped
    by design: a name bound to a site producer anywhere in the file —
    e.g. og-preview's `const origin = siteOrigin()` — is the site base
    throughout that file; the producer functions' own contract makes
    the same-named parameters site origins too.) */
function siteBaseLocals(text: string): Set<string> {
  const locals = new Set<string>();
  for (const m of text.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+)/g)) {
    if (PRODUCER_RHS.test(m[2])) locals.add(m[1]);
  }
  return locals;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The path chunk immediately following a `${producer}` placeholder:
    whole segments and whole ${…} units, or null when the placeholder
    is not followed by a path at all (a bare origin link). */
const TAIL_RE = /^((?:\/[^\s"'`<>{}/$]*|\$\{[^}]*\})+)/;
function tailPath(text: string, from: number): string | null {
  const m = TAIL_RE.exec(text.slice(from));
  return m ? m[1] : null;
}

interface Hit { file: string; line: number; kind: string; raw: string; path: string }
function collect(): { hits: Hit[]; counts: Record<string, number> } {
  const hits: Hit[] = [];
  const counts: Record<string, number> = { abs: 0, tpl: 0, notif: 0, concat: 0 };
  for (const file of apiFiles) {
    const text = readFileSync(file, "utf8");
    const locals = siteBaseLocals(text);
    const rel = path.relative(apiRoot, file);
    const lineOf = (idx: number) => text.slice(0, idx).split("\n").length;
    for (const m of text.matchAll(ABS_RE)) {
      const p = normalize(m[1] ?? "/");
      if (p === null) continue;
      counts.abs++;
      hits.push({ file: rel, line: lineOf(m.index), kind: "absolute-url", raw: m[0], path: p });
    }
    /* Site-base templates: anchored on the producer placeholder
       itself — NOT a generic ${…} scan, which would let an outer
       template (${emailButton(`…`)}) swallow the inner producer
       placeholder whole and judge nothing. */
    const baseNames = [...PRODUCER_EXPRS, ...locals];
    for (const name of baseNames) {
      const re = new RegExp(`\\$\\{${escapeRegExp(name)}\\}`, "g");
      for (const m of text.matchAll(re)) {
        const raw = tailPath(text, m.index + m[0].length);
        if (raw === null) continue;
        const p = normalize(raw);
        if (p === null) continue;
        counts.tpl++;
        hits.push({ file: rel, line: lineOf(m.index), kind: `site-base<${name}>`, raw: `\${${name}}${raw}`.slice(0, 90), path: p });
      }
    }
    for (const m of text.matchAll(NOTIF_RE)) {
      const p = normalize(m[1] ?? m[2]);
      if (p === null) continue;
      counts.notif++;
      hits.push({ file: rel, line: lineOf(m.index), kind: "notification-link", raw: (m[1] ?? m[2]), path: p });
    }
    for (const m of text.matchAll(CONCAT_RE)) {
      const p = normalize(m[1]);
      if (p === null) continue;
      counts.concat++;
      hits.push({ file: rel, line: lineOf(m.index), kind: "concat-tail", raw: m[0].slice(0, 90), path: p });
    }
  }
  return { hits, counts };
}

describe("server link truth — every server-built destination lands on a route", () => {
  it(
    "email buttons, share links, OAuth returns and notification doors in api-server source all resolve",
    () => {
      const { hits, counts } = collect();
      // Vacuity guards: a sweep that found almost nothing must not pass.
      expect(counts.abs, "absolute site URLs swept").toBeGreaterThan(15);
      expect(counts.tpl, "site-base templates swept").toBeGreaterThan(8);
      expect(counts.notif, "notification links swept").toBeGreaterThan(25);
      const failures = hits
        .filter((h) => !resolves(h.path))
        .map((h) => `${h.file}:${h.line} [${h.kind}] ${h.raw} -> ${h.path} (no route, no public asset)`);
      expect(failures).toEqual([]);
    },
    120_000,
  );

  it("every embed kind the frontend offers is a page the embed router serves", () => {
    const embedSource = readFileSync(path.join(apiRoot, "routes/embed.ts"), "utf8");
    const served = new Set(
      [...embedSource.matchAll(/embedPageRouter\.get\("(\/embed\/[^"]+)"/g)].map((m) => m[1]),
    );
    expect(served.size).toBeGreaterThanOrEqual(4);
    const buttonSource = readFileSync(
      new URL("../components/player/EmbedButton.tsx", import.meta.url),
      "utf8",
    );
    const kindUnion = buttonSource.match(/type EmbedKind = ([^;]+);/);
    expect(kindUnion, "EmbedKind union must be findable").not.toBeNull();
    const kinds = [...kindUnion![1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
    expect(kinds.length).toBeGreaterThanOrEqual(4);
    for (const kind of kinds) {
      const servedKind = [...served].some(
        (r) => r === `/embed/${kind}/:id` || r === `/embed/${kind}/:slug`,
      );
      expect(servedKind, `/embed/${kind}/… must be served by embedPageRouter`).toBe(true);
    }
  });

  it("bare /presave stays front-doored to /distribute", () => {
    const entry = ROUTE_MATRIX.find((e) => e.path === "/presave");
    expect(entry, "/presave must be classified in ROUTE_MATRIX").toBeDefined();
    expect(entry!.disposition).toBe("redirect");
    expect(entry!.redirectTo).toBe("/distribute");
    expect(entry!.targetDisposition).toBe("locked");
    expect(appSource).toContain(
      '<Route path="/presave"><Redirect to="/distribute" /></Route>',
    );
    expect(resolves("/presave")).toBe(true);
    expect(resolves("/distribute")).toBe(true);
  });
});
