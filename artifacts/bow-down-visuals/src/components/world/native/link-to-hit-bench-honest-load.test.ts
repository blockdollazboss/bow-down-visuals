/**
 * LinkToHitBench (the in-World link-to-hit bench) — honest
 * action states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * A native-bench twin of the 2D LinkToHitPanel, held to the
 * same law:
 * - THE INPUT validates up front with plain, specific
 *   errors BEFORE any upload or charge: a non-video file is
 *   refused as not-a-video (linkToHit.notVideo), and an
 *   oversized video names the member's OWN actual limit
 *   (tooLarge interpolates uploadLimitLabel for their tier).
 * - THE UPLOAD runs as its own flagged leg (uploading state
 *   distinct from the analyze loading state), so the bench
 *   never confuses "still uploading" with "analyzing", and
 *   the package renders only from the proven analyze
 *   response on the far side of both.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./LinkToHitBench.tsx");

describe("validation speaks before bytes move, in the member's own limit", () => {
  it("the upfront errors and the split busy legs are pinned", () => {
    expect(src).toContain('setError(t("linkToHit.notVideo"));');
    expect(src).toContain('setError(t("linkToHit.tooLarge", { limit: uploadLimitLabel(isAdmin, LINK_TO_HIT_MEMBER_UPLOAD_BYTES) }));');
    expect(src).toContain("const [uploading, setUploading] = useState(false);");
  });
});
