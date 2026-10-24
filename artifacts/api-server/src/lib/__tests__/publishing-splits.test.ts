/**
 * Publishing splits registry (Stack-100 #3 Wave 3, #22) — the pure
 * songwriter-split machine. Pins the brief's test requirements:
 *  - sum validation (creator-entered %, server-side, sum = 100);
 *  - confirm/dispute semantics (a dispute FLAGS, never rewrites);
 *  - the no-collection-claim copy (registry only, partner-gated
 *    collection) — pinned verbatim so no surface can drift into
 *    claiming royalties are collected or paid.
 */
import { describe, expect, it } from "vitest";
import {
  applyWriterAction,
  buildSplitSheet,
  deriveRegistrationState,
  initialWriters,
  isMissingPublishingTable,
  publishingSheetCode,
  reviseWriters,
  validateWriterSplits,
  PublishingSplitError,
  PUBLISHING_COLLECTION_STATUS,
  PUBLISHING_COPY,
  type PublishingRegistration,
  type WriterInput,
} from "../publishing-splits";

const OWNER = "user-owner";
const CO = "user-co";
const T0 = new Date("2026-10-24T00:00:00Z");

function inputs(over: Partial<WriterInput>[] = []): WriterInput[] {
  const base: WriterInput[] = [
    { name: "Owner Writer", userId: OWNER, profileId: "prof-owner", sharePct: 60 },
    { name: "Co Writer", userId: CO, profileId: "prof-co", sharePct: 40 },
  ];
  return base.map((b, i) => ({ ...b, ...(over[i] ?? {}) }));
}

function reg(over: Partial<WriterInput>[] = []): PublishingRegistration {
  return {
    id: "12345678-1234-1234-1234-1234567890ab",
    ownerUserId: OWNER,
    songKind: "release",
    songId: "rel-1",
    songTitle: "Midnight Tide",
    hasDispute: false,
    createdAt: T0,
    updatedAt: T0,
    writers: initialWriters(OWNER, inputs(over), T0),
  };
}

