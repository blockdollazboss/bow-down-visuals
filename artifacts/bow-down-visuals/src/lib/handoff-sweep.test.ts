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
import { DEFAULT_POST_LOGIN_PATH, postLoginPath, safeNextPath } from "./auth-next";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const promoteButtonSource = read("../components/storefront/PromoteButton.tsx");
const promotePageSource = read("../pages/promote.tsx");
const loginPageSource = read("../pages/login.tsx");
const presavePageSource = read("../pages/presave.tsx");
const unlockPageSource = read("../pages/unlock.tsx");

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

describe("E8 sweep fix 2 — /login?next= is honored after sign-in", () => {
  it("the senders exist and carry a return path (pre-save + unlock pages)", () => {
    expect(presavePageSource).toContain("/login?next=${encodeURIComponent(`/presave/${slug}`)}");
    expect(unlockPageSource).toContain("/login?next=${encodeURIComponent(`/unlock/${slug}`)}");
  });

  it("safeNextPath accepts same-origin relative paths", () => {
    expect(safeNextPath("?next=/presave/my-song")).toBe("/presave/my-song");
    expect(safeNextPath("?next=%2Funlock%2Fabc%3Fref%3DX")).toBe("/unlock/abc?ref=X");
    expect(safeNextPath("?session=expired&next=/world")).toBe("/world");
  });

  it("safeNextPath rejects anything that could become an open redirect", () => {
    expect(safeNextPath("?next=https://evil.example/phish")).toBeNull();
    expect(safeNextPath("?next=//evil.example/phish")).toBeNull();
    expect(safeNextPath("?next=%2F%2Fevil.example")).toBeNull();
    expect(safeNextPath("?next=/\\evil.example")).toBeNull();
    expect(safeNextPath("?next=javascript:alert(1)")).toBeNull();
    expect(safeNextPath("?next=")).toBeNull();
    expect(safeNextPath("")).toBeNull();
    expect(safeNextPath("?session=expired")).toBeNull();
  });

  it("postLoginPath falls back to the historical default without a valid next", () => {
    expect(DEFAULT_POST_LOGIN_PATH).toBe("/choose-artist");
    expect(postLoginPath("")).toBe("/choose-artist");
    expect(postLoginPath("?next=https://evil.example")).toBe("/choose-artist");
    expect(postLoginPath("?next=/presave/x")).toBe("/presave/x");
  });

  it("the login page routes BOTH success paths through postLoginPath", () => {
    expect(loginPageSource).toContain('import { postLoginPath } from "@/lib/auth-next"');
    const uses = loginPageSource.match(/setLocation\(postLoginPath\(window\.location\.search\)\)/g) ?? [];
    expect(uses).toHaveLength(2);
    expect(loginPageSource).not.toContain('setLocation("/choose-artist")');
  });
});
