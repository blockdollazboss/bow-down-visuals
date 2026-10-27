/**
 * export-failure-ux.test.ts — orphan-wave export-poll-stop (Oct 26).
 *
 * Pins the failure-UX contract for exports: when an export fails, the
 * user gets (a) what happened (the existing raw error line), (b) the
 * charge truth for THAT outcome, and (c) what to do next — instead of
 * the old dead-end panel that showed only a title + raw message.
 *
 * The honesty split is the point: a server-reported terminal failure
 * means the rail released any Visual Bucs hold in full (A-07 reserve /
 * release in runExportJobInBackground), so the panel may say "not
 * charged". A poller lost-contact / timeout / unknown-status outcome
 * means the job may still finish server-side — that panel must NOT
 * promise "not charged"; it warns to wait before re-exporting.
 *
 * Source-pin pattern (node harness cannot mount the component), same
 * as final-video-export-pro-finish.test.ts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const fve = readFileSync(join(__dirname, "FinalVideoExport.tsx"), "utf8");
const autoclip = readFileSync(join(__dirname, "editor/sections/AutoClipSection.tsx"), "utf8");
const en = readFileSync(join(__dirname, "..", "locales", "en.json"), "utf8");
const poller = readFileSync(join(__dirname, "..", "lib", "export-job-poll.ts"), "utf8");

describe("FinalVideoExport — export failure UX", () => {
  it("classifies failures by the poller's typed codes", () => {
    expect(fve).toContain("EXPORT_POLL_LOST_CONTACT_CODE");
    expect(fve).toContain("EXPORT_POLL_TIMEOUT_CODE");
    expect(fve).toContain("EXPORT_POLL_UNKNOWN_STATUS_CODE");
    expect(fve).toContain('failureCode?.startsWith("http_")');
    expect(fve).toContain('"unknown_outcome"');
  });

  it("terminal failures state the charge truth and the next step", () => {
    expect(fve).toContain('t("videoExport.failedNotCharged")');
    expect(fve).toContain('t("videoExport.failedNextStep")');
    expect(en).toContain("You were not charged for this export.");
    expect(en).toContain("it was released in full");
    expect(en).toContain("What to do next:");
  });

  it("unknown outcomes never promise 'not charged' — they warn about double renders", () => {
    expect(fve).toContain('t("videoExport.failedUnknownOutcome")');
    expect(en).toContain("We couldn't confirm how this one ended");
    expect(en).toContain("paying for two renders of the same video");
    // The unknown-outcome copy lives under its own key, separate from
    // the not-charged key, so the two can never be shown together.
    const unknownKey = en.slice(en.indexOf('"failedUnknownOutcome"'), en.indexOf('"failedUnknownOutcome"') + 500);
    expect(unknownKey).not.toContain("You were not charged");
  });

  it("a fresh export attempt resets the failure kind", () => {
    expect(fve).toContain('setErrorKind("failed")');
  });
});

describe("AutoClipSection — clip failure UX", () => {
  it("carries the error code per clip and splits the notes by outcome", () => {
    expect(autoclip).toContain("errorCode: (e as { code?: string }).code");
    expect(autoclip).toContain("isUnknownOutcomeCode");
    expect(autoclip).toContain('data-testid="autoclip-failure-charge-note"');
    expect(autoclip).toContain("Failed clips were not charged");
    expect(autoclip).toContain('data-testid="autoclip-failure-unknown-note"');
    expect(autoclip).toContain("couldn&apos;t be confirmed");
  });
});

describe("export-job-poll — codes the UX splits on", () => {
  it("stamps lost-contact, timeout and unknown-status codes", () => {
    expect(poller).toContain('EXPORT_POLL_LOST_CONTACT_CODE = "poll_lost_contact"');
    expect(poller).toContain('EXPORT_POLL_TIMEOUT_CODE = "poll_timeout"');
    expect(poller).toContain('EXPORT_POLL_UNKNOWN_STATUS_CODE = "unknown_status"');
    expect(poller).toContain("STATUS_CHECK_OUTAGE_WINDOW_MS = 90 * 1000");
  });
});
