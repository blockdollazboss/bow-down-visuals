/**
 * handoff-sweep.test.ts — Stack-30 Lane E (E8).
 *
 * Site-wide audit of the E1/E2 defect class: outbound links carrying
 * query params whose target page never reads them (dead handoffs).
 * Method: every href/navigation construction with a query string in
 * the frontend was grouped by target route, and each target's param
 * reads were checked — including the composition cases, where a page
 * mounts another page/component that reads window.location.search
 * itself (those are ALIVE: e.g. /create?panel=song&concept= is read by
 * the mounted MakeSongModule; /my-projects?tab=songs&song=&addToAlbum=
 * by the mounted SongsPage; duet/stitch/sound by the editor's mounted
 * Repurpose; sub/videoUrl by Audio Studio's mounted AiAudio/Podcast).
 *
 * Two provable dead handoffs were found and fixed (this file pins
 * both); the full audit table lives in the lane report. Two more dead
 * params were found but deliberately NOT fixed here:
 *  - /scheduler?…&project= (ExportSection): the scheduler never reads
 *    project, but Lane C's C3 owns the scheduler-handoff construction
 *    surface and preserved the param in buildSchedulerHref on purpose.
 *  - /scheduler?tab=calendar&niche= (NicheAnalyzerPanel): niche IS
 *    read — for tab routing, documented in scheduler.tsx — only its
 *    value goes unconsumed by the planner; intent is arguable.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const promoteButtonSource = read("../components/storefront/PromoteButton.tsx");
const promotePageSource = read("../pages/promote.tsx");

describe("E8 sweep fix 1 — the product promote handoff lands in the promote page's focus", () => {
  it("the promote page reads exactly one deep-link prefill: focus", () => {
    expect(promotePageSource).toContain('new URLSearchParams(window.location.search).get("focus")');
    expect(promotePageSource).not.toContain('get("product")');
  });

  it("PromoteButton sends the product through focus, not the unread product param", () => {
    expect(promoteButtonSource).not.toContain("/promote?product=");
    expect(promoteButtonSource).toContain(
      "/promote?focus=${encodeURIComponent(`${product.title} — ${product.price}`)}",
    );
  });
});
