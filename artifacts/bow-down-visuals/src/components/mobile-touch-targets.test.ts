/**
 * mobile-touch-targets.test.ts — Stack-27 lane F1 (S27-01…S27-12):
 * mobile & a11y touch-target restorations.
 *
 * The A6 audit proved a family of sub-40px / unreachable targets.
 * These pins keep each restoration from silently regressing:
 *  - S27-01 the AI Guide's auto-hidden peek is a real ≥40px button on
 *    coarse pointers (fine pointers keep the 6px hover peek);
 *  - S27-10 the Shorts play/pause tap surface is a real <button>;
 *  - the remaining items are pinned by source, the pattern
 *    enter-world-button.test.ts established for component contracts
 *    (vitest runs in node with jsx:preserve, so components are pinned
 *    by source and pure contract modules are imported directly).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ENTER_WORLD_CLASSNAME } from "@/lib/world-entry";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const guideSource = read("./BowDownAIGuide.tsx");
const spotlightSource = read("./SpotlightPromo.tsx");
const sidebarSource = read("./ui/sidebar.tsx");
const footerSource = read("./layout/footer.tsx");
const appSidebarSource = read("./layout/app-sidebar.tsx");
const languageSource = read("./LanguageSwitcher.tsx");
const shortsSource = read("../pages/shorts.tsx");
const homeSource = read("../pages/home.tsx");
const loginSource = read("../pages/login.tsx");
const signupSource = read("../pages/signup.tsx");
const featuresSource = read("../pages/features.tsx");
const chartsSource = read("../pages/discovery/charts.tsx");

describe("S27-01 — BowDownAIGuide touch tab", () => {
  it("keeps a ≥40px peek for coarse pointers", () => {
    const m = guideSource.match(/TOUCH_PEEK_PX\s*=\s*(\d+)/);
    expect(m, "TOUCH_PEEK_PX constant").not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(40);
    expect(guideSource).toContain("guidePeekPx(coarsePointer)");
    expect(guideSource).toContain('window.matchMedia("(pointer: coarse)")');
  });

  it("renders the hidden state's peek as a real button on touch", () => {
    expect(guideSource).toContain('data-testid="guide-touch-tab"');
    expect(guideSource).toContain('aria-label="Show Bow Down Playlist"');
    expect(guideSource).toContain("isHidden && coarsePointer");
    /* The slide transform must leave the wide peek visible, not 6px. */
    expect(guideSource).toContain("slideXform(currentSnap, peekPx)");
  });

  it("keeps the fine-pointer peek at 6px (desktop hover unchanged)", () => {
    expect(guideSource).toContain("const PEEK_PX   = 6;");
    expect(guideSource).toContain("onMouseEnter={onMouseEnter}");
  });
});

describe("S27-02 — Guide minimize hit area", () => {
  it("extends the 24px chip to a 40px hit area without resizing it", () => {
    expect(guideSource).toContain('aria-label="Minimize playlist"');
    expect(guideSource).toContain("h-6 w-6");
    expect(guideSource).toContain("after:-inset-2");
  });
});

describe("S27-03 — mega-footer rows", () => {
  it("footer section links are 40px rows on mobile only", () => {
    expect(footerSource).toContain("min-h-[40px] py-2 md:min-h-0 md:py-0");
    expect(footerSource).toContain("gap-1 md:gap-2.5");
  });
});

describe("S27-04/05 — auth forms", () => {
  it("login inputs and submit are h-11 and stack full-width on mobile", () => {
    expect(loginSource).toContain('data-testid="btn-login" type="submit" className="h-11 w-full sm:w-auto');
    expect(loginSource).toContain("h-11 w-full sm:w-32 md:w-40");
    expect(loginSource).toContain("h-11 w-full sm:w-56");
  });

  it("login recovery row links carry a py-2 hit area", () => {
    expect(loginSource).toContain("hover:underline font-medium py-2 -my-1");
    expect(loginSource).toContain("inline-flex items-center py-2 -my-1");
  });

  it("signup inputs and submit are h-11 and stack full-width on mobile", () => {
    expect(signupSource).toContain('data-testid="btn-signup" type="submit" className="h-11 w-full sm:w-auto');
    expect(signupSource).toContain("h-11 w-full sm:w-28 md:w-36");
  });
});

