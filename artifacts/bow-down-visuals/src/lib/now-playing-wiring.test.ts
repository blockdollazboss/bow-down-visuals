/**
 * Now-playing overlay — wiring pins (stack900 lane D3).
 * vitest here runs in node, so per the repo's established split the
 * pure logic is proven in now-playing-client.test.ts and
 * now-playing-reporter.test.ts, and this suite pins the composition:
 * the chromeless routing, the transparent stage, the honest empty
 * card, and the studio's reporter wiring — the parts a refactor
 * could silently unwire.
 *
 * JOIN NOTE: lane C2's stream-overlay-wiring.test.ts pins the same
 * App branch for /overlay/alerts + /overlay/goal; at the join the
 * two suites' branch expectations merge (the branch then carries
 * all three routes) — guest-gate.test.ts carries the same note.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const read = (...parts: string[]) => readFileSync(join(root, ...parts), "utf8");

const appSrc = read("App.tsx");
const pageSrc = read("pages", "overlay-now-playing.tsx");
const feedSrc = read("lib", "use-now-playing-feed.ts");
/* stack900 join composition: the transparent-stage hook was deduped
   to C2's canonical copy in use-overlay-feed.ts (D3's duplicate was
   deleted); the transparency pins below read it at its joined home,
   and the page-side pin above ("useTransparentStage()") plus the
   import assertion in the feed describe keep the wiring honest. */
const stageSrc = read("lib", "use-overlay-feed.ts");
const cardSrc = read("components", "overlay", "NowPlayingCard.tsx");
const studioSrc = read("components", "go-live", "BroadcastStudio.tsx");
const reporterSrc = read("lib", "go-live", "now-playing-reporter.ts");

describe("chromeless routing", () => {
  it("AppShell branches /overlay/* before the guest gate and the shell", () => {
    const branchAt = appSrc.indexOf('location.startsWith("/overlay/")');
    const gateAt = appSrc.indexOf("<GuestGate>");
    expect(branchAt).toBeGreaterThan(-1);
    expect(gateAt).toBeGreaterThan(branchAt);
    expect(appSrc).toContain('<Route path="/overlay/now-playing"><OverlayNowPlayingPage /></Route>');
    // No NotFound in the branch: an unknown /overlay/* path renders
    // nothing — a 404 page must never appear on a program output.
    const branch = appSrc.slice(branchAt, appSrc.indexOf("</Switch>", branchAt));
    expect(branch).not.toContain("NotFound");
  });

  it("the page takes the transparent stage and reads token + style from the URL", () => {
    expect(pageSrc).toContain("useTransparentStage()");
    expect(pageSrc).toContain('params.get("token")');
    expect(pageSrc).toContain('params.get("style") === "light" ? "light" : "dark"');
    expect(pageSrc).toContain("bg-transparent");
  });
});

describe("the feed", () => {
  it("makes the document transparent while mounted and restores it after", () => {
    expect(stageSrc).toContain('root.style.background = "transparent"');
    expect(stageSrc).toContain('body.style.background = "transparent"');
    expect(stageSrc).toContain("root.style.background = prev.rootBackground");
    expect(stageSrc).toContain("body.style.background = prev.bodyBackground");
    // The feed hook itself is poll-only at the join (the optional
    // socket fast-path seam was not taken — see the manifest).
    expect(feedSrc).not.toContain("useTransparentStage");
  });

  it("polls the token read and goes quiet on a dead token", () => {
    expect(feedSrc).toContain("/api/overlay/now-playing?token=");
    expect(feedSrc).toContain('setStatus("dead")');
  });

  it("the card renders nothing when nothing plays — no placeholder track exists", () => {
    expect(cardSrc).toContain("if (!nowPlaying) return null;");
    expect(cardSrc).not.toContain("Untitled");
    expect(cardSrc).toContain('data-testid="overlay-now-playing-card"');
    // The progress bar is duration-gated: unknown length, no bar.
    expect(cardSrc).toContain("percent !== null");
  });
});

describe("the studio reporter wiring", () => {
  it("the studio observes the program scene while live and disposes on exit", () => {
    expect(studioSrc).toContain("createNowPlayingReporter(liveId, artist, authed)");
    expect(studioSrc).toContain("stage.programScene().sources");
    expect(studioSrc).toContain("stage.pool.mediaFor(s)");
    expect(studioSrc).toContain("reporter?.dispose()");
    expect(studioSrc).toContain('fetch("/api/dj/library", { headers })');
    expect(studioSrc).toContain('fetch("/api/creator-profiles/me", { headers })');
  });

  it("the reporter only sends real fields to the owner-gated endpoints", () => {
    expect(reporterSrc).toContain("/api/live/${streamId}/now-playing");
    expect(reporterSrc).toContain('method: "POST"');
    expect(reporterSrc).toContain('method: "DELETE"');
    // Identity comes from the library match — never from a source's
    // free-text name.
    expect(reporterSrc).toContain("normalizeMediaUrl");
    expect(reporterSrc).not.toContain("source.name");
  });
});
