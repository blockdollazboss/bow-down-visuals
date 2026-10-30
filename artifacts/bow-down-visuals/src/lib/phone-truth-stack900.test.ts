/**
 * Stack900 K2 — phone-truth pins (360–390px, both themes).
 *
 * The defect families, each render- or class-proven at 375px on the
 * preview rig (37 anonymous pages × dark/light + a 360px subset):
 *
 *  1. Form modals whose panel had NO max-height and NO overflow — on a
 *     short phone the panel outgrows the viewport and the primary
 *     action (Publish / Request) has no scroll path (the pack-checkout
 *     class). SpotlightModal was measured live at 375×667: panel 760px
 *     tall in a 667px viewport, top at y=-46, close button off-screen.
 *     Panels now cap at 90vh and scroll internally — the house pattern
 *     DailyBonusModal / GenerateArtistImageModal already used.
 *
 *  2. Tap targets under the site's own 40px floor on main flows.
 *     The homepage ShareRow buttons are classed h-11 w-11 but flex
 *     shrink rendered them 33px wide (visible ellipses); shrink-0
 *     holds the size (the identical QRLogin button already carries it).
 *     Three lone text actions — the Spotlight badge's open button
 *     (20px, the door to a $1,000 purchase, on 29 pages), the Charts
 *     Radio error Retry (20px, the only recovery action), and the
 *     homepage tool cards' "Open this tool" link (20px, each card's
 *     only door) — get 44px hit areas via py-3 -my-3, which grows the
 *     hit box while the flow contribution is unchanged.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const facebookModal = read("../components/FacebookPostModal.tsx");
const instagramModal = read("../components/InstagramPostModal.tsx");
const spotlightModal = read("../components/SpotlightModal.tsx");
const spotlightPromo = read("../components/SpotlightPromo.tsx");
const chartsRadio = read("../components/discovery/ChartsRadio.tsx");
const home = read("../pages/home.tsx");

describe("phone-truth: tall form modals scroll on short phones (K2)", () => {
  it.each([
    ["FacebookPostModal", facebookModal],
    ["InstagramPostModal", instagramModal],
    ["SpotlightModal", spotlightModal],
  ])("%s panel caps at 90vh with internal scroll", (_name, src) => {
    expect(src).toContain("max-h-[90vh] overflow-y-auto");
  });
});

describe("phone-truth: tap targets hold their size (K2)", () => {
  it("homepage ShareRow buttons cannot flex-shrink below 44px", () => {
    expect(home).toContain("flex h-11 w-11 shrink-0 items-center justify-center rounded-full");
  });

  it("Spotlight badge open button carries a 44px hit area", () => {
    expect(spotlightPromo).toContain("gap-2 py-3 -my-3 text-sm font-medium");
  });

  it("Charts Radio retry carries a 44px hit area", () => {
    expect(chartsRadio).toContain("gap-1 py-3 -my-3 font-bold");
  });

  it("homepage tool-card action carries a 44px hit area", () => {
    expect(home).toContain("mt-6 flex items-center gap-2 py-3 -my-3 text-sm font-semibold");
  });
});
