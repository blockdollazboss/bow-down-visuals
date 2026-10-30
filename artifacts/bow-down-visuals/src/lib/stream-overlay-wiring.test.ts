/**
 * Stream overlay surfaces — wiring pins (stack900 lane C2).
 * vitest here runs in node, so per the repo's established split the
 * pure logic is proven in stream-overlay-client.test.ts and this
 * suite pins the composition: the chromeless routing, the
 * transparent stage, the TEST label, the honest empty goal bar, and
 * the desk's doors — the parts a refactor could silently unwire.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const read = (...parts: string[]) => readFileSync(join(root, ...parts), "utf8");

const appSrc = read("App.tsx");
const alertsPageSrc = read("pages", "overlay-alerts.tsx");
const goalPageSrc = read("pages", "overlay-goal.tsx");
const feedSrc = read("lib", "use-overlay-feed.ts");
const cardSrc = read("components", "overlay", "OverlayAlertCard.tsx");
const goalBarSrc = read("components", "overlay", "OverlayGoalBar.tsx");
const deskSrc = read("components", "promote", "StreamOverlaysPanel.tsx");
const promoteSrc = read("pages", "promote.tsx");

describe("chromeless routing", () => {
  it("AppShell branches /overlay/* before the guest gate and the shell", () => {
    const branchAt = appSrc.indexOf('location.startsWith("/overlay/")');
    const gateAt = appSrc.indexOf("<GuestGate>");
    expect(branchAt).toBeGreaterThan(-1);
    expect(gateAt).toBeGreaterThan(branchAt);
    expect(appSrc).toContain('<Route path="/overlay/alerts"><OverlayAlertsPage /></Route>');
    expect(appSrc).toContain('<Route path="/overlay/goal"><OverlayGoalPage /></Route>');
    // Unknown overlay paths render nothing — never a 404 on stream.
    expect(appSrc).toContain("<Route>{() => null}</Route>");
  });

  it("both pages take the transparent stage and read token + style from the URL", () => {
    for (const src of [alertsPageSrc, goalPageSrc]) {
      expect(src).toContain("useTransparentStage()");
      expect(src).toContain('params.get("token")');
      expect(src).toContain('params.get("style") === "light" ? "light" : "dark"');
      expect(src).toContain("bg-transparent");
    }
  });
});

describe("the feed", () => {
  it("makes the document transparent while mounted and restores it after", () => {
    expect(feedSrc).toContain('root.style.background = "transparent"');
    expect(feedSrc).toContain('body.style.background = "transparent"');
    expect(feedSrc).toContain("root.style.background = prev.rootBackground");
    expect(feedSrc).toContain("body.style.background = prev.bodyBackground");
  });

  it("reconnects a dropped socket and goes quiet on a dead token", () => {
    expect(feedSrc).toContain("socket.onclose");
    expect(feedSrc).toContain("window.setTimeout(connect, 3000)");
    expect(feedSrc).toContain('res.status === 401');
    expect(feedSrc).toContain('setStatus("dead")');
  });

  it("pumps alerts on the shared display constant", () => {
    expect(feedSrc).toContain("ALERT_DISPLAY_MS");
    expect(cardSrc).toContain("ALERT_DISPLAY_MS");
  });
});

describe("alert card honesty", () => {
  it("labels TEST alerts on their face, from the alert's own flag", () => {
    expect(cardSrc).toContain('data-testid="overlay-alert-test-badge"');
    expect(cardSrc).toContain("alert.test &&");
  });

  it("paints with explicit hex, never theme classes a remap could move", () => {
    expect(cardSrc).not.toContain("bg-black");
    expect(cardSrc).not.toContain("text-white");
    expect(cardSrc).toContain("#12100C");
    expect(cardSrc).toContain("#FBF6E9");
  });

  it("names all four alert kinds", () => {
    for (const eyebrow of ["New tip", "New follower", "New member", "Test alert"]) {
      expect(cardSrc).toContain(eyebrow);
    }
  });
});

describe("goal bar honesty", () => {
  it("renders nothing when there is no goal", () => {
    expect(goalBarSrc).toContain("if (percent === null || state.goal.goalVb === null) return null;");
    expect(goalBarSrc).toContain('data-testid="overlay-goal-fill"');
    expect(goalBarSrc).toContain("width: `${percent}%`");
  });
});

describe("the desk in Promote", () => {
  it("is mounted on the Promote page", () => {
    expect(promoteSrc).toContain("StreamOverlaysPanel");
    expect(promoteSrc).toContain("<StreamOverlaysPanel />");
  });

  it("speaks plain words and carries both links plus test + reset", () => {
    expect(deskSrc).toContain("Widgets for your stream");
    expect(deskSrc).toContain(
      "Copy the link, paste it into your streaming app as a browser source, and your tips and",
    );
    expect(deskSrc).toContain("fans show up live on screen.");
    expect(deskSrc).toContain('testId="overlay-link-alerts"');
    expect(deskSrc).toContain('testId="overlay-link-goal"');
    expect(deskSrc).toContain('copyTestId="overlay-copy-alerts"');
    expect(deskSrc).toContain('copyTestId="overlay-copy-goal"');
    expect(deskSrc).toContain("data-testid={testId}");
    expect(deskSrc).toContain('data-testid="overlay-test-alert"');
    expect(deskSrc).toContain('data-testid="overlay-reset-token"');
    expect(deskSrc).toContain('fetch("/api/overlay/me"');
    expect(deskSrc).toContain('"/api/overlay/test-alert"');
    expect(deskSrc).toContain('"/api/overlay/token/reset"');
  });

  it("warns that the links are private and the reset kills the old ones", () => {
    expect(deskSrc).toContain("Keep these links private");
    expect(deskSrc).toContain("every old link stops working at once");
    expect(deskSrc).toContain("Tap again to make fresh links");
  });

  it("points goal-setting at the Go Live studio instead of duplicating it", () => {
    expect(deskSrc).toContain("Set the goal itself in the Go Live studio");
  });
});
