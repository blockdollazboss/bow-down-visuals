/**
 * shoutouts-sell-desk-components — stack1500 parity wave 4c
 * source-contract pins. The World's shoutout SELL desk must ride
 * the SITE's real sell rails (pages/shoutouts.tsx's Creator
 * Dashboard tab is the reference implementation), never a parallel
 * invention:
 * - the inbox read, the status PATCH, the revenue read and the
 *   upload rail all come from the seam's paths, with auth headers;
 * - the message helper rides useConfirmedApi's confirmedFetch at
 *   the registry-priced endpoint, and a 402 gets its own
 *   out-of-Bucs state;
 * - the decline is a two-tap arm that states the rail's settled
 *   money truth BEFORE the tap (a paid decline refunds in full
 *   and lands "refunded"); the rail itself carries that behavior
 *   (owner ruling, stack1400 #15) — pinned on the route source so
 *   the desk's words can never drift from the rail's behavior;
 * - a failed read is an error state with a retry, never an empty
 *   inbox;
 * - the desk mounts at the Marketplace square for members, beside
 *   the square's other desks.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("../../components/world/native/ShoutoutsSellDesk.tsx");
const stands = read("../../components/world/native/ShopStands.tsx");
const route = read("../../../../api-server/src/routes/generate/shoutouts.ts");

describe("the sell desk rides the site's sell rails", () => {
  it("reads the inbox + revenue and PATCHes status through the seam", () => {
    expect(desk).toContain("shoutoutRequestsPath(statusFilter)");
    expect(desk).toContain("SHOUTOUT_REVENUE_PATH");
    expect(desk).toContain("fetch(shoutoutRequestPath(req.id)");
    expect(desk).toContain('method: "PATCH"');
    expect(desk).toContain("buildShoutoutStatusBody(status, deliveryUrl)");
    expect(desk).toContain("normalizeShoutoutRequests");
    expect(desk).toContain("normalizeShoutoutRevenue");
  });

  it("delivers by upload through the page's clip rail, ref attached on the PATCH", () => {
    /* D-45: the delivery upload rides the shared direct clip door
       (lib/clip-upload), the same door the 2D page uses. */
    expect(desk).toContain("uploadClipDirect(");
    expect(desk).toContain("shoutoutDeliveryFileReady(file.size)");
    expect(desk).toContain("shoutoutUploadRef(upData)");
    expect(desk).toContain('patchRequest(req, "delivered", stored)');
  });

  it("runs the message helper through the confirmed spend at the registry endpoint", () => {
    expect(desk).toContain("confirmedFetch(SHOUTOUT_AI_MESSAGE_PATH");
    expect(desk).toContain("buildShoutoutAiMessageBody");
    expect(desk).toContain("SHOUTOUT_AI_MESSAGE_COST_VB");
    /* A cancelled confirm is a no-op, never an error. */
    expect(desk).toContain("if (!res) return;");
    /* Out of Bucs is its own state, in the rail's words. */
    expect(desk).toContain("res.status === 402");
    expect(desk).toContain("setAiOutOfCredits");
  });
});

describe("the decline tells the money truth before the tap", () => {
  it("arms first, with the consequence computed from the request's paid state", () => {
    expect(desk).toContain('data-testid="world-shoutout-sell-decline-arm"');
    expect(desk).toContain("shoutoutDeclineConsequence(r)");
    expect(desk).toContain("setDeclineArmed(r.id)");
    expect(desk).toContain('t("worldRemainder.shoDeclineRefund"');
    expect(desk).toContain('t("worldRemainder.shoDeclineUnpaid"');
    expect(desk).toContain('t("worldRemainder.shoDeclineFree")');
    expect(desk).toContain('updated?.status === "refunded"');
  });

  it("the rail itself lands a paid decline as a full refund (stack1400 #15)", () => {
    /* The claim UPDATE into the terminal refunded state… */
    expect(route).toContain('set({ status: "refunded", updated_at: new Date() })');
    /* …the refund through the house session-refund rail… */
    expect(route).toContain("refundCheckoutSessionPayment(session)");
    /* …and a failed refund refuses the decline with a plain 502. */
    expect(route).toContain("We couldn't refund the fan's payment, so this request wasn't declined.");
    expect(route).toContain("isPaidShoutoutRequest");
  });
});

describe("honest states + mounting", () => {
  it("a failed read is an error with a retry, never an empty inbox", () => {
    expect(desk).toContain("NativeErrorState");
    expect(desk).toContain("requestsLoadedRef");
    expect(desk).toContain("revenueLoadedRef");
    expect(desk).toContain('t("shoutouts.noRequests")');
  });

  it("guests get the page's sign-in line; the desk mounts at the square for members", () => {
    expect(desk).toContain('data-testid="world-shoutouts-sell-signin"');
    expect(desk).toContain('t("shoutouts.creatorSignInPrompt")');
    expect(stands).toContain('import { ShoutoutsSellDesk } from "./ShoutoutsSellDesk";');
    expect(stands).toContain("{!isGuest && <ShoutoutsSellDesk isLight={isLight} isGuest={isGuest} />}");
  });

  it("reuses the shoutouts catalog's own labels for statuses, stats and verbs", () => {
    for (const key of [
      "shoutouts.incomingRequests",
      "shoutouts.revenueTitle",
      "shoutouts.statRequests",
      "shoutouts.statDelivered",
      "shoutouts.statGross",
      "shoutouts.statYouKeep",
      "shoutouts.acceptButton",
      "shoutouts.startRecordingButton",
      "shoutouts.markDeliveredButton",
      "shoutouts.declineButton",
      "shoutouts.aiPolishButton",
      "shoutouts.viewDeliveredVideo",
    ]) {
      expect(desk).toContain(`t("${key}")`);
    }
  });
});
