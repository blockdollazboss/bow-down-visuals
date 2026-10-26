/**
 * Paid Priority DMs (Wave-4 #44) — frontend helper tests.
 * The surface promises under test: gate-off shows NO price and no
 * purchase statement; a live offer always states price + window +
 * auto-refund together; row labels never hide a refund.
 */
import { describe, it, expect } from "vitest";
import {
  canBuyPriority,
  priorityPurchaseStatement,
  priorityRowLabel,
  formatReplyWindow,
  PRIORITY_DM_GATE_OFF_COPY,
  type PriorityStatusResponse,
  type PriorityDmRowDto,
} from "./priority-dms";

const LIVE: PriorityStatusResponse = {
  platform_enabled: true, available: true, price_vb: 500, reply_window_hours: 48,
};
const GATE_OFF: PriorityStatusResponse = { platform_enabled: false, available: false, reason: "gate_off" };

describe("gate-off honesty", () => {
  it("gate off is never buyable and produces no purchase statement", () => {
    expect(canBuyPriority(GATE_OFF)).toBe(false);
    expect(priorityPurchaseStatement(GATE_OFF)).toBeNull();
    expect(PRIORITY_DM_GATE_OFF_COPY).toContain("aren't available yet");
    expect(PRIORITY_DM_GATE_OFF_COPY).not.toMatch(/\d+\s*(VB|Visual Bucs)/);
  });

  it("opted-out / priceless creators are not buyable either", () => {
    expect(canBuyPriority({ platform_enabled: true, available: false, reason: "not_opted_in" })).toBe(false);
    expect(canBuyPriority({ platform_enabled: true, available: true })).toBe(false); // price missing
    expect(canBuyPriority(null)).toBe(false);
  });
});

describe("the pre-purchase statement", () => {
  it("states price, window and the full auto-refund together", () => {
    const s = priorityPurchaseStatement(LIVE);
    expect(s).toContain("500 Visual Bucs");
    expect(s).toContain("2 days");
    expect(s).toContain("come back in full, automatically");
  });

  it("formats windows in plain language", () => {
    expect(formatReplyWindow(12)).toBe("12 hours");
    expect(formatReplyWindow(24)).toBe("24 hours");
    expect(formatReplyWindow(48)).toBe("2 days");
    expect(formatReplyWindow(168)).toBe("7 days");
  });
});

describe("row labels", () => {
  const row = (over: Partial<PriorityDmRowDto>): PriorityDmRowDto => ({
    id: "r1", conversation_id: "c1", message_id: "m1",
    sender_user_id: "fan", creator_user_id: "creator",
    amount_vb: 500, status: "held",
    reply_deadline: "2026-10-28T12:00:00.000Z",
    replied_at: null, settled_at: null, created_at: "2026-10-26T12:00:00.000Z",
    ...over,
  });
  const NOW = new Date("2026-10-26T13:00:00.000Z");

  it("held rows name the refund deadline; expired held rows say the refund is coming", () => {
    expect(priorityRowLabel(row({}), NOW)).toContain("full refund if unanswered");
    expect(priorityRowLabel(row({}), new Date("2026-10-29T00:00:00.000Z"))).toContain("refund on its way");
  });

  it("refunds are labelled as refunds, never softened", () => {
    expect(priorityRowLabel(row({ status: "refunded_expired" }), NOW)).toContain("Refunded in full");
    expect(priorityRowLabel(row({ status: "refunded_blocked" }), NOW)).toContain("Refunded in full");
    expect(priorityRowLabel(row({ status: "replied" }), NOW)).toContain("Replied");
  });
});
