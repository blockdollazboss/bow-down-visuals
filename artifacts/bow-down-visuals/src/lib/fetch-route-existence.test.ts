import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/* Fetch-literal route truth (stack800 lane 10).
 *
 * nav-route-existence.test.ts pins NAV links against the App route
 * table. This is the sibling pin for the OTHER door class stack600
 * proved exists: the floating admin panel POSTed to
 * "/cheat-code/admin/events" — missing its /api prefix — so the
 * request hit the SPA fallback and died silently while every nav
 * link on the site was fine. A link census can never see that bug;
 * only a census of FETCH literals can.
 *
 * The pin: every path literal handed to fetch() or one of the fetch
 * wrappers (apiJson / apiFetch / authedFetch / fetchJson /
 * confirmedFetch) anywhere in the FE source must resolve to a route
 * the API server actually registers. The API route table is rebuilt
 * here from the api-server sources: app.ts mounts the routes router
 * at /api, routes/index.ts mounts each route file's router, and each
 * file's (get|post|put|patch|delete) registrations land under its
 * mount prefix — including loop-registered paths like
 * live-highlights' `/live-streams/:id/highlights/:proposalId/${verb}`
 * (a template segment on the API side is a param slot).
 *
 * Literals the sweep cannot see through (URLs composed from a base
 * constant, the memberships helper that prepends /api itself, the
 * WebSocket controller path) get dedicated blocks below — same
 * discipline as the nav pin's named siblings. */

const HERE = dirname(fileURLToPath(import.meta.url));
const FE_SRC = resolve(HERE, "..");
const API_SRC = resolve(HERE, "../../../api-server/src");

function walk(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, exts));
    else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}

/* ─── API route table, rebuilt from source ─────────────────────── */

type Seg = { t: "static"; v: string } | { t: "param" } | { t: "star" };

const IDENT = "[A-Za-z_$][\\w$]*";
const LIT = `("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|\`(?:[^\`\\\\]|\\\\.)*\`)`;

interface ApiFile {
  imports: Map<string, { file?: string; exportName: string }>;
  routerIdents: Set<string>;
  routes: Array<{ ident: string; method: string; path: string }>;
  mounts: Array<{ ident: string; prefix: string; child: string }>;
  exportsMap: Map<string, string>;
}

function parseApiFile(file: string, text: string): ApiFile {
  const imports = new Map<string, { file?: string; exportName: string }>();
  for (const m of text.matchAll(new RegExp(`import\\s+(${IDENT})\\s+from\\s+"([^"]+)"`, "g"))) {
    imports.set(m[1], { exportName: "default", file: resolveImport(file, m[2]) });
  }
  for (const m of text.matchAll(/import\s*\{([^}]+)\}\s*from\s*"([^"]+)"/g)) {
    for (const part of m[1].split(",")) {
      const mm = part.trim().match(new RegExp(`^(${IDENT})(?:\\s+as\\s+(${IDENT}))?$`));
      if (mm) imports.set(mm[2] || mm[1], { exportName: mm[1], file: resolveImport(file, m[2]) });
    }
  }
  const routerIdents = new Set<string>();
  for (const m of text.matchAll(new RegExp(`(?:const|let|var)\\s+(${IDENT})\\s*=\\s*Router\\(`, "g")))
    routerIdents.add(m[1]);
  const routes: ApiFile["routes"] = [];
  for (const m of text.matchAll(
    new RegExp(`(${IDENT})\\.(get|post|put|patch|delete|all|head|options)\\(\\s*${LIT}`, "g"),
  )) {
    routes.push({ ident: m[1], method: m[2], path: m[3].slice(1, -1) });
  }
  const mounts: ApiFile["mounts"] = [];
  for (const m of text.matchAll(new RegExp(`(${IDENT})\\.use\\(\\s*(?:${LIT}\\s*,\\s*)?(${IDENT})`, "g"))) {
    mounts.push({ ident: m[1], prefix: m[2] ? m[2].slice(1, -1) : "", child: m[3] });
  }
  const exportsMap = new Map<string, string>();
  const dm = text.match(/export\s+default\s+([A-Za-z_$][\w$]*)/);
  if (dm) exportsMap.set("default", dm[1]);
  for (const m of text.matchAll(new RegExp(`export\\s+(?:const|let|var)\\s+(${IDENT})\\s*=`, "g")))
    exportsMap.set(m[1], m[1]);
  for (const m of text.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const part of m[1].split(",")) {
      const mm = part.trim().match(new RegExp(`^(${IDENT})(?:\\s+as\\s+(${IDENT}))?$`));
      if (mm) exportsMap.set(mm[2] || mm[1], mm[1]);
    }
  }
  return { imports, routerIdents, routes, mounts, exportsMap };
}

