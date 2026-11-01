/**
 * lipsync-copy-no-provider-brands.test.ts — LipSyncSection's rendered copy
 * names no provider company (owner law, Oct 13: no other company names in
 * user-facing copy — our names only).
 *
 * The section's static copy hardcoded the premium vendor's brand across
 * the confirm dialog (its provider row), the check-job panel (job-ID
 * label, resubmit warnings, dashboard button), the spend-confirm details,
 * the diagnostics cards, and the failure/processing error defaults. All
 * of it now speaks in our vocabulary ("lip sync", "Premium engine").
 *
 * The pin is a line inventory: every line in the file that still mentions
 * the brand must be one of the legitimate non-copy categories below —
 * a code comment, a `lipSyncProvider` provenance stamp (scene metadata,
 * rendered only through lipSyncProviderLabel, never verbatim), or the
 * engine-dashboard button's destination URL in code (a functional link
 * target, like a connect-to destination; its visible label is brand-free
 * and pinned below). Any future rendered string carrying the brand lands
 * on an unclassified line and fails here, naming the line.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../../components/editor/sections/LipSyncSection.tsx", import.meta.url),
  "utf8",
);

const BRAND = /sync\.so|sync labs/i;

/** The non-copy categories a brand mention may still live in. */
function classify(line: string): string | null {
  if (/lipSyncProvider:/.test(line)) return "provenance data stamp";
  if (/"https:\/\/sync\.so"/.test(line)) return "dashboard destination URL (code)";
  const trimmed = line.trimStart();
  if (
    trimmed.startsWith("/*") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("//") ||
    trimmed.startsWith("{/*")
  ) {
    return "code comment";
  }
  return null;
}

describe("LipSyncSection rendered copy — no provider brand names", () => {
  it("every brand mention left in the file is comment, data, or the link target", () => {
    const offenders: string[] = [];
    source.split("\n").forEach((line, i) => {
      if (BRAND.test(line) && classify(line) === null) {
        offenders.push(`line ${i + 1}: ${line.trim().slice(0, 100)}`);
      }
    });
    expect(offenders).toEqual([]);
  });

  it("the named A-09 surfaces speak in our vocabulary now", () => {
    // Confirm dialog: the engine row (was label "provider" / value "Sync.so").
    expect(source).toContain('label="engine"');
    expect(source).toContain('value="Premium engine"');
    // Check-job panel: job-ID label + utility buttons.
    expect(source).toContain('label="lip sync job ID"');
    expect(source).toContain("Copy Lip Sync Job ID");
    expect(source).toContain("Open Engine Dashboard");
    // Check-failed / processing error defaults.
    expect(source).toContain('"Lip sync job failed."');
    expect(source).toContain('"Still processing. Check again in a few minutes."');
    // Diagnostics cards.
    expect(source).toContain("Validate Lip Sync Payload");
    expect(source).toContain('title="Lip Sync Account Check"');
  });

  it("the old brand-carrying phrases are gone from the source", () => {
    for (const stale of [
      "Sync.so job failed",
      "paid Sync.so",
      "Sync.so job ID",
      "Copy Sync.so Job ID",
      "Open Sync.so Dashboard",
      "Check Sync.so dashboard",
      "upgrade your Sync.so plan",
      "processing on Sync.so",
      "Sync Labs Account",
      "Sync Labs Payload",
      "Sync Labs Submit Route",
      "Sync Labs API key",
      "Sync Labs keys found",
      "Sync Labs account",
    ]) {
      expect(source, stale).not.toContain(stale);
    }
  });

  it("A-09 honesty survives: the over-limit warning still says what to do", () => {
    expect(source).toContain("limit for one job. Trim this scene or split it in two.");
    expect(source).not.toContain("upgrade your");
  });
});
