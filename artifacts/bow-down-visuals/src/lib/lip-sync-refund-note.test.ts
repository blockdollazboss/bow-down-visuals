/**
 * lip-sync-refund-note.test.ts — stack1200: the failure tell for a
 * lip-sync job must state the refund verdict, keyed off the job's own
 * refund gate (chargeRefunded, migration 0310) and naming the amount
 * from the job's own charge record (refundedCredits) — never a figure
 * typed into the client, and never a refund claim for a failure whose
 * refund didn't fire.
 */
import { describe, expect, it } from "vitest";
import {
  lipSyncRefundNote,
  withLipSyncRefundNote,
} from "./lip-sync-result-meta";
import en from "../locales/en.json";
import es from "../locales/es.json";
import fr from "../locales/fr.json";
import pt from "../locales/pt.json";
import de from "../locales/de.json";
import itJson from "../locales/it.json";
import hi from "../locales/hi.json";
import ar from "../locales/ar.json";
import ja from "../locales/ja.json";
import ko from "../locales/ko.json";

const renderEn = (credits: number) =>
  en.lipSync.refundNote.replace("{{credits}}", String(credits));

describe("lipSyncRefundNote — failure WITH a landed refund", () => {
  it("states the verdict with the amount from the job's charge record", () => {
    /* 450, not the rail's usual 300: the figure must come from the
       record the server sent, never from a client-side constant. */
    const note = lipSyncRefundNote(
      { chargeRefunded: true, refundedCredits: 450 },
      renderEn,
    );
    expect(note).toBe("Your 450 Visual Bucs were refunded.");
  });

  it("appends the verdict to the failure message", () => {
    expect(
      withLipSyncRefundNote(
        "Sync.so reported the generation failed: boom",
        { chargeRefunded: true, refundedCredits: 300 },
        renderEn,
      ),
    ).toBe(
      "Sync.so reported the generation failed: boom Your 300 Visual Bucs were refunded.",
    );
  });

  it("hands the record's amount to the translator untouched", () => {
    const seen: number[] = [];
    lipSyncRefundNote({ chargeRefunded: true, refundedCredits: 275 }, (c) => {
      seen.push(c);
      return "note";
    });
    expect(seen).toEqual([275]);
  });
});

describe("lipSyncRefundNote — failure WITHOUT a landed refund claims nothing", () => {
  it("gate false: no verdict, message untouched", () => {
    const job = { chargeRefunded: false, refundedCredits: 300 };
    expect(lipSyncRefundNote(job, renderEn)).toBeNull();
    expect(withLipSyncRefundNote("Provider died.", job, renderEn)).toBe(
      "Provider died.",
    );
  });

  it("no refund fields at all (older job record): no verdict", () => {
    expect(lipSyncRefundNote({}, renderEn)).toBeNull();
    expect(lipSyncRefundNote(null, renderEn)).toBeNull();
    expect(lipSyncRefundNote(undefined, renderEn)).toBeNull();
    expect(
      withLipSyncRefundNote("Provider died.", {}, renderEn),
    ).toBe("Provider died.");
  });

  it("gate true but the record names no amount: never invent one", () => {
    for (const refundedCredits of [undefined, null, 0, -5, Number.NaN]) {
      expect(
        lipSyncRefundNote({ chargeRefunded: true, refundedCredits }, renderEn),
      ).toBeNull();
    }
  });
});

describe("the lipSync.refundNote catalog key", () => {
  it("exists in English with the credits interpolation", () => {
    expect(en.lipSync.refundNote).toBe(
      "Your {{credits}} Visual Bucs were refunded.",
    );
  });

  it("exists in all ten catalogs, each carrying the interpolation", () => {
    const catalogs = { en, es, fr, pt, de, it: itJson, hi, ar, ja, ko };
    for (const [lng, cat] of Object.entries(catalogs)) {
      const note = (cat as typeof en).lipSync?.refundNote;
      expect(note, lng).toBeTruthy();
      expect(note, lng).toContain("{{credits}}");
      expect(note, lng).toContain("Visual Bucs");
    }
  });
});
