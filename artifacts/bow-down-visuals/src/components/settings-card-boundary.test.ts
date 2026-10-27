/**
 * settings-card-boundary.test.ts — QC-200 G4: Settings per-card error
 * isolation (owner resilience law: "one bad section should never take
 * the whole dashboard down").
 *
 * The defect: /settings had only the App-level RouteErrorBoundary, so
 * one card's RENDER throw unmounted the whole page — every card below
 * the thrower, theme desk included, vanished. Data errors were already
 * isolated per card; this suite pins the render-throw layer.
 *
 * How it tests: vitest runs in node with no DOM harness, and React's
 * server renderers don't exercise class-boundary catches the way the
 * client renderer does, so the catch machinery is verified at the
 * level this repo's suites use for component contracts —
 *  (a) the REAL boundary class, instantiated directly: its derived
 *      error state, the fallback markup it renders for a failed card,
 *      the healthy passthrough, and the retry handler's state math;
 *  (b) composition: a failed card's fallback rendered alongside a
 *      healthy card and page content — all three present in one tree;
 *  (c) source pins that settings.tsx wraps EVERY card (all 23 on the joined tree) and
 *      that the boundary carries the catch contract. The client-side
 *      catch itself is React's documented class-boundary behavior —
 *      the same mechanism the production RouteErrorBoundary relies on.
 */
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { SettingsCardBoundaryCore } from "./settings-card-boundary";

const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");
const boundarySource = read("./settings-card-boundary.ts");
const wrapperSource = read("./SettingsCardBoundary.tsx");
const settingsSource = read("../pages/settings.tsx");

const LABELS = {
  title: "This section hit a snag",
  description:
    "Something glitched while this part of Settings was loading. The rest of your settings are fine — try this section again.",
  retryLabel: "Try again",
};

function makeBoundary(name: string, child: ReactElement, isLight = false) {
  return new SettingsCardBoundaryCore({
    name,
    isLight,
    ...LABELS,
    children: child,
  });
}

function failWith(boundary: SettingsCardBoundaryCore, error: Error) {
  const derived = SettingsCardBoundaryCore.getDerivedStateFromError(error);
  Object.assign(boundary.state, derived);
}

describe("SettingsCardBoundary — healthy card passes through untouched", () => {
  it("renders the child content with no error chrome", () => {
    const boundary = makeBoundary(
      "sounds",
      createElement("p", null, "HEALTHY CARD"),
    );
    const html = renderToStaticMarkup(boundary.render() as ReactElement);
    expect(html).toContain("HEALTHY CARD");
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("settings-card-error");
  });
});

describe("SettingsCardBoundary — a failed card shows its OWN error state", () => {
  it("getDerivedStateFromError captures the thrown error", () => {
    const boom = new Error("boom");
    expect(SettingsCardBoundaryCore.getDerivedStateFromError(boom)).toEqual({
      error: boom,
    });
  });

  it("the fallback is an honest per-card error card with a retry", () => {
    const boundary = makeBoundary(
      "sounds",
      createElement("p", null, "HEALTHY CARD"),
    );
    failWith(boundary, new Error("render blew up"));
    const html = renderToStaticMarkup(boundary.render() as ReactElement);
    expect(html).toContain('role="alert"');
    expect(html).toContain('data-testid="settings-card-error-sounds"');
    expect(html).toContain('data-settings-card="sounds"');
    expect(html).toContain(LABELS.title);
    expect(html).toContain("The rest of your settings are fine");
    expect(html).toContain(LABELS.retryLabel);
    expect(html).toContain("<button");
    /* The failed card's own content is replaced, not half-rendered. */
    expect(html).not.toContain("HEALTHY CARD");
  });

  it("componentDidCatch reports the failing card by slug", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const boundary = makeBoundary("theme-packs", createElement("p", null, "x"));
    boundary.componentDidCatch(new Error("boom"), {
      componentStack: "\n    in ThemePacksDesk",
    } as never);
    expect(spy).toHaveBeenCalled();
    expect(String(spy.mock.calls[0]?.[0])).toContain(
      "[SettingsCardBoundary:theme-packs]",
    );
    spy.mockRestore();
  });
});

