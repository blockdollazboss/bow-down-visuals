/**
 * broadcast-dock.test.ts — Stack 200 Lane C item 2.
 *
 * Broadcast channels + premieres were built, maintained by tests, and
 * UNREACHABLE: the standalone /broadcast page still existed, but the
 * findability wave had replaced its route with a redirect to /go-live
 * and no door led to the surface from anywhere. The fix docks the
 * surface where it belongs in the CREATE flow — Go Live's Broadcast
 * tab, beside BroadcastStudio — as BroadcastChannelsPanel, and
 * retires the orphaned page file. The /broadcast → /go-live redirect
 * stays, so old links land on the hub that now hosts the surface.
 *
 * These pins hold the dock: the panel is wired into the broadcast
 * tab, it carries the full surface (channels rails + inbox + the
 * SchedulePremiereForm whose only host this was), the dead page file
 * is gone, and the redirect is intact. The per-source settle law for
 * the surface itself stays pinned by resilience-s28 #26, which now
 * reads the panel.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const goLive = read("../pages/go-live.tsx");
const app = read("../App.tsx");
const panel = read("../components/go-live/BroadcastChannelsPanel.tsx");

describe("broadcast channels + premieres dock in Go Live (stack200 C1)", () => {
  it("go-live imports the panel and renders it in the Broadcast tab, beside the studio", () => {
    expect(goLive).toContain('import BroadcastChannelsPanel from "@/components/go-live/BroadcastChannelsPanel"');
    const studioAt = goLive.indexOf("<BroadcastStudio />");
    const panelAt = goLive.indexOf("<BroadcastChannelsPanel />");
    const tabAt = goLive.indexOf('tab === "broadcast"');
    expect(tabAt).toBeGreaterThan(-1);
    expect(studioAt).toBeGreaterThan(tabAt);
    expect(panelAt).toBeGreaterThan(studioAt);
  });

  it("the panel carries the whole surface: channels, inbox and the premiere form", () => {
    expect(panel).toContain("reachApi.broadcastChannels");
    expect(panel).toContain("reachApi.broadcastInbox");
    expect(panel).toContain("reachApi.createBroadcastChannel");
    expect(panel).toContain("<SchedulePremiereForm />");
  });

  it("the panel is a panel — it does not restamp the page title or page chrome", () => {
    expect(panel).not.toContain("usePageTitle");
    expect(panel).not.toContain("min-h-screen");
  });

  it("the orphaned page file is retired and the router never imports it", () => {
    expect(existsSync(new URL("../pages/broadcast.tsx", import.meta.url))).toBe(false);
    expect(app).not.toContain("pages/broadcast");
  });

  it("the /broadcast redirect stays — old links land on the hub that hosts the surface", () => {
    expect(app).toContain('<Route path="/broadcast"><Redirect to="/go-live" /></Route>');
  });
});