function resolveImport(fromFile: string, spec: string): string | undefined {
  if (!spec.startsWith(".")) return undefined;
  const base = resolve(dirname(fromFile), spec);
  for (const cand of [base + ".ts", base + "/index.ts", base]) {
    try {
      if (statSync(cand).isFile()) return cand;
    } catch {
      /* not this candidate */
    }
  }
  return undefined;
}

const apiParsed = new Map<string, ApiFile>();
for (const f of walk(API_SRC, [".ts"])) {
  if (f.includes("__tests__") || f.endsWith(".test.ts")) continue;
  apiParsed.set(f, parseApiFile(f, readFileSync(f, "utf8")));
}

function joinPath(a: string, b: string): string {
  const s = (a + "/" + b).replace(/\/+/g, "/");
  return s.length > 1 && s.endsWith("/") ? s.slice(0, -1) : s;
}

function segsOf(p: string): Seg[] {
  return p
    .split("/")
    .filter((s) => s.length > 0)
    .map((s): Seg => {
      if (s === "*" || s.includes("*")) return { t: "star" };
      if (s.startsWith(":") || s.includes("${")) return { t: "param" };
      return { t: "static", v: s };
    });
}

interface RoutePattern {
  segs: Seg[];
  src: string;
}
const routePatterns: RoutePattern[] = [];

function emitRouter(file: string, ident: string, prefix: string, stack: Set<string>): void {
  const key = `${file}#${ident}@${prefix}`;
  if (stack.has(key)) return;
  stack.add(key);
  const P = apiParsed.get(file);
  if (!P) return;
  for (const r of P.routes) {
    if (r.ident === ident)
      routePatterns.push({ segs: segsOf(joinPath(prefix, r.path)), src: `${file.slice(API_SRC.length)} ${r.path}` });
  }
  for (const mnt of P.mounts) {
    if (mnt.ident !== ident) continue;
    const childPrefix = joinPath(prefix, mnt.prefix);
    const imp = P.imports.get(mnt.child);
    if (imp?.file) emitExport(imp.file, imp.exportName, childPrefix, stack);
    else if (P.routerIdents.has(mnt.child)) emitRouter(file, mnt.child, childPrefix, stack);
  }
}

function emitExport(file: string, exportName: string, prefix: string, stack: Set<string>): void {
  const P = apiParsed.get(file);
  if (!P) return;
  const ident = P.exportsMap.get(exportName);
  if (ident) return emitRouter(file, ident, prefix, stack);
  if (P.routerIdents.size === 1) return emitRouter(file, [...P.routerIdents][0], prefix, stack);
}

/* app.ts is the root: its own verb registrations are absolute, and
 * its mounts (the /api router, the embed router) seed the walk. */
{
  const appFile = join(API_SRC, "app.ts");
  const appP = apiParsed.get(appFile)!;
  for (const r of appP.routes) {
    if (r.ident === "app") routePatterns.push({ segs: segsOf(r.path), src: `app.ts ${r.path}` });
  }
  for (const mnt of appP.mounts) {
    if (mnt.ident !== "app") continue;
    const imp = appP.imports.get(mnt.child);
    if (imp?.file) emitExport(imp.file, imp.exportName, mnt.prefix || "", new Set());
  }
}

