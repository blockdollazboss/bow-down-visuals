import { describe, it, expect } from "vitest";
import type { Router } from "express";

import communityRouter from "../community";

/* Recursively collect METHOD + path from an Express router's layer stack. */
function collectRoutes(router: Router, prefix = ""): Array<{ method: string; path: string }> {
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
      for (const m of methods) out.push({ method: m.toUpperCase(), path: prefix + l.route.path });
    } else if (Array.isArray(l.handle?.stack)) {
      out.push(...collectRoutes(l.handle as Router, prefix));
    }
  }
  return out;
}

const EXPECTED: Array<{ method: string; path: string }> = [
  // Groups
  { method: "POST", path: "/groups" },
  { method: "GET", path: "/groups" },
  { method: "GET", path: "/groups/:slug" },
  { method: "POST", path: "/groups/:slug/join" },
  { method: "POST", path: "/groups/:slug/leave" },
  { method: "GET", path: "/groups/:slug/feed" },
  { method: "POST", path: "/groups/:slug/posts" },
  { method: "DELETE", path: "/groups/:slug/posts/:postId" },
  { method: "DELETE", path: "/groups/:slug/members/:userId" },
  { method: "POST", path: "/groups/:slug/broadcast" },
  // Events
  { method: "POST", path: "/events" },
  { method: "GET", path: "/events" },
  { method: "GET", path: "/events/:id" },
  { method: "POST", path: "/events/:id/rsvp" },
  { method: "POST", path: "/events/:id/unrsvp" },
  { method: "GET", path: "/events/:id/stats" },
  // DMs
  { method: "GET", path: "/dm/conversations" },
  { method: "POST", path: "/dm/start" },
  { method: "GET", path: "/dm/:id/messages" },
  { method: "POST", path: "/dm/:id/send" },
  { method: "POST", path: "/dm/:id/accept" },
  { method: "POST", path: "/dm/:id/decline" },
  { method: "POST", path: "/dm/:id/block" },
  // Explore + link-graph glue
  { method: "GET", path: "/explore" },
  { method: "GET", path: "/profiles/resolve" },
];

describe("community router: route contract", () => {
  const routes = collectRoutes(communityRouter);

  for (const r of EXPECTED) {
    it(`registers ${r.method} ${r.path}`, () => {
      expect(routes).toContainEqual(r);
    });
  }

  it("registers exactly the expected route count (no accidental extras)", () => {
    expect(routes).toHaveLength(EXPECTED.length);
  });
});
