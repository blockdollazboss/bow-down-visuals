/**
 * duplicate-ledger-writes.test.ts — Stack400 Lane 4 (charge integrity).
 *
 * Pins the A3 fix: chargeCredits() writes the credit_usage ledger row
 * itself (strictly). Nineteen endpoints across twelve route files ALSO
 * wrote a second row for the same deduction with a leftover
 * recordCreditUsage() call, so members' histories summed 2× what their
 * balance actually dropped. These files must never call
 * recordCreditUsage( again — the one row comes from the charge rail.
 *
 * (Grant-side modules use recordCreditUsageStrict paired with explicit
 * balance adds and are NOT in this list — that pattern is the ledger
 * write for money chargeCredits never touched.)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, "..", "..");

const FILES_THAT_MUST_NOT_RECORD_USAGE = [
  "routes/analytics.ts",
  "routes/social.ts",
  "routes/generate/brand-deals.ts",
  "routes/generate/community.ts",
  "routes/generate/email-list.ts",
  "routes/generate/interview-prep.ts",
  "routes/generate/invoice.ts",
  "routes/generate/milestones.ts",
  "routes/generate/show-finder.ts",
  "routes/generate/sponsor-read.ts",
  "routes/generate/sponsorship-outreach.ts",
  "routes/generate/thumbnail-generator.ts",
];

describe("no duplicate ledger writes (chargeCredits owns the row)", () => {
  for (const rel of FILES_THAT_MUST_NOT_RECORD_USAGE) {
    it(`${rel} never calls recordCreditUsage(`, () => {
      const source = readFileSync(join(srcRoot, rel), "utf8");
      /* Strip block comments + line comments so the explanatory notes
         left at the removal sites don't trip the pin. */
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      expect(code).not.toMatch(/\brecordCreditUsage\s*\(/);
      expect(code).not.toMatch(/\brecordCreditUsageStrict\s*\(/);
    });
  }
});