describe("S27-06 — Spotlight dismiss", () => {
  it("is a sibling button, not a span nested inside the badge button", () => {
    expect(spotlightSource).toContain('data-testid="spotlight-dismiss"');
    expect(spotlightSource).toContain("h-10 w-10");
    expect(spotlightSource).not.toContain('role="button"');
    /* Badge action intact: the modal still opens from the badge. */
    expect(spotlightSource).toContain("onClick={() => setOpen(true)}");
    expect(spotlightSource).toContain('aria-label="Advertise on this screen"');
  });
});

describe("S27-07 — Charts pills/tabs", () => {
  it("pills and tabs carry min-h-[40px]", () => {
    const count = chartsSource.split("min-h-[40px]").length - 1;
    expect(count).toBeGreaterThanOrEqual(5);
  });
});

describe("S27-08 — share buttons, language switcher, World door", () => {
  it("home share buttons are h-11 w-11", () => {
    expect(homeSource).toContain("flex h-11 w-11 items-center justify-center rounded-full");
  });

  it("language switcher trigger has a ≥40px hit area", () => {
    expect(languageSource).toContain("min-h-[40px]");
    expect(languageSource).toContain("min-w-[40px]");
  });

  it("Enter the World link is py-3, not py-2", () => {
    expect(ENTER_WORLD_CLASSNAME).toContain("py-3");
    expect(ENTER_WORLD_CLASSNAME).not.toContain("py-2");
  });
});

describe("S27-09 — sidebar mobile rows", () => {
  it("menu buttons gain min-h-[40px] only in the mobile context", () => {
    expect(sidebarSource).toContain('isMobile && "min-h-[40px]"');
  });
});

describe("S27-10 — Shorts play/pause surface", () => {
  it("is a real <button>, not a div onClick", () => {
    expect(shortsSource).toContain('data-testid="shorts-play-toggle"');
    expect(shortsSource).not.toContain('<div className="absolute inset-0" onClick={handleTap}>');
    const idx = shortsSource.indexOf('data-testid="shorts-play-toggle"');
    const buttonOpen = shortsSource.lastIndexOf("<button", idx);
    expect(buttonOpen).toBeGreaterThan(-1);
    /* The labelled button wraps the video and keeps the tap handler. */
    const slice = shortsSource.slice(buttonOpen, idx + 200);
    expect(slice).toContain("onClick={handleTap}");
    expect(shortsSource).toContain('aria-label={playing ? "Pause" : "Play"}');
  });
});

describe("S27-11 — aria-labels for placeholder-only inputs", () => {
  it("home waitlist email is labelled (reusing auth.email)", () => {
    expect(homeSource).toContain('aria-label={t("auth.email")}');
  });

  it("features search is labelled with its placeholder string", () => {
    expect(featuresSource).toContain('aria-label={t("features.search_features_try_thumbnail_vo")}');
  });

  it("sidebar search is labelled", () => {
    expect(appSidebarSource).toContain('aria-label="Search pages"');
  });

  it("shorts comment box is labelled in both auth states", () => {
    expect(shortsSource).toContain('aria-label={isAuthed ? "Add a comment" : "Sign in to join the conversation"}');
  });
});

describe("S27-12 — signup terms checkbox hit area", () => {
  it("the 16px checkbox sits in a 40px padded wrapper; links gain py", () => {
    expect(signupSource).toContain("p-3 -m-3");
    expect(signupSource).toContain('href="/terms" className="text-[#c9a84c] hover:underline font-medium inline-flex items-center py-2 -my-2"');
    expect(signupSource).toContain('href="/privacy" className="text-[#c9a84c] hover:underline font-medium inline-flex items-center py-2 -my-2"');
    /* The shared checkbox component itself is not resized. */
    const checkboxSource = read("./ui/checkbox.tsx");
    expect(checkboxSource).toContain("h-4 w-4");
  });
});
