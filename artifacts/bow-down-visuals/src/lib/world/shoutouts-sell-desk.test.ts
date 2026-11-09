import { describe, expect, it } from "vitest";
import { getCreditCost } from "../credit-costs";
import {
  CLIP_UPLOAD_COMPLETE_PATH,
  CLIP_UPLOAD_SESSION_PATH,
} from "../clip-upload";
import {
  SHOUTOUT_AI_MESSAGE_COST_VB,
  SHOUTOUT_AI_MESSAGE_FEATURE,
  SHOUTOUT_AI_MESSAGE_PATH,
  SHOUTOUT_DELIVERY_MAX_BYTES,
  SHOUTOUT_PLATFORM_FEE_PCT,
  SHOUTOUT_REQUESTS_PATH,
  SHOUTOUT_REVENUE_PATH,
  buildShoutoutAiMessageBody,
  buildShoutoutStatusBody,
  canShoutoutTransition,
  isPaidShoutout,
  isShoutoutTerminal,
  normalizeShoutoutAiDraft,
  normalizeShoutoutRequest,
  normalizeShoutoutRequests,
  normalizeShoutoutRevenue,
  shoutoutActionsFor,
  shoutoutAiMessageReady,
  shoutoutDeclineConsequence,
  shoutoutDeliveryFileReady,
  shoutoutRequestPath,
  shoutoutRequestsPath,
  shoutoutUploadRef,
  type ShoutoutSellRequest,
} from "./shoutouts-sell-desk";

function req(over: Partial<ShoutoutSellRequest> = {}): ShoutoutSellRequest {
  return {
    id: "req-1",
    fanName: "Marcus",
    fanEmail: "marcus@example.com",
    occasion: "Birthday",
    message: "Tell my brother happy 21st",
    status: "accepted",
    priceCents: 2500,
    priceDollars: 25,
    deliveryUrl: "",
    paidAt: null,
    createdAt: "2026-11-01T00:00:00.000Z",
    deliveredAt: null,
    ...over,
  };
}

describe("rails + prices", () => {
  it("points at the shoutouts router's own sell rails", () => {
    expect(SHOUTOUT_REQUESTS_PATH).toBe("/api/shoutouts/requests");
    expect(SHOUTOUT_REVENUE_PATH).toBe("/api/shoutouts/revenue");
    expect(SHOUTOUT_AI_MESSAGE_PATH).toBe("/api/shoutouts/ai-message");
    /* The delivery upload rides the shared direct clip door (D-45). */
    expect(CLIP_UPLOAD_SESSION_PATH).toBe("/api/upload-clip/session");
    expect(CLIP_UPLOAD_COMPLETE_PATH).toBe("/api/upload-clip/complete");
    expect(shoutoutRequestPath("a b/c")).toBe("/api/shoutouts/requests/a%20b%2Fc");
    expect(shoutoutRequestsPath("")).toBe("/api/shoutouts/requests");
    expect(shoutoutRequestsPath("accepted")).toBe("/api/shoutouts/requests?status=accepted");
  });

  it("pins the AI message price to the registry row — 100 Bucs, never invented", () => {
    expect(getCreditCost("/api/shoutouts/ai-message")).toEqual({
      cost: 100,
      feature: "Shoutout Message",
    });
    expect(SHOUTOUT_AI_MESSAGE_COST_VB).toBe(100);
    expect(SHOUTOUT_AI_MESSAGE_FEATURE).toBe("Shoutout Message");
  });

  it("pins the platform fee to the ratified flat 5%", () => {
    expect(SHOUTOUT_PLATFORM_FEE_PCT).toBe(5);
  });
});

