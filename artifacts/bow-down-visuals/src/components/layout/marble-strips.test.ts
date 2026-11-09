/**
 * Marble Splash — shell accent pins (owner ruling, Nov 8, 2026;
 * Gate-1 preview approved Nov 9, 2026).
 *
 * The design is ADDITIVE ONLY: a slim marble strip across the very
 * top of the app shell with a 1px gold hairline directly under it,
 * and a matching slim strip at the foot of the shell. Existing pages
 * and compositions do not change — the homepage hero least of all.
 * Calm stones only (black marble in dark, golden cream marble in
 * light, swapped with the theme), no marble walls or grounds, no
 * per-card frames.
 *
 * The same ruling carries the ground correction: the dark theme's
 * ground was a warm brown (36 24% 5%) the owner killed — it is now
 * TRUE NEUTRAL BLACK (achromatic). The light theme's warm ivory
 * ground (#FAF7F0) must NOT move; the owner explicitly reversed an
 * overreach that touched it, so its join15 values are pinned here.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

const css = readFileSync(new URL("../../index.css", import.meta.url), "utf8");
const app = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
const entryServer = readFileSync(
  new URL("../../entry-server.tsx", import.meta.url),
  "utf8",
);
const strips = readFileSync(
  new URL("./marble-strips.tsx", import.meta.url),
  "utf8",
);

/** Slice one top-level CSS block: from its selector line to the first
 * closing brace at column 0. */
function cssBlock(selector: string): string {
  const start = css.indexOf(selector);
  expect(start, `selector ${selector} exists`).toBeGreaterThanOrEqual(0);
  const end = css.indexOf("\n}\n", start);
  expect(end, `block ${selector} closes`).toBeGreaterThan(start);
  return css.slice(start, end);
}

describe("marble strips — the components", () => {
  it("renders a top strip and a foot strip with the themed classes", () => {
    expect(strips).toContain("export function MarbleTopStrip()");
    expect(strips).toContain("export function MarbleFootStrip()");
    expect(strips).toContain('className="marble-strip marble-strip-top"');
    expect(strips).toContain('className="marble-strip marble-strip-foot"');
    expect(strips).toContain('data-testid="marble-strip-top"');
    expect(strips).toContain('data-testid="marble-strip-foot"');
  });

  it("the strips are decorative only (aria-hidden, no copy, no links)", () => {
    expect(strips).toContain('aria-hidden="true"');
    expect(strips).not.toContain("<Link");
    expect(strips).not.toContain("<a ");
    expect(strips).not.toContain("<button");
  });
});

describe("marble strips — mounted in the shell", () => {
  it("AppShell imports and renders both strips", () => {
    expect(app).toContain(
      'import { MarbleTopStrip, MarbleFootStrip } from "@/components/layout/marble-strips";',
    );
    expect(app).toContain("<MarbleTopStrip />");
    expect(app).toContain("<MarbleFootStrip />");
  });

  it("the top strip renders AFTER the shell-less overlay early return", () => {
    const overlayReturn = app.indexOf('location.startsWith("/overlay/")');
    const stripMount = app.indexOf("<MarbleTopStrip />");
    expect(overlayReturn).toBeGreaterThanOrEqual(0);
    expect(stripMount).toBeGreaterThan(overlayReturn);
  });

  it("the foot strip closes the shell right after SiteFooter, under the same hideFooter gate", () => {
    const gate = app.indexOf("{!hideFooter && (");
    const footer = app.indexOf("<SiteFooter />");
    const footStrip = app.indexOf("<MarbleFootStrip />");
    expect(gate).toBeGreaterThanOrEqual(0);
    expect(footer).toBeGreaterThan(gate);
    expect(footStrip).toBeGreaterThan(footer);
  });

  it("the prerender shell mirrors the same frame", () => {
    expect(entryServer).toContain("<MarbleTopStrip />");
    expect(entryServer).toContain("<MarbleFootStrip />");
    expect(entryServer.indexOf("<MarbleTopStrip />")).toBeLessThan(
      entryServer.indexOf("<Page />"),
    );
    expect(entryServer.indexOf("<MarbleFootStrip />")).toBeGreaterThan(
      entryServer.indexOf("<SiteFooter />"),
    );
  });
});

describe("marble strips — the stone rules in index.css", () => {
  it("the strip is slim (30px) and carries its stone as a cover image", () => {
    const base = cssBlock(".marble-strip {");
    expect(base).toContain("height: 30px;");
    expect(base).toContain("background-size: cover;");
  });

  it("dark theme wears the black marble on both strips", () => {
    expect(cssBlock(".marble-strip-top {")).toContain(
      'background-image: url("/world/textures/marble-black.jpg");',
    );
    expect(cssBlock(".marble-strip-foot {")).toContain(
      'background-image: url("/world/textures/marble-black.jpg");',
    );
  });

  it("light theme swaps BOTH strips to the cream marble", () => {
    expect(cssBlock(".light .marble-strip-top {")).toContain(
      'background-image: url("/world/textures/marble-cream.jpg");',
    );
    expect(cssBlock(".light .marble-strip-foot {")).toContain(
      'background-image: url("/world/textures/marble-cream.jpg");',
    );
  });

  it("the gold hairline sits directly under the top strip — and nowhere else", () => {
    expect(cssBlock(".marble-strip-top {")).toContain(
      "border-bottom: 1px solid hsl(var(--primary));",
    );
    expect(cssBlock(".marble-strip-foot {")).not.toContain("border");
    expect(cssBlock(".marble-strip {")).not.toContain("border");
  });

  it("the stone assets are the repo's own public textures", () => {
    expect(css).toContain("/world/textures/marble-black.jpg");
    expect(css).toContain("/world/textures/marble-cream.jpg");
    expect(css).not.toContain("marble-black-goldvein");
    expect(css).not.toContain("marble-cream-goldvein");
  });
});

describe("ground correction — dark neutral black, light untouched", () => {
  it("the dark --background token is achromatic neutral black", () => {
    const dark = cssBlock(":root, .dark {");
    const match = dark.match(/--background:\s*(\d+)\s+(\d+)%\s+(\d+)%/);
    expect(match, "dark --background token parses").not.toBeNull();
    // 0% saturation is the achromatic law (R=G=B in rgb terms); the
    // hue slot is inert at 0% and the depth stays at join15's 5%.
    expect(match![2]).toBe("0");
    expect(match![3]).toBe("5");
    expect(dark).toContain("--background: 0 0% 5%;");
    expect(dark).not.toContain("--background: 36 24% 5%");
  });

  it("the page backdrop (html, body) carries the same neutral ground", () => {
    expect(css).toContain("background-color: hsl(0 0% 5%);");
    expect(css).not.toContain("background-color: hsl(36 24% 5%);");
  });

  it("the light ground is EXACTLY its join15 self — token and ivory", () => {
    const light = cssBlock(".light {");
    expect(light).toContain("--background: 40 33% 97%;");
    // The palace backdrop the light theme actually paints on body.
    expect(css).toContain(".light body,");
    expect(css).toContain("background-color: #FAF7F0;");
  });
});
