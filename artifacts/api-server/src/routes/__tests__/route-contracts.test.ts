import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Router } from "express";

import autoVideoPlanRouter from "../generate/auto-video-plan";
import exportDoctorRouter from "../generate/export-doctor";

/* Recursively collect METHOD + path from an Express router's layer stack. */
function collectRoutes(
  router: Router,
  prefix = "",
): Array<{ method: string; path: string }> {
  const out: Array<{ method: string; path: string }> = [];
  const stack = (router as unknown as { stack?: unknown[] }).stack ?? [];
  for (const layer of stack) {
    const l = layer as {
      route?: { path?: string; methods?: Record<string, boolean> };
      handle?: { stack?: unknown[] };
    };
    if (typeof l.route?.path === "string") {
      const methods = Object.keys(l.route.methods ?? {}).filter(
        (m) => m !== "_all" && l.route!.methods![m],
      );
      for (const m of methods)
        out.push({ method: m.toUpperCase(), path: prefix + l.route.path });
    } else if (Array.isArray(l.handle?.stack)) {
      out.push(...collectRoutes(l.handle as Router, prefix));
    }
  }
  return out;
}

const SECTIONS_DIR = path.resolve(
  process.cwd(),
  "../bow-down-visuals/src/components/editor/sections",
);

/** All static fetch("/api/…") URLs used by a frontend component file. */
function frontendApiPaths(file: string): string[] {
  const src = readFileSync(path.join(SECTIONS_DIR, file), "utf8");
  const found = new Set<string>();
  for (const m of src.matchAll(/fetch\("(\/api\/[^"]+)"\)/g)) found.add(m[1]);
  return [...found];
}

describe("route contracts: frontend fetch URLs must match registered backend routes", () => {
  const autoPlanRoutes = collectRoutes(autoVideoPlanRouter);
  const doctorRoutes = collectRoutes(exportDoctorRouter);
  const routesByFile: Record<string, Array<{ method: string; path: string }>> =
    {
      "AutoDirectorPanel.tsx": autoPlanRoutes,
      "ExportDoctor.tsx": doctorRoutes,
    };

  it("registers POST /auto-video-plan (Bug 1 regression: frontend called /api/generate/auto-video-plan)", () => {
    expect(autoPlanRoutes).toContainEqual({
      method: "POST",
      path: "/auto-video-plan",
    });
  });

  it("registers POST /export-doctor/export-overlays-range (Bug 2 regression: route was missing entirely)", () => {
    expect(doctorRoutes).toContainEqual({
      method: "POST",
      path: "/export-doctor/export-overlays-range",
    });
  });

  for (const file of Object.keys(routesByFile)) {
    it(`${file}: every fetch("/api/…") URL resolves to a registered backend route`, () => {
      const routes = routesByFile[file];
      const missing: string[] = [];
      for (const url of frontendApiPaths(file)) {
        const routePath = url.replace(/^\/api/, "");
        if (!routes.some((r) => r.path === routePath)) missing.push(url);
      }
      expect(missing).toEqual([]);
    });
  }
});
