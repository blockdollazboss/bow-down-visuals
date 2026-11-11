/**
 * LiveShopPanel (the viewer-side Live Shopping panel docked on
 * /live/:id) — honest states, pinned in source (the FE suite runs in
 * node, no DOM; the derivations themselves are unit-tested in
 * lib/live-shop-viewer.test.ts).
 *
 * The four states the brief demands, and where they live:
 * - LOADING / ERROR are their own cards — a failed shop read is an
 *   error with a retry, never dressed up as "no shop here"; only a
 *   server-confirmed absence (shop: null) renders nothing.
 * - ENDED: the ended copy renders and the buy control's default
 *   branch is `return null` — no Buy exists in the ended or manage
 *   modes, structurally.
 * - MANAGE (the seller): a manage link to the seller page, no buy.
 * - SIGN-IN: the buy moment is a sign-in link back to THIS stream.
 * Money: the buy rides the existing checkout rail with the selling
 * session's id, embedded first; the outcome is spoken only by
 * verify (pending key + focus re-check), never assumed.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const panel = read("./LiveShopPanel.tsx");
const seam = read("../../lib/live-shop-viewer.ts");
const watch = read("../../pages/live-watch.tsx");

describe("loading and error are their own truths", () => {
  it("loading has its own card and copy", () => {
    expect(panel).toContain('data-testid="live-shop-loading"');
    expect(panel).toContain("Loading this stream's shop…");
  });

  it("a failed read is an error card with a retry — never a silent empty", () => {
    expect(panel).toContain('data-testid="live-shop-error"');
    expect(panel).toContain("Couldn't load this stream's shop.");
    expect(panel).toContain("setRetryNonce((n) => n + 1)");
  });

  it("only a server-confirmed absence renders nothing", () => {
    expect(panel).toContain("if (!shop) return null;");
    expect(panel).toContain("if (!shop.pinnedProduct && shop.products.length === 0) return null;");
  });
});

describe("the mode decides the controls — ended and manage have NO buy path", () => {
  it("the panel derives its mode from the seam's one derivation", () => {
    expect(panel).toContain("liveShopPanelMode(shop, { broadcastLive, signedIn: !!user })");
    expect(seam).toContain('if (shop.viewerIsSeller) return "manage";');
    expect(seam).toContain('if (!opts.broadcastLive || shop.session.status !== "live") return "ended";');
  });

  it("the buy control exists only in the buy and signin branches", () => {
    expect(panel).toContain('if (mode === "buy")');
    expect(panel).toContain('if (mode === "signin")');
    /* the default branch of buyControl — ended and manage fall here */
    expect(panel).toContain("    return null;\n  };");
    expect(panel).toContain('data-testid="live-shop-buy"');
    expect(panel).toContain('data-testid="live-shop-signin"');
  });

  it("the ended state shows the plain ended copy and dims the items", () => {
    expect(panel).toContain('data-testid="live-shop-ended-copy"');
    expect(panel).toContain("LIVE_SHOP_ENDED_COPY");
    expect(seam).toContain("This stream has ended — shopping is closed.");
    expect(panel).toContain('mode === "ended" ? "opacity-60" : ""');
  });

  it("the seller gets the manage view and the hand-off to the seller page", () => {
    expect(panel).toContain('data-testid="live-shop-manage-copy"');
    expect(panel).toContain('data-testid="live-shop-manage-link"');
    expect(panel).toContain('href="/live-shopping"');
  });

  it("the sign-in door returns to THIS stream", () => {
    expect(panel).toContain("loginPathWithNext(`/live/${streamId}`)");
  });
});

describe("buying rides the existing rail — and only verify speaks the outcome", () => {
  it("checkout posts the product + the selling session id, embedded first", () => {
    expect(panel).toContain("LIVE_SHOP_CHECKOUT_PATH");
    expect(panel).toContain("product_id: product.id");
    expect(panel).toContain("stream_id: shop.session.id");
    expect(panel).toContain('uiMode: hasStripePublishableKey() ? "embedded" : undefined');
  });

  it("the embedded form mounts in place; the hosted page opens in a new tab only", () => {
    expect(panel).toContain('data-testid="live-shop-embedded-checkout"');
    expect(panel).toContain("<EmbeddedSessionCheckout clientSecret={buySecret} />");
    expect(panel).toContain('window.open(outcome.url, "_blank", "noopener,noreferrer")');
  });

  it("the session id is kept under the shared pending key and verified on focus", () => {
    expect(panel).toContain("localStorage.setItem(liveShopPendingKey(), outcome.sessionId)");
    expect(panel).toContain("localStorage.getItem(liveShopPendingKey())");
    expect(panel).toContain('window.addEventListener("focus", onFocus)');
    expect(panel).toContain("LIVE_SHOP_VERIFY_PATH");
  });

  it("the Q150 refund outcome is surfaced by the seam, word for word", () => {
    expect(seam).toContain("your payment has been refunded in full.");
    expect(seam).toContain('d["code"] === "STREAM_NOT_LIVE"');
    expect(panel).toContain("liveShopVerifyOutcome(res.ok, res.status, data)");
    expect(panel).toContain("liveShopVerifyIsTerminal(outcome)");
  });
});

describe("docked into the watch experience — not a standalone page", () => {
  it("live-watch mounts the panel in its own boundary with the stream's facts", () => {
    expect(watch).toContain('import LiveShopPanel from "@/components/live/LiveShopPanel";');
    expect(watch).toContain('<SectionBoundary name="live-watch-shop">');
    expect(watch).toContain("<LiveShopPanel streamId={stream.id} broadcastLive={!!isLive} />");
  });

  it("the read is keyed to the broadcast stream and polls while live", () => {
    expect(seam).toContain("`/api/live-streams/${encodeURIComponent(streamId)}/shop`");
    expect(panel).toContain("LIVE_STREAM_SHOP_PATH(streamId)");
    expect(panel).toContain("}, 15_000);");
  });
});