describe("the rail's transition map, mirrored", () => {
  it("allows exactly the route's transitions", () => {
    expect(canShoutoutTransition("pending_payment", "accepted")).toBe(true);
    expect(canShoutoutTransition("pending_payment", "declined")).toBe(true);
    expect(canShoutoutTransition("pending_payment", "in_progress")).toBe(false);
    expect(canShoutoutTransition("pending_payment", "delivered")).toBe(false);
    expect(canShoutoutTransition("accepted", "in_progress")).toBe(true);
    expect(canShoutoutTransition("accepted", "declined")).toBe(true);
    expect(canShoutoutTransition("accepted", "delivered")).toBe(false);
    expect(canShoutoutTransition("in_progress", "delivered")).toBe(true);
    expect(canShoutoutTransition("in_progress", "declined")).toBe(true);
    expect(canShoutoutTransition("in_progress", "accepted")).toBe(false);
  });

  it("treats delivered / declined / refunded (and anything unknown) as terminal", () => {
    for (const s of ["delivered", "declined", "refunded"]) {
      expect(isShoutoutTerminal(s)).toBe(true);
      expect(shoutoutActionsFor(s)).toEqual([]);
    }
    expect(canShoutoutTransition("delivered", "declined")).toBe(false);
    expect(canShoutoutTransition("refunded", "accepted")).toBe(false);
    expect(canShoutoutTransition("nonsense", "accepted")).toBe(false);
  });

  it("offers only the verbs the map allows from each status", () => {
    expect(shoutoutActionsFor("pending_payment")).toEqual(["accept", "decline"]);
    expect(shoutoutActionsFor("accepted")).toEqual(["start", "decline"]);
    expect(shoutoutActionsFor("in_progress")).toEqual(["deliver", "decline"]);
  });
});

describe("paid truth + the decline consequence", () => {
  it("a request is paid only when the settle flip recorded it on a priced request", () => {
    expect(isPaidShoutout(req({ paidAt: "2026-11-01T01:00:00.000Z" }))).toBe(true);
    expect(isPaidShoutout(req({ paidAt: null }))).toBe(false);
    /* A positive price alone is NOT paid — an unpaid priced request
       sits in pending_payment with paid_at null. */
    expect(isPaidShoutout(req({ status: "pending_payment", paidAt: null }))).toBe(false);
    expect(isPaidShoutout(req({ priceCents: 0, priceDollars: 0, paidAt: "2026-11-01T01:00:00.000Z" }))).toBe(false);
  });

  it("declining a paid request refunds the fan the full price", () => {
    expect(shoutoutDeclineConsequence(req({ paidAt: "2026-11-01T01:00:00.000Z" }))).toEqual({
      kind: "refund",
      amountCents: 2500,
    });
  });

  it("declining an unpaid or free request moves no money", () => {
    expect(shoutoutDeclineConsequence(req({ paidAt: null }))).toEqual({ kind: "no-payment" });
    expect(
      shoutoutDeclineConsequence(req({ priceCents: 0, priceDollars: 0, paidAt: "2026-11-01T01:00:00.000Z" })),
    ).toEqual({ kind: "no-payment" });
  });
});

describe("normalizers — strict, broken answers read as failed", () => {
  const row = {
    id: "r1",
    fanName: "Marcus",
    fanEmail: "m@example.com",
    occasion: "Birthday",
    message: "Hi",
    status: "in_progress",
    priceCents: 2500,
    priceDollars: 25,
    deliveryUrl: "",
    paidAt: "2026-11-01T01:00:00.000Z",
    createdAt: "2026-11-01T00:00:00.000Z",
    deliveredAt: null,
  };

  it("reads a well-formed inbox", () => {
    const out = normalizeShoutoutRequests({ requests: [row] });
    expect(out).toHaveLength(1);
    expect(out![0]).toMatchObject({ id: "r1", status: "in_progress", paidAt: row.paidAt });
    expect(normalizeShoutoutRequests({ requests: [] })).toEqual([]);
  });

  it("refuses broken inbox answers instead of painting them", () => {
    expect(normalizeShoutoutRequests(null)).toBeNull();
    expect(normalizeShoutoutRequests({})).toBeNull();
    expect(normalizeShoutoutRequests({ requests: "nope" })).toBeNull();
    expect(normalizeShoutoutRequests({ requests: [{ fanName: "x" }] })).toBeNull();
    expect(normalizeShoutoutRequests({ requests: [{ id: "r1" }] })).toBeNull();
  });

  it("reads a PATCH answer, including a paid decline's refunded landing", () => {
    expect(normalizeShoutoutRequest({ request: row })?.status).toBe("in_progress");
    expect(normalizeShoutoutRequest({ request: { ...row, status: "refunded" } })?.status).toBe(
      "refunded",
    );
    expect(normalizeShoutoutRequest({})).toBeNull();
    expect(normalizeShoutoutRequest(null)).toBeNull();
  });

  it("reads revenue only with the rail's own money figures present", () => {
    const rev = normalizeShoutoutRevenue({
      total: 4,
      pendingPayment: 1,
      accepted: 1,
      inProgress: 1,
      delivered: 1,
      declined: 0,
      grossCents: 7500,
      grossDollars: 75,
      netCents: 7125,
      netDollars: 71.25,
      platformFeePct: 5,
      paymentsLive: true,
    });
    expect(rev).toMatchObject({ total: 4, grossCents: 7500, netCents: 7125, platformFeePct: 5 });
    expect(normalizeShoutoutRevenue({ total: 4 })).toBeNull();
    expect(normalizeShoutoutRevenue({ total: 4, grossCents: 100 })).toBeNull();
    expect(normalizeShoutoutRevenue(null)).toBeNull();
  });
});

