/**
 * shop-embedded-checkout.test.ts — stack400 lane 2.
 *
 * Oct 28 payments gate, Pass 2: a $5 shop purchase left the site for
 * the Stripe-HOSTED checkout page (owner law 2026-10-26: "we should
 * never have to leave my site") and the buyer found no delivery
 * anywhere — /library had no Purchases surface at all. Source-contract
 * pins for the frontend half of the fix:
 *  - the shop page asks for the embedded presentation (uiMode +
 *    returnPath back to this shop page) whenever the device can mount
 *    it, and mounts EmbeddedSessionCheckout on the clientSecret;
 *  - the hosted redirect remains ONLY as the fallback when no
 *    clientSecret comes back;
 *  - the signed-in buyer's session token rides along so the server
 *    can stamp the order + delivery to their account;
 *  - /library?tab=purchases resolves, the Purchases tab is docked in
 *    the Library, and its panel reads /api/shops/my-purchases.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { libraryTabFromParams } from "../lib/library-tab";

const shopSrc = readFileSync(join(__dirname, "shop.tsx"), "utf8");
const librarySrc = readFileSync(join(__dirname, "library.tsx"), "utf8");
const panelSrc = readFileSync(join(__dirname, "../components/library/PurchasesPanel.tsx"), "utf8");

describe("shop page — embedded-first checkout", () => {
  it("asks for the embedded presentation with a return to this shop page", () => {
    expect(shopSrc).toContain('uiMode: "embedded", returnPath: `/shop/${handle}`');
    expect(shopSrc).toContain("hasStripePublishableKey()");
  });

  it("mounts the embedded checkout in the cart drawer on a clientSecret", () => {
    expect(shopSrc).toContain("<EmbeddedSessionCheckout clientSecret={embeddedSecret} />");
    expect(shopSrc).toContain('data-testid="shop-embedded-checkout"');
  });

  it("keeps the hosted redirect only as the fallback after the embedded branch", () => {
    const embeddedBranch = shopSrc.indexOf("setEmbeddedSecret(data.clientSecret)");
    const hostedBranch = shopSrc.indexOf("window.location.href = url");
    expect(embeddedBranch).toBeGreaterThan(-1);
    expect(hostedBranch).toBeGreaterThan(embeddedBranch);
  });

  it("sends the signed-in buyer's session token with checkout", () => {
    expect(shopSrc).toContain("Authorization: `Bearer ${token}`");
    expect(shopSrc).toContain("headers: await checkoutHeaders()");
  });

  it("the make-an-offer buy follows the same embedded-first discipline", () => {
    const offerFn = shopSrc.slice(shopSrc.indexOf("async function buyWithOffer"));
    expect(offerFn).toContain('uiMode: "embedded"');
    expect(offerFn).toContain("setEmbeddedSecret(data.clientSecret)");
  });
});

describe("cart drawer — checkout reachability (stack600)", () => {
  /* Gate Pass 2 (Oct 28, live on stack500): the embedded Stripe
     form's Pay button rendered BELOW the drawer's visible area —
     the panel cut off around the Cash App Pay row and ordinary
     scrolling never reached Pay (a keyboard Tab-walk + Enter
     eventually submitted). Mechanism: the drawer is an `h-full`
     flex column whose ONLY scroll region wrapped the cart items;
     the totals, the embedded checkout and the done state were
     non-scrollable siblings below it. Their combined height —
     dominated by the Stripe iframe at its full content height —
     exceeds the viewport at short heights, and with no ancestor
     scroll container the overflow simply spills past the bottom
     of the fixed overlay. Owner law (Oct 28): "nothing should be
     difficult" — a Pay button must never sit unreachable.
     Fix contract: ONE scroll region (`flex-1 min-h-0
     overflow-y-auto`) under the pinned header contains the items,
     the totals/place-order block, the embedded checkout AND the
     done state, so the whole payment form scrolls inside the
     drawer at any viewport height. `min-h-0` is load-bearing:
     without it the flex child refuses to shrink below content
     height and the region cannot scroll at all. */

  const asideStart = shopSrc.indexOf("<aside");
  const asideEnd = shopSrc.indexOf("</aside>", asideStart);
  const aside = shopSrc.slice(asideStart, asideEnd);

  const regionOpen = aside.indexOf("overflow-y-auto");
  const regionTagStart = aside.lastIndexOf("<div", regionOpen);

  /** Index of the `</div>` that closes the div opened at `openIdx`,
   *  found by walking div open/close tokens (self-closing divs are
   *  depth-neutral). Returns -1 if unbalanced. */
  function matchingDivClose(src: string, openIdx: number): number {
    const tagRe = /<div\b[^>]*>|<\/div>/g;
    tagRe.lastIndex = openIdx;
    let depth = 0;
    let m: RegExpExecArray | null;
    while ((m = tagRe.exec(src)) !== null) {
      if (m[0] === "</div>") {
        depth -= 1;
        if (depth === 0) return m.index;
      } else if (!m[0].endsWith("/>")) {
        depth += 1;
      }
    }
    return -1;
  }

  it("the drawer is a full-height flex column with exactly one scroll region", () => {
    expect(aside).toContain("h-full w-full max-w-md");
    expect(aside).toContain("flex flex-col");
    expect(aside.split("overflow-y-auto").length - 1).toBe(1);
  });

  it("the scroll region can actually shrink and scroll (flex-1 + min-h-0)", () => {
    const regionTag = aside.slice(regionTagStart, aside.indexOf(">", regionOpen) + 1);
    expect(regionTag).toContain("flex-1");
    expect(regionTag).toContain("min-h-0");
    expect(regionTag).toContain("overflow-y-auto");
  });

  it("items, totals, embedded checkout and the done state all render INSIDE the scroll region", () => {
    const regionClose = matchingDivClose(aside, regionTagStart);
    expect(regionClose).toBeGreaterThan(regionTagStart);
    const anchors: Array<[string, string]> = [
      ["cart items", "cartDetailed.map"],
      ["totals / place-order", "shop.placeOrder"],
      ["embedded checkout", 'data-testid="shop-embedded-checkout"'],
      ["stripe mount", "<EmbeddedSessionCheckout clientSecret={embeddedSecret} />"],
      ["order done state", "shop.orderRecorded"],
    ];
    for (const [label, anchor] of anchors) {
      const idx = aside.indexOf(anchor);
      expect(idx, `${label} anchor present`).toBeGreaterThan(regionTagStart);
      expect(idx, `${label} inside the scroll region`).toBeLessThan(regionClose);
    }
  });

  it("the items keep their space-y-3 card spacing inside the region", () => {
    const regionClose = matchingDivClose(aside, regionTagStart);
    const wrapper = aside.indexOf('<div className="space-y-3">');
    expect(wrapper).toBeGreaterThan(regionTagStart);
    expect(wrapper).toBeLessThan(regionClose);
    expect(aside.indexOf("cartDetailed.map")).toBeGreaterThan(wrapper);
  });
});

