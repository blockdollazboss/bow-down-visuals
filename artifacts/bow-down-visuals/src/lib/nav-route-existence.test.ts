import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

/* Nav route existence (stack600 sound-library lane).
 *
 * The Sound Library's real home is the Audio Studio "sounds" tab —
 * desks.ts (desk-sounds) and the operator knowledge both point at
 * /audio-studio?tab=sounds, and /sounds was already aliased there.
 * The friendly name /sound-library had NO route at all: any door,
 * bookmark or external link using it fell into the catch-all 404.
 * Rung 1 registered /sound-library as a redirect alias to the same
 * tab. This suite pins the alias AND sweeps every nav link registry
 * (sidebar + layout chrome, desks, feature registry, chat doors,
 * hub workflows, tour, operator knowledge) so that ANY future door
 * pointing at an unregistered route fails here instead of in front
 * of a user. Extraction mirrors public-routes.test.ts's census. */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const app = read("../App.tsx");
const routePaths = new Set<string>();
for (const m of app.matchAll(/<Route\s+path="([^"]+)"/g)) routePaths.add(m[1]);

const strip = (u: string) => u.split("?")[0].split("#")[0];

/** A pathname resolves when a route declares it exactly, or a
 *  :param route matches it segment-for-segment. */
function resolves(pathname: string): boolean {
  if (routePaths.has(pathname)) return true;
  for (const r of routePaths) {
    if (!r.includes(":")) continue;
    const rp = r.split("/");
    const pp = pathname.split("/");
    if (rp.length !== pp.length) continue;
    if (rp.every((seg, i) => seg.startsWith(":") || seg === pp[i])) return true;
  }
  return false;
}

/** Every "/" string literal in a source file that names a site path.
 *  Not routes, and skipped: asset files (extension on the last
 *  segment), backend endpoints (the API mounts under /api; the
 *  staging gate answers /__staging_logout at server level), and
 *  code fragments like the "//" protocol-relative guard. */
function pathLiterals(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/"(\/[^"]*)"/g)) {
    const lit = m[1];
    if (lit.includes("${") || lit.includes(" ")) continue;
    const p = strip(lit);
    if (!p || p === "/" || p === "//") continue;
    if (/\.[a-z0-9]+$/i.test(p)) continue; // asset file, not a route
    if (p.startsWith("/api/") || p.startsWith("/__")) continue;
    out.add(lit);
  }
  return [...out];
}

const layoutDir = new URL("../components/layout/", import.meta.url);
const LINK_SOURCES: Array<[string, string]> = [
  ["desks.ts", read("../lib/desks.ts")],
  ["features.ts", read("../data/features.ts")],
  ["chat-doors.ts", read("../lib/chat-doors.ts")],
  ["hub-workflows.ts", read("../lib/hub-workflows.ts")],
  ["tour.ts", read("../lib/tour.ts")],
  ...readdirSync(layoutDir)
    .filter((f) => (f.endsWith(".tsx") || f.endsWith(".ts")) && !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"))
    .map((f) => [`layout/${f}`, read(`../components/layout/${f}`)] as [string, string]),
];

describe("nav route existence — every door in the link data lands on a registered route", () => {
  it("the extraction is not vacuous (real route table, real link data)", () => {
    expect(routePaths.size).toBeGreaterThan(150);
    let literals = 0;
    for (const [, text] of LINK_SOURCES) literals += pathLiterals(text).length;
    expect(literals).toBeGreaterThan(150);
  });

  for (const [name, text] of LINK_SOURCES) {
    it(`every path in ${name} resolves to a registered route`, () => {
      for (const lit of pathLiterals(text)) {
        expect(resolves(strip(lit)), `${name} → ${lit}`).toBe(true);
      }
    });
  }

  it("every path in the operator knowledge resolves to a registered route", () => {
    const kb = JSON.parse(read("../../../api-server/src/lib/operator-knowledge.json")) as unknown;
    const paths = new Set<string>();
    const walk = (o: unknown): void => {
      if (Array.isArray(o)) return o.forEach(walk);
      if (o && typeof o === "object") {
        for (const [k, v] of Object.entries(o)) {
          if (k === "path" && typeof v === "string") paths.add(v);
          walk(v);
        }
      }
    };
    walk(kb);
    expect(paths.size).toBeGreaterThan(150);
    for (const p of paths) {
      const s = strip(p);
      if (!s || s === "/") continue;
      expect(resolves(s), `operator-knowledge → ${p}`).toBe(true);
    }
  });
});

describe("sibling path found by the sweep — the admin panel's event door", () => {
  it("posts Cheat Code events to the served /api path, not the unmounted one", () => {
    /* The API router mounts under /api (app.ts) and cheat-code.ts
       documents /api/cheat-code/admin/events; every other fetch in
       this file carries the prefix. The create-event POST was the
       lone unprefixed fetch in the FE source — it hit the SPA
       fallback instead of the API. */
    const panel = read("../components/layout/floating-admin-panel.tsx");
    expect(panel).toContain('fetch("/api/cheat-code/admin/events"');
    expect(panel).not.toContain('fetch("/cheat-code/admin/events"');
  });
});

describe("the Sound Library door", () => {
  it("/sound-library is a registered redirect alias to the Audio Studio sounds tab", () => {
    expect(app).toContain(
      '<Route path="/sound-library"><Redirect to="/audio-studio?tab=sounds" /></Route>',
    );
    expect(resolves("/sound-library")).toBe(true);
    expect(resolves("/audio-studio")).toBe(true);
  });

  it("the desk registry points the Sound Library module at the same tab", () => {
    expect(read("../lib/desks.ts")).toContain(
      'm("audio", "sounds", "Sound Library", "/audio-studio?tab=sounds"',
    );
  });
});