describe("SettingsCardBoundary — one bad card never takes the others down", () => {
  it("a failed card's fallback renders alongside healthy cards and page content", () => {
    const failed = makeBoundary(
      "sounds",
      createElement("p", null, "SOUNDS CARD"),
    );
    failWith(failed, new Error("sounds render blew up"));
    const healthy = makeBoundary(
      "theme-packs",
      createElement("p", null, "THEME DESK CARD"),
    );
    const html = renderToStaticMarkup(
      createElement(
        "div",
        null,
        createElement("h1", null, "Settings"),
        failed.render() as ReactElement,
        healthy.render() as ReactElement,
        createElement("span", null, "DANGER ZONE BELOW"),
      ),
    );
    /* Page shell + the cards BELOW the failed one all still render. */
    expect(html).toContain("Settings");
    expect(html).toContain('data-testid="settings-card-error-sounds"');
    expect(html).toContain("THEME DESK CARD");
    expect(html).toContain("DANGER ZONE BELOW");
    expect(html).not.toContain("SOUNDS CARD");
  });
});

describe("SettingsCardBoundary — fallback exists in BOTH themes", () => {
  it("light theme renders the ivory fallback, dark the solid dark slab", () => {
    const light = makeBoundary(
      "sounds",
      createElement("p", null, "X"),
      true,
    );
    failWith(light, new Error("boom"));
    const lightHtml = renderToStaticMarkup(light.render() as ReactElement);
    expect(lightHtml).toContain("from-[#FCF7EA]");
    expect(lightHtml).toContain("text-[#6B5B36]");

    const dark = makeBoundary("sounds", createElement("p", null, "X"), false);
    failWith(dark, new Error("boom"));
    const darkHtml = renderToStaticMarkup(dark.render() as ReactElement);
    expect(darkHtml).toContain("from-[#14100a]");
    expect(darkHtml).not.toContain("from-[#FCF7EA]");
  });

  it("two failed cards each show their OWN error; a third stays healthy", () => {
    const a = makeBoundary("sounds", createElement("p", null, "SOUNDS"));
    failWith(a, new Error("sounds blew up"));
    const b = makeBoundary("discord-webhook", createElement("p", null, "DISCORD"));
    failWith(b, new Error("discord blew up"));
    const c = makeBoundary(
      "theme-packs",
      createElement("p", null, "THEME DESK CARD"),
    );
    const html = renderToStaticMarkup(
      createElement(
        "div",
        null,
        a.render() as ReactElement,
        b.render() as ReactElement,
        c.render() as ReactElement,
      ),
    );
    expect(html).toContain('data-testid="settings-card-error-sounds"');
    expect(html).toContain('data-testid="settings-card-error-discord-webhook"');
    expect(html).toContain("THEME DESK CARD");
    expect(html).not.toContain("SOUNDS");
    expect(html).not.toContain("DISCORD");
  });
});

describe("SettingsCardBoundary — retry remounts just the failed card", () => {
  it("handleRetry clears the error and bumps the remount attempt", () => {
    const boundary = makeBoundary(
      "sounds",
      createElement("p", null, "HEALTHY CARD"),
    );
    failWith(boundary, new Error("boom"));
    expect(boundary.state.error).not.toBeNull();
    const attemptBefore = boundary.state.attempt;
    /* Capture the updater the handler passes to setState and apply it
       the way React would. */
    let captured: unknown;
    boundary.setState = ((updater: unknown) => {
      captured = updater;
    }) as never;
    boundary.handleRetry();
    expect(typeof captured).toBe("function");
    const next = (captured as (s: typeof boundary.state) => object)(
      boundary.state,
    );
    Object.assign(boundary.state, next);
    expect(boundary.state.error).toBeNull();
    expect(boundary.state.attempt).toBe(attemptBefore + 1);
    /* Back to the healthy passthrough. */
    const html = renderToStaticMarkup(boundary.render() as ReactElement);
    expect(html).toContain("HEALTHY CARD");
    expect(html).not.toContain('role="alert"');
  });

  it("the remount is keyed by attempt, so the card restarts from scratch", () => {
    expect(boundarySource).toContain("key: this.state.attempt");
    expect(boundarySource).toContain("attempt: s.attempt + 1");
  });
});