describe("library — Purchases tab", () => {
  it("?tab=purchases resolves to the purchases tab", () => {
    expect(libraryTabFromParams(new URLSearchParams("tab=purchases"))).toBe("purchases");
  });

  it("the tab is docked in the Library tab list and renders the panel", () => {
    expect(librarySrc).toContain('key: "purchases"');
    expect(librarySrc).toContain('tab === "purchases"');
    expect(librarySrc).toContain("<PurchasesPanel");
  });

  it("the panel reads the buyer's deliveries endpoint with their session", () => {
    expect(panelSrc).toContain('fetch("/api/shops/my-purchases"');
    expect(panelSrc).toContain("Authorization: `Bearer ${token}`");
    expect(panelSrc).toContain("p.downloadUrl");
  });

  it("the panel keys rows by the saleId the API actually sends (stack500 small-fixes)", () => {
    // GET /api/shops/my-purchases maps each delivery to
    // `saleId: d.sale_event_id` — the name the whole shops module
    // uses. The panel's interface once declared `saleEventId`
    // instead, so `key={p.saleEventId}` was undefined on every row
    // and React fell back to index keys (vault-guards diagnosis §2).
    expect(panelSrc).toContain("saleId: string;");
    expect(panelSrc).toContain("key={p.saleId}");
    expect(panelSrc).not.toContain("saleEventId");
  });
});