describe("validateWriterSplits — creator-entered percentages, sum must be 100", () => {
  it("accepts an exact 100, a solo songwriter at 100, and 33.33-style splits", () => {
    expect(() => validateWriterSplits(inputs())).not.toThrow();
    expect(() => validateWriterSplits([{ name: "Solo", userId: OWNER, sharePct: 100 }])).not.toThrow();
    expect(() =>
      validateWriterSplits([
        { name: "A", sharePct: 33.33 },
        { name: "B", sharePct: 33.33 },
        { name: "C", sharePct: 33.34 },
      ]),
    ).not.toThrow();
  });
  it("refuses sums that are not 100, naming the real total", () => {
    expect(() => validateWriterSplits(inputs([{ sharePct: 60 }, { sharePct: 30 }]))).toThrowError(/total 90\.00%/);
    expect(() => validateWriterSplits(inputs([{ sharePct: 60 }, { sharePct: 50 }]))).toThrowError(PublishingSplitError);
  });
  it("refuses zero/negative/over-100 shares and >2dp precision", () => {
    expect(() => validateWriterSplits([{ name: "A", sharePct: 0 }, { name: "B", sharePct: 100 }])).toThrowError(/more than 0%/);
    expect(() => validateWriterSplits([{ name: "A", sharePct: -5 }, { name: "B", sharePct: 105 }])).toThrowError(PublishingSplitError);
    expect(() => validateWriterSplits([{ name: "A", sharePct: 33.333 }, { name: "B", sharePct: 66.667 }])).toThrowError(/two decimal places/);
  });
  it("refuses an empty list, a missing name, and the same account twice", () => {
    expect(() => validateWriterSplits([])).toThrowError(/at least one songwriter/);
    expect(() => validateWriterSplits([{ name: "  ", sharePct: 100 }])).toThrowError(/needs a name/);
    expect(() =>
      validateWriterSplits([
        { name: "A", userId: CO, sharePct: 50 },
        { name: "A again", userId: CO, sharePct: 50 },
      ]),
    ).toThrowError(/can't be listed twice/);
  });
});

describe("initialWriters — who starts in which state", () => {
  it("the registrant's own row starts confirmed; other linked writers start pending", () => {
    const r = reg();
    expect(r.writers[0]!.confirmationStatus).toBe("confirmed");
    expect(r.writers[0]!.confirmedAt).toEqual(T0);
    expect(r.writers[1]!.confirmationStatus).toBe("pending");
    expect(deriveRegistrationState(r)).toBe("awaiting_confirmations");
  });
  it("a writer with no account link is 'unlinked' and blocks nothing", () => {
    const r = reg([{}, { userId: null, profileId: null }]);
    expect(r.writers[1]!.confirmationStatus).toBe("unlinked");
    expect(deriveRegistrationState(r)).toBe("registered");
  });
  it("a solo songwriter registration is confirmed on arrival", () => {
    const r: PublishingRegistration = {
      ...reg(),
      writers: initialWriters(OWNER, [{ name: "Solo", userId: OWNER, sharePct: 100 }], T0),
    };
    expect(deriveRegistrationState(r)).toBe("confirmed");
  });
});

describe("confirm / dispute semantics", () => {
  it("a linked writer confirms their own share → registration becomes confirmed", () => {
    const next = applyWriterAction(reg(), CO, "confirm", { now: T0 });
    expect(next.writers[1]!.confirmationStatus).toBe("confirmed");
    expect(deriveRegistrationState(next)).toBe("confirmed");
  });
  it("a stranger cannot confirm or dispute — not_a_writer", () => {
    expect(() => applyWriterAction(reg(), "user-stranger", "confirm")).toThrowError(/Only a songwriter listed/);
    expect(() => applyWriterAction(reg(), "user-stranger", "dispute")).toThrowError(PublishingSplitError);
  });
  it("a dispute FLAGS the record and NEVER rewrites any share", () => {
    const before = reg();
    const sharesBefore = before.writers.map((w) => w.sharePct);
    const next = applyWriterAction(before, CO, "dispute", { note: "I wrote the bridge too.", now: T0 });
    expect(next.writers[1]!.confirmationStatus).toBe("disputed");
    expect(next.writers[1]!.disputeNote).toBe("I wrote the bridge too.");
    expect(next.hasDispute).toBe(true);
    expect(deriveRegistrationState(next)).toBe("disputed");
    expect(next.writers.map((w) => w.sharePct)).toEqual(sharesBefore);
    /* the original record is untouched (pure machine, no mutation) */
    expect(before.writers[1]!.confirmationStatus).toBe("pending");
    expect(before.hasDispute).toBe(false);
  });
  it("confirming a disputed share resolves that writer's dispute", () => {
    const disputed = applyWriterAction(reg(), CO, "dispute", { note: "check the demo", now: T0 });
    const resolved = applyWriterAction(disputed, CO, "confirm", { now: T0 });
    expect(resolved.writers[1]!.confirmationStatus).toBe("confirmed");
    expect(resolved.writers[1]!.disputeNote).toBeNull();
    expect(resolved.hasDispute).toBe(false);
  });
  it("double-confirm and dispute-after-dispute are refused", () => {
    const confirmed = applyWriterAction(reg(), CO, "confirm", { now: T0 });
    expect(() => applyWriterAction(confirmed, CO, "confirm")).toThrowError(/isn't waiting/);
    const disputed = applyWriterAction(reg(), CO, "dispute", { now: T0 });
    expect(() => applyWriterAction(disputed, CO, "dispute")).toThrowError(/can't be disputed/);
  });
  it("an unlinked writer can never act (no account = no row match)", () => {
    const r = reg([{}, { userId: null, profileId: null }]);
    expect(() => applyWriterAction(r, CO, "confirm")).toThrowError(PublishingSplitError);
  });
});

describe("reviseWriters — owner revision resets consent", () => {
  it("re-validates the sum, resets linked writers to pending, clears the dispute", () => {
    const disputed = applyWriterAction(reg(), CO, "dispute", { note: "no", now: T0 });
    const revised = reviseWriters(disputed, OWNER, [
      { name: "Owner Writer", userId: OWNER, profileId: "prof-owner", sharePct: 50 },
      { name: "Co Writer", userId: CO, profileId: "prof-co", sharePct: 50 },
    ], T0);
    expect(revised.hasDispute).toBe(false);
    expect(revised.writers[1]!.confirmationStatus).toBe("pending");
    expect(revised.writers[1]!.sharePct).toBe(50);
    expect(deriveRegistrationState(revised)).toBe("awaiting_confirmations");
  });
  it("a non-owner cannot revise", () => {
    expect(() => reviseWriters(reg(), CO, inputs())).toThrowError(/Only the creator who registered/);
  });
  it("a revision that doesn't sum to 100 is refused", () => {
    expect(() => reviseWriters(reg(), OWNER, inputs([{ sharePct: 10 }, { sharePct: 10 }]))).toThrowError(/total 20\.00%/);
  });
});

describe("no-collection-claim copy pins", () => {
  it("the collection notice is the exact partner-gated label", () => {
    expect(PUBLISHING_COPY.collectionNotice).toBe(
      "Registered — collection activates when publishing administration is connected.",
    );
    expect(PUBLISHING_COLLECTION_STATUS).toBe("not_connected");
  });
  it("the registry-only copy says plainly it does not collect or pay", () => {
    expect(PUBLISHING_COPY.registryOnly).toContain("does not collect or pay royalties");
    expect(PUBLISHING_COPY.registryOnly).toContain("none is connected yet");
  });
  it("no copy claims collection, payment, or a rate/fee/default share", () => {
    const all = Object.values(PUBLISHING_COPY).join(" ");
    expect(all).not.toMatch(/we collect|royalties are paid|you'll be paid|payout/i);
  });
  it("the split sheet carries the notice and never account ids", () => {
    const disputed = applyWriterAction(reg(), CO, "dispute", { note: "bridge is mine", now: T0 });
    const sheet = buildSplitSheet(disputed, T0);
    expect(sheet).toContain("Midnight Tide");
    expect(sheet).toContain("Co Writer — 40.00%");
    expect(sheet).toContain("Dispute note from Co Writer: bridge is mine");
    expect(sheet).toContain(PUBLISHING_COPY.collectionNotice);
    expect(sheet).toContain(PUBLISHING_COPY.registryOnly);
    expect(sheet).not.toContain(CO);
    expect(sheet).not.toContain(OWNER);
    expect(publishingSheetCode(disputed.id, T0)).toMatch(/^BDV-PUBSPLIT-12345678-20261024$/);
  });
});

describe("isMissingPublishingTable", () => {
  it("detects 42P01 through the drizzle cause chain", () => {
    const wrapped = Object.assign(new Error("Failed query"), { cause: { code: "42P01" } });
    expect(isMissingPublishingTable(wrapped)).toBe(true);
    expect(isMissingPublishingTable(new Error("nope"))).toBe(false);
    expect(isMissingPublishingTable({ code: "23505" })).toBe(false);
  });
  it("detects the pg-mem message shape, scoped to the registry tables", () => {
    const memStyle = Object.assign(new Error("Failed query"), {
      cause: new Error('relation "publishing_split_writers" does not exist'),
    });
    expect(isMissingPublishingTable(memStyle)).toBe(true);
    const otherTable = Object.assign(new Error("Failed query"), {
      cause: new Error('relation "some_other_table" does not exist'),
    });
    expect(isMissingPublishingTable(otherTable)).toBe(false);
  });
});