/* Bucket patterns by their second segment to keep matching cheap. */
const buckets = new Map<string, RoutePattern[]>();
const paramBucket: RoutePattern[] = [];
for (const p of routePatterns) {
  const second = p.segs[1];
  if (second && second.t === "static") {
    const arr = buckets.get(second.v) ?? [];
    arr.push(p);
    buckets.set(second.v, arr);
  } else {
    paramBucket.push(p);
  }
}

/* ─── Segment matching ─────────────────────────────────────────── */

type FeSeg = { t: "static"; v: string } | { t: "param" };

function segMatch(r: Seg, f: FeSeg): boolean {
  if (r.t === "star" || r.t === "param" || f.t === "param") return true;
  return r.v === f.v;
}

function patternMatches(route: Seg[], fe: FeSeg[], open: boolean): boolean {
  if (open) {
    if (route.length < fe.length) return false;
    return fe.every((f, i) => segMatch(route[i], f));
  }
  if (route.length !== fe.length) {
    if (route.length > 0 && route[route.length - 1].t === "star" && fe.length >= route.length - 1) {
      return route.slice(0, -1).every((r, i) => segMatch(r, fe[i]));
    }
    return false;
  }
  return fe.every((f, i) => segMatch(route[i], f));
}

function resolves(fe: FeSeg[], open: boolean): boolean {
  const second = fe[1];
  const candidates =
    second && second.t === "static"
      ? [...(buckets.get(second.v) ?? []), ...paramBucket]
      : routePatterns;
  return candidates.some((p) => patternMatches(p.segs, fe, open));
}

/** Is this fully-static path a segment-prefix of (or equal to) some
 *  registered route? For base constants composed into URLs at
 *  runtime, which the literal sweep cannot see through. */
function isRoutePrefix(path: string): boolean {
  const fe = segsOf(path).map((s): FeSeg => (s.t === "static" ? s : { t: "param" }));
  return resolves(fe, true);
}

/* ─── FE fetch-literal census ──────────────────────────────────── */

const CALLS = ["fetch", "apiJson", "apiFetch", "authedFetch", "fetchJson", "confirmedFetch"];

interface Literal {
  file: string;
  line: number;
  raw: string;
  path: string;
  segs: FeSeg[];
  open: boolean;
}

/** Parse the first argument of a call when it is a string or
 *  template literal. Interpolations become \u0001 markers; a
 *  trailing `+` concatenation marks the path open-ended. */
function parseFirstArg(text: string, i: number): { value: string; open: boolean } | null {
  while (i < text.length && /\s/.test(text[i])) i++;
  const ch = text[i];
  if (ch === '"' || ch === "'") {
    let j = i + 1;
    let out = "";
    while (j < text.length) {
      if (text[j] === "\\") {
        out += text[j + 1] ?? "";
        j += 2;
        continue;
      }
      if (text[j] === ch) break;
      out += text[j];
      j++;
    }
    let k = j + 1;
    while (k < text.length && /\s/.test(text[k])) k++;
    return { value: out, open: text[k] === "+" };
  }
  if (ch === "`") {
    let j = i + 1;
    let out = "";
    let depth = 0;
    while (j < text.length) {
      const c = text[j];
      if (c === "\\") {
        out += text[j + 1] ?? "";
        j += 2;
        continue;
      }
      if (depth === 0 && c === "`") break;
      if (c === "$" && text[j + 1] === "{") {
        out += "\u0001";
        depth++;
        j += 2;
        continue;
      }
      if (depth > 0) {
        if (c === "{") depth++;
        else if (c === "}") {
          depth--;
          j++;
          continue;
        } else if (c === "`") {
          let d2 = 0;
          j++;
          while (j < text.length) {
            if (text[j] === "\\") {
              j += 2;
              continue;
            }
            if (text[j] === "`" && d2 === 0) {
              j++;
              break;
            }
            if (text[j] === "$" && text[j + 1] === "{") d2++;
            else if (text[j] === "}" && d2 > 0) d2--;
            j++;
          }
          continue;
        }
        j++;
        continue;
      }
      out += c;
      j++;
    }
    let k = j + 1;
    while (k < text.length && /\s/.test(text[k])) k++;
    return { value: out, open: text[k] === "+" };
  }
  return null;
}