describe("SettingsCardBoundary — the catch contract (source pins)", () => {
  it("is a real error boundary: derived state + didCatch with the card slug", () => {
    expect(boundarySource).toContain("static getDerivedStateFromError");
    expect(boundarySource).toContain("componentDidCatch");
    expect(boundarySource).toContain("[SettingsCardBoundary:${this.props.name}]");
  });
  it("the exported wrapper resolves copy + theme for the class", () => {
    expect(wrapperSource).toContain("export function SettingsCardBoundary");
    expect(wrapperSource).toContain('t("settings.cardErrorTitle"');
    expect(wrapperSource).toContain("useIsLightTheme()");
    expect(wrapperSource).toContain("SettingsCardBoundaryCore");
  });
});

/* Every card the QC-200 G4 section protects, in page order — the page
   shell (header/back link) stays OUTSIDE the boundaries. */
const CARDS: Array<[string, string]> = [
  ["connected-accounts", "ConnectedAccounts"],
  /* JOIN2 (payfix billing-cancel): the Settings → Billing card joined the
     page after G4 was built — isolated like every other card. */
  ["billing", "BillingSettings"],
  ["social-proof", "SocialProofSettings"],
  ["passkeys", "PasskeyManager"],
  ["retention-prefs", "RetentionPrefsSettings"],
  ["sounds", "SoundPrefsSettings"],
  /* JOIN2 (Join #1 rem-month-wrapped + rem-currency-display): two more
     cards that joined the page after G4 — isolated too. */
  ["month-wrapped", "MonthWrappedSettings"],
  ["currency-display", "CurrencyDisplaySettings"],
  /* JOIN2 (orphan-wave viral-spike kit): its Settings card joined —
     isolated like every other card. */
  ["viral-spike", "ViralSpikeSettings"],
  ["feedback-prompts", "FeedbackPromptSettings"],
  /* JOIN2 (orphan-wave group-digest): the digest card joined the page —
     isolated like every other card. */
  ["group-digest", "GroupDigestSettings"],
  ["content-warnings", "ContentWarningSettings"],
  ["discord-webhook", "DiscordWebhookSettings"],
  ["developer-api", "DeveloperApiSettings"],
  ["team-seats", "TeamSeats"],
  ["theme-packs", "ThemePacksDesk"],
  ["cursor", "CursorCard"],
  ["legacy", "LegacySettings"],
  ["legacy-contact", "LegacyContactSettings"],
  ["permanence", "PermanenceSettings"],
  ["catalog-export", "CatalogExportPanel"],
  ["mod-console", "ModConsolePanel"],
  ["danger-zone", "DangerZone"],
];

describe("settings.tsx — every card is isolated (source pins)", () => {
  it("wraps each of the 23 cards in its own boundary", () => {
    for (const [slug, component] of CARDS) {
      const pattern = new RegExp(
        `<SettingsCardBoundary name="${slug}">\\s*<${component}[ />]`,
      );
      expect(settingsSource, `${component} (${slug})`).toMatch(pattern);
    }
    const wraps = settingsSource.match(/<SettingsCardBoundary name=/g) ?? [];
    expect(wraps).toHaveLength(CARDS.length);
  });

  it("the page shell renders outside any boundary", () => {
    const headerAt = settingsSource.indexOf('t("settings.title")');
    const firstBoundaryAt = settingsSource.indexOf("<SettingsCardBoundary");
    expect(headerAt).toBeGreaterThan(-1);
    expect(firstBoundaryAt).toBeGreaterThan(headerAt);
  });

  it("imports the boundary from the shared component", () => {
    expect(settingsSource).toContain(
      'import { SettingsCardBoundary } from "@/components/SettingsCardBoundary";',
    );
  });
});
