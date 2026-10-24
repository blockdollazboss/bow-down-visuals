import { describe, it, expect } from "vitest";
import {
  PUBLISHING_COPY,
  publishingActionPath,
  publishingSheetPath,
  publishingStateLabel,
  publishingViewerActions,
  writerSplitValidationError,
  type PublishingRegistrationItem,
} from "./publishing-splits";

/* Publishing splits registry (Wave 3, #22): client mirror of the
   server rules. Copy is pinned verbatim — the UI must SAY that
   collection is partner-gated, not just implement a registry. */

const item = (over: Partial<PublishingRegistrationItem>): PublishingRegistrationItem => ({
  id: "11111111-1111-1111-1111-111111111111",
  song_kind: "release",
  song_id: "22222222-2222-2222-2222-222222222222",
  song_title: "Midnight Tide",
  is_owner: false,
  state: "awaiting_confirmations",
  has_dispute: false,
  collection_status: "not_connected",
  collection_notice: PUBLISHING_COPY.collectionNotice,
  my_share_pct: 40,
  my_writer_status: "pending",
  writers: [],
  created_at: "2026-10-24T00:00:00Z",
  updated_at: "2026-10-24T00:00:00Z",
  ...over,
});

describe("PUBLISHING_COPY — no-collection-claim pins", () => {
  it("carries the exact partner-gated collection label", () => {
    expect(PUBLISHING_COPY.collectionNotice).toBe(
      "Registered — collection activates when publishing administration is connected.",
    );
  });
  it("states plainly the registry does not collect or pay royalties", () => {
    expect(PUBLISHING_COPY.registryOnly).toContain("does not collect or pay royalties");
    expect(PUBLISHING_COPY.registryOnly).toContain("none is connected yet");
  });
  it("states a dispute never changes anyone's share", () => {
    expect(PUBLISHING_COPY.disputeRule).toContain("never changes anyone's share");
  });
});

describe("writerSplitValidationError — mirrors the server rule", () => {
  it("accepts exact 100, a solo 100, and tolerance-edge splits", () => {
    expect(writerSplitValidationError([{ name: "A", sharePct: 60 }, { name: "B", sharePct: 40 }])).toBeNull();
    expect(writerSplitValidationError([{ name: "Solo", sharePct: 100 }])).toBeNull();
    expect(writerSplitValidationError([{ name: "A", sharePct: 60 }, { name: "B", sharePct: 39.99 }])).toBeNull();
  });
  it("flags sums that are not 100 with the real total", () => {
    expect(writerSplitValidationError([{ name: "A", sharePct: 60 }, { name: "B", sharePct: 30 }])).toContain("total 90.00%");
  });
  it("flags zero/negative/over-100, >2dp, missing names, and duplicate accounts", () => {
    expect(writerSplitValidationError([{ name: "A", sharePct: 0 }, { name: "B", sharePct: 100 }])).toContain("more than 0%");
    expect(writerSplitValidationError([{ name: "A", sharePct: 33.333 }, { name: "B", sharePct: 66.667 }])).toContain("two decimal places");
    expect(writerSplitValidationError([{ name: " ", sharePct: 100 }])).toContain("needs a name");
    expect(
      writerSplitValidationError([
        { name: "A", userId: "u1", sharePct: 50 },
        { name: "A2", userId: "u1", sharePct: 50 },
      ]),
    ).toContain("can't be listed twice");
  });
});

describe("publishingViewerActions — mirrors the server machine", () => {
  it("a pending writer can confirm, dispute, and view the sheet — not amend", () => {
    expect(publishingViewerActions(item({}))).toEqual(["sheet", "confirm", "dispute"]);
  });
  it("a disputed writer can confirm (resolving it) but not re-dispute", () => {
    expect(publishingViewerActions(item({ my_writer_status: "disputed" }))).toEqual(["sheet", "confirm"]);
  });
  it("a confirmed writer can dispute; the owner can also amend", () => {
    expect(publishingViewerActions(item({ my_writer_status: "confirmed", is_owner: true }))).toEqual([
      "sheet",
      "dispute",
      "amend",
    ]);
  });
  it("an unlinked or non-writer viewer only gets the sheet", () => {
    expect(publishingViewerActions(item({ my_writer_status: "unlinked" }))).toEqual(["sheet"]);
    expect(publishingViewerActions(item({ my_writer_status: null, my_share_pct: null }))).toEqual(["sheet"]);
  });
});

describe("paths + labels", () => {
  it("builds the action and sheet paths", () => {
    expect(publishingActionPath("a b", "confirm")).toBe("/api/publishing-splits/a%20b/confirm");
    expect(publishingSheetPath("x")).toBe("/api/publishing-splits/x/sheet");
  });
  it("labels the disputed state as flagged with shares unchanged", () => {
    expect(publishingStateLabel("disputed")).toContain("shares unchanged");
    expect(publishingStateLabel("confirmed")).toBe("All writers confirmed");
  });
});