describe("bodies — the rails' own shapes", () => {
  it("builds the page's PATCH body (status + delivery URL field)", () => {
    expect(buildShoutoutStatusBody("accepted")).toEqual({ status: "accepted", deliveryUrl: "" });
    expect(buildShoutoutStatusBody("delivered", "ref-123")).toEqual({
      status: "delivered",
      deliveryUrl: "ref-123",
    });
  });

  it("builds the AI helper body on its schema, creator name only when given", () => {
    expect(buildShoutoutAiMessageBody({ occasion: " Birthday ", notes: " say hi " })).toEqual({
      occasion: "Birthday",
      notes: "say hi",
    });
    expect(
      buildShoutoutAiMessageBody({ occasion: "Birthday", notes: "", creatorName: " King " }),
    ).toEqual({ occasion: "Birthday", notes: "", creatorName: "King" });
  });

  it("gates the helper on the schema bounds (occasion 1–120, notes ≤600)", () => {
    expect(shoutoutAiMessageReady({ occasion: "Birthday", notes: "" })).toBe(true);
    expect(shoutoutAiMessageReady({ occasion: "  ", notes: "" })).toBe(false);
    expect(shoutoutAiMessageReady({ occasion: "x".repeat(121), notes: "" })).toBe(false);
    expect(shoutoutAiMessageReady({ occasion: "Birthday", notes: "x".repeat(601) })).toBe(false);
  });

  it("reads the AI draft answer; an empty draft is a failed read", () => {
    expect(
      normalizeShoutoutAiDraft({ message: "Happy 21st!", creditsUsed: 100, creditsRemaining: 40 }),
    ).toEqual({ message: "Happy 21st!", creditsUsed: 100, creditsRemaining: 40 });
    expect(normalizeShoutoutAiDraft({ message: "" })).toBeNull();
    expect(normalizeShoutoutAiDraft(null)).toBeNull();
  });
});

describe("delivery upload — the page's rail rules", () => {
  it("honors the 80 MB page-side cap", () => {
    expect(SHOUTOUT_DELIVERY_MAX_BYTES).toBe(80 * 1024 * 1024);
    expect(shoutoutDeliveryFileReady(1024)).toBe(true);
    expect(shoutoutDeliveryFileReady(SHOUTOUT_DELIVERY_MAX_BYTES)).toBe(true);
    expect(shoutoutDeliveryFileReady(SHOUTOUT_DELIVERY_MAX_BYTES + 1)).toBe(false);
    expect(shoutoutDeliveryFileReady(0)).toBe(false);
  });

  it("takes the stable ref first, then a URL, else nothing", () => {
    expect(shoutoutUploadRef({ ref: "clips/abc.mp4", url: "https://x/y" })).toBe("clips/abc.mp4");
    expect(shoutoutUploadRef({ url: "https://x/y" })).toBe("https://x/y");
    expect(shoutoutUploadRef({})).toBeNull();
    expect(shoutoutUploadRef(null)).toBeNull();
  });
});
