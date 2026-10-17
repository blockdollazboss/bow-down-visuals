/**
 * The standing switch (owner addendum, Oct 17 14:29 EDT): a
 * permanent "Switch to the website" control in the /world chrome —
 * the plain EXIT to the 2D website — distinct from the per-panel
 * transfer footer ("Open on the website ↗"), which is a new-tab
 * PEEK at a station's exact page. Pinned here:
 * - the exact label and the site-root destination (contract);
 * - the control itself (SwitchToWebsite.tsx): bound to that
 *   contract, carrying the chrome testid, and with NO target
 *   attribute — a same-tab exit navigation, never a new-tab deep
 *   link. (This suite runs in node with jsx:"preserve" and no DOM
 *   renderer — the house pattern is pure seams + source pins, so
 *   the component's contract is pinned at its source, and the
 *   footer component's source is pinned alongside for contrast.)
 * - it is guest-proof by construction: the component takes only a
 *   theme flag (no auth hook, no state), and pages/world.tsx
 *   mounts it in the header — which renders unconditionally, for
 *   every walker, before any room state exists.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  SWITCH_TO_WEBSITE_LABEL,
  WEBSITE_HOME_PATH,
  TRANSFER_BUTTON_LABEL,
} from "./station-panel";
import { PALACE_STATIONS } from "./stations";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const switchSrc = read("../../components/world/SwitchToWebsite.tsx");
const footerSrc = read("../../components/world/native/TransferFooter.tsx");
const worldSrc = read("../../pages/world.tsx");

describe("the standing switch contract", () => {
  it("the label is exact — and distinct from the footer's", () => {
    expect(SWITCH_TO_WEBSITE_LABEL).toBe("Switch to the website");
    expect(TRANSFER_BUTTON_LABEL).toBe("Open on the website ↗");
    expect(SWITCH_TO_WEBSITE_LABEL).not.toBe(TRANSFER_BUTTON_LABEL);
  });

  it("the destination is the site root — the plain exit, not a station deep link", () => {
    expect(WEBSITE_HOME_PATH).toBe("/");
    for (const s of PALACE_STATIONS) {
      expect(s.websitePath, s.id).not.toBe(WEBSITE_HOME_PATH);
    }
  });
});

describe("the SwitchToWebsite control", () => {
  it("renders the exact label, bound to the contract constants", () => {
    expect(switchSrc).toContain("SWITCH_TO_WEBSITE_LABEL");
    expect(switchSrc).toContain("WEBSITE_HOME_PATH");
    expect(switchSrc).toContain('data-testid="world-switch-to-website"');
    // A plain anchor on the root path — the navigation itself.
    expect(switchSrc).toContain("href={WEBSITE_HOME_PATH}");
  });

  it("is an exit navigation, NOT a new-tab link — unlike the footer peek", () => {
    expect(switchSrc).not.toContain("target=");
    expect(switchSrc).not.toContain("_blank");
    // The footer, for contrast: the station's path, a new tab,
    // and the OTHER label. The two doors are not the same.
    expect(footerSrc).toContain('target="_blank"');
    expect(footerSrc).toContain("TRANSFER_BUTTON_LABEL");
    expect(switchSrc).not.toContain("Open on the website");
    expect(footerSrc).not.toContain("Switch to the website");
  });

  it("takes no auth and no state — guests get it by construction", () => {
    expect(switchSrc).not.toContain("useAuth");
    expect(switchSrc).not.toContain("isGuest");
    expect(switchSrc).not.toContain("useState");
    expect(switchSrc).toContain("{ isLight }: { isLight: boolean }");
  });

  it("follows the chrome's theming in both themes", () => {
    expect(switchSrc).toContain("isLight");
    expect(switchSrc).toContain("border-[#7A5A12]/30"); // light chrome control
    expect(switchSrc).toContain("border-white/15"); // dark chrome control
  });
});

describe("the /world chrome", () => {
  it("mounts the switch in the header, unconditionally", () => {
    const headerStart = worldSrc.indexOf("<header");
    const headerEnd = worldSrc.indexOf("</header>");
    const mount = worldSrc.indexOf("<SwitchToWebsite");
    expect(headerStart).toBeGreaterThan(-1);
    expect(mount).toBeGreaterThan(headerStart);
    expect(mount).toBeLessThan(headerEnd);
    expect(worldSrc).toContain("<SwitchToWebsite isLight={isLight} />");
  });
});
