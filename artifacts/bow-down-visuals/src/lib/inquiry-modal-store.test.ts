/**
 * inquiry-modal-store.test.ts — payfix Fix 2 (Pass 8D): the loading-screen
 * Spotlight / Loading Screen Takeover promo card was effectively
 * unclickable — WittyLoader rendered the inquiry modals inside itself
 * and every loader host unmounts the loader the moment loading
 * resolves, so the SPA replaced the screen before a click could land
 * (and a landed click lost its form on unmount).
 *
 * The contract pinned here:
 *  (a) the promo click records the inquiry in a store that lives
 *      OUTSIDE the loader, so the form survives the loader's unmount;
 *  (b) the form is rendered by InquiryModalHost at the App root and
 *      stays until the user closes it (no auto-dismiss);
 *  (c) the CTA routes to the EXISTING inquiry forms/endpoints —
 *      Spotlight $1,000/7d -> /api/spotlight/inquire,
 *      Loading Screen Takeover $2,500/7d -> /api/loading-screen/inquire
 *      (both land in spotlight_inquiries; the forms are not rebuilt);
 *  (d) the loader's own UX is intact (poster-first video, barcode
 *      progress + onComplete still drive dismissal).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  closeInquiry,
  getInquiry,
  openInquiry,
  subscribeInquiry,
} from "./inquiry-modal-store";

const loader = readFileSync(
  new URL("../components/delight/witty-loader.tsx", import.meta.url),
  "utf8",
);
const host = readFileSync(
  new URL("../components/InquiryModalHost.tsx", import.meta.url),
  "utf8",
);
const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const spotlightModal = readFileSync(
  new URL("../components/SpotlightModal.tsx", import.meta.url),
  "utf8",
);
const loadingScreenModal = readFileSync(
  new URL("../components/LoadingScreenModal.tsx", import.meta.url),
  "utf8",
);

describe("inquiry store — survives the loader (unit)", () => {
  it("starts closed; open records the kind; close clears it", () => {
    closeInquiry();
    expect(getInquiry()).toBeNull();
    openInquiry("loading-screen");
    expect(getInquiry()).toBe("loading-screen");
    closeInquiry();
    expect(getInquiry()).toBeNull();
  });

  it("opening the other card switches the form; reopening is a no-op", () => {
    closeInquiry();
    openInquiry("spotlight");
    openInquiry("loading-screen");
    expect(getInquiry()).toBe("loading-screen");
    openInquiry("loading-screen");
    expect(getInquiry()).toBe("loading-screen");
    closeInquiry();
  });

  it("subscribers are notified on open and close only (the host re-renders, the loader need not)", () => {
    closeInquiry();
    let calls = 0;
    const unsub = subscribeInquiry(() => {
      calls += 1;
    });
    openInquiry("spotlight");
    openInquiry("spotlight");
    closeInquiry();
    closeInquiry();
    expect(calls).toBe(2);
    unsub();
    openInquiry("spotlight");
    expect(calls).toBe(2);
    closeInquiry();
  });
});

describe("witty-loader CTA — clickable in the rendered loading state", () => {
  it("the promo card is a real button wired to the persistent store", () => {
    expect(loader).toContain('data-testid="witty-promo-inquire"');
    expect(loader).toContain("onClick={() => openInquiry(promo.inquire)}");
    expect(loader).toContain(
      'import { openInquiry } from "@/lib/inquiry-modal-store";',
    );
  });

  it("both takeover cards are in the rotation with their ruled prices", () => {
    expect(loader).toContain(
      'title: "Spotlight Takeover — $1,000"',
    );
    expect(loader).toContain(
      'title: "Loading Screen Takeover — $2,500"',
    );
    expect(loader).toContain('inquire: "spotlight" as const');
    expect(loader).toContain('inquire: "loading-screen" as const');
  });

  it("the loader no longer renders the inquiry forms inside itself", () => {
    expect(loader).not.toContain("<SpotlightModal");
    expect(loader).not.toContain("<LoadingScreenModal");
    expect(loader).not.toContain("inquireModal");
  });

  it("loading UX is intact: barcode progress still completes the loader", () => {
    expect(loader).toContain("onComplete?.()");
    expect(loader).toContain("BarcodeStrip");
    expect(loader).toContain('preload="none"');
  });
});

describe("inquiry host — the persistent surface at the App root", () => {
  it("App mounts the host once, outside the routed tree", () => {
    expect(app).toContain(
      'import InquiryModalHost from "@/components/InquiryModalHost";',
    );
    expect(app).toContain("<InquiryModalHost />");
  });

  it("the host renders the EXISTING modals keyed to the store, above the loader", () => {
    expect(host).toContain(
      '<SpotlightModal open={kind === "spotlight"} onClose={closeInquiry} />',
    );
    expect(host).toContain(
      '<LoadingScreenModal open={kind === "loading-screen"} onClose={closeInquiry} />',
    );
    expect(host).toContain("useSyncExternalStore(subscribeInquiry, getInquiry");
    expect(host).toContain("zIndex: 30000");
    expect(host).toContain('pointerEvents: kind ? "auto" : "none"');
  });

  it("the forms still route to the existing inquiry endpoints (not rebuilt)", () => {
    expect(spotlightModal).toContain('fetch("/api/spotlight/inquire"');
    expect(spotlightModal).toContain("priceDollars ?? 1000");
    expect(loadingScreenModal).toContain('fetch("/api/loading-screen/inquire"');
    expect(loadingScreenModal).toContain("priceDollars ?? 2500");
  });
});