const feFiles = walk(FE_SRC, [".ts", ".tsx"]).filter(
  (f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"),
);
const literals: Literal[] = [];
for (const file of feFiles) {
  const text = readFileSync(file, "utf8");
  for (const call of CALLS) {
    const re = new RegExp(`\\b${call}\\s*\\(`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const arg = parseFirstArg(text, m.index + m[0].length);
      if (!arg) continue;
      const { value, open } = arg;
      if (!value.startsWith("/") || value.startsWith("//")) continue;
      let p = value;
      const qi = p.search(/[?#]/);
      if (qi >= 0) p = p.slice(0, qi);
      /* `/api${path}` — the memberships helper (dedicated block
       * below) prepends /api to a caller-supplied path. The head
       * segment is static "api" and the path continues inside the
       * interpolation, so the literal is open-ended. */
      const apiHead = p === "/api\u0001" || p.startsWith("/api\u0001/");
      const segs: FeSeg[] = apiHead
        ? [{ t: "static", v: "api" }]
        : p
            .split("/")
            .filter((s) => s.length > 0)
            .map((s): FeSeg => (s.includes("\u0001") ? { t: "param" } : { t: "static", v: s }));
      literals.push({
        file: file.slice(FE_SRC.length),
        line: text.slice(0, m.index).split("\n").length,
        raw: value,
        path: p,
        segs,
        open: open || apiHead,
      });
    }
  }
}

const apiLiterals = literals.filter((l) => l.path === "/api" || l.path.startsWith("/api/") || l.path.startsWith("/api\u0001"));
const otherLiterals = literals.filter((l) => !apiLiterals.includes(l));

const read = (rel: string) => readFileSync(resolve(FE_SRC, rel), "utf8");

/* ─── The pin ──────────────────────────────────────────────────── */

describe("fetch-literal route truth — the census is real and the resolver has teeth", () => {
  it("the extraction is not vacuous (real route table, real fetch census)", () => {
    expect(routePatterns.length).toBeGreaterThan(1500);
    expect(feFiles.length).toBeGreaterThan(1000);
    expect(apiLiterals.length).toBeGreaterThan(1400);
    expect(new Set(apiLiterals.map((l) => l.path)).size).toBeGreaterThan(800);
  });

  it("rejects paths no route registers (the pin cannot pass vacuously)", () => {
    const dead: FeSeg[] = [
      { t: "static", v: "api" },
      { t: "static", v: "definitely-not-a-real-route" },
    ];
    expect(resolves(dead, false)).toBe(false);
    const deadTail: FeSeg[] = [
      { t: "static", v: "api" },
      { t: "static", v: "projects" },
      { t: "param" },
      { t: "static", v: "bogus-tail" },
    ];
    expect(resolves(deadTail, false)).toBe(false);
  });

  it("resolves loop-registered template routes (live-highlights verbs)", () => {
    /* live-highlights.ts registers approve/dismiss/refresh in a
     * `for (const verb of …)` loop with a template path. If the
     * table above ever goes blind to that shape, these three FE
     * calls would look dead — pin that they resolve. */
    for (const verb of ["approve", "dismiss", "refresh"]) {
      const fe: FeSeg[] = [
        { t: "static", v: "api" },
        { t: "static", v: "live-streams" },
        { t: "param" },
        { t: "static", v: "highlights" },
        { t: "param" },
        { t: "static", v: verb },
      ];
      expect(resolves(fe, false), `/api/live-streams/:id/highlights/:pid/${verb}`).toBe(true);
    }
  });
});

describe("fetch-literal route truth — every fetch door lands on a registered API route", () => {
  it(
    "every /api literal handed to fetch or a fetch wrapper resolves",
    { timeout: 120_000 },
    () => {
      const failures: string[] = [];
      for (const l of apiLiterals) {
        if (!resolves(l.segs, l.open)) failures.push(`${l.file}:${l.line} → ${l.raw}`);
      }
      expect(failures, failures.join("\n")).toEqual([]);
    },
  );

  it("the only non-/api fetch literals are the staging gate's own server paths", () => {
    /* /__staging_logout is answered by the staging gate at server
     * level (see nav-route-existence.test.ts); it is not an API
     * route and must stay the lone exception class. A future fetch
     * missing its /api prefix — the floating-admin bug — lands
     * here and fails. */
    const offenders = otherLiterals.filter((l) => l.path !== "/__staging_logout");
    expect(
      offenders.map((o) => `${o.file}:${o.line} → ${o.raw}`),
    ).toEqual([]);
    expect(otherLiterals.length).toBeGreaterThan(0); // the exception is exercised
  });
});

describe("fetch doors the literal sweep cannot see through", () => {
  it("pages/memberships.tsx — the api() helper prepends /api, and every path it is handed resolves", () => {
    const src = read("pages/memberships.tsx");
    expect(src).toContain("fetch(`/api${path}`");
    const handed: string[] = [];
    for (const m of src.matchAll(/\bapi\(\s*"([^"]+)"/g)) handed.push(m[1]);
    expect(handed.length).toBeGreaterThan(5);
    for (const h of handed) {
      const fe = segsOf("/api" + h).map((s): FeSeg => (s.t === "static" ? s : { t: "param" }));
      expect(resolves(fe, false), `/api${h}`).toBe(true);
    }
  });

  it("base constants composed into fetch URLs sit on real route families", () => {
    const storefront = read("lib/storefront-api.ts");
    const base = storefront.match(/const BASE = "([^"]+)"/)?.[1];
    const giftBase = storefront.match(/const GIFT_BASE = "([^"]+)"/)?.[1];
    expect(base).toBe("/api/storefront");
    expect(giftBase).toBe("/api/gift-cards");
    expect(isRoutePrefix(base!), base).toBe(true);
    expect(isRoutePrefix(giftBase!), giftBase).toBe(true);

    const supporter = read("lib/supporter-board.ts");
    const boardPath = supporter.match(/SUPPORTER_BOARD_PATH = "([^"]+)"/)?.[1];
    expect(boardPath).toBe("/api/supporter-board");
    expect(isRoutePrefix(boardPath!), boardPath).toBe(true);

    const benches = read("lib/world/audio-benches.ts");
    const polls = [...benches.matchAll(/jobPoll\("([^"]+)"\)/g)].map((m) => m[1]);
    expect(polls.length).toBeGreaterThan(0);
    for (const p of polls) expect(isRoutePrefix(p), p).toBe(true);
  });

  it("every named /api path constant in the FE resolves to a real route family", { timeout: 120_000 }, () => {
    /* The other invisible shape: a path stored in a named constant
     * (CHAT_SPEAK_PATH, CO_POSTS_PATH, …) and handed to fetch as an
     * identifier, often with segments appended at the call site.
     * The literal sweep never sees the string at a call, so census
     * the constants themselves: each must be a segment-prefix of
     * (or equal to) a registered route — a typo'd or retired family
     * name fails here at segment granularity. */
    const found: Array<{ file: string; name: string; path: string }> = [];
    for (const file of feFiles) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*=\s*"(\/api[^"]*)"/g)) {
        /* Query strings ride two of the constants (…?limit=30);
         * like the literal census, only the pathname is routed. */
        found.push({ file: file.slice(FE_SRC.length), name: m[1], path: m[2].split(/[?#]/)[0] });
      }
    }
    expect(found.length).toBeGreaterThan(50);
    const failures = found
      /* The one WebSocket path is registered on the socket gateway,
       * not the HTTP route table — the dedicated block below pins
       * it against gateway.register() instead. */
      .filter((c) => c.path !== "/api/live/controller/ws")
      .filter((c) => !isRoutePrefix(c.path))
      .map((c) => `${c.file} ${c.name} = "${c.path}"`);
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("the World controller socket path is the one the server gateway registers", () => {
    const desk = read("lib/world/live-desk.ts");
    const wsPath = desk.match(/CONTROLLER_WS_PATH = "([^"]+)"/)?.[1];
    expect(wsPath).toBe("/api/live/controller/ws");
    const control = readFileSync(join(API_SRC, "routes/live-control.ts"), "utf8");
    expect(control).toContain(`gateway.register("${wsPath}"`);
  });
});
