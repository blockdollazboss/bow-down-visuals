/**
 * PhotoEnhance (AI photo enhancement in the photo studio) —
 * honest action states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * An action panel with three honest legs:
 * - THE UPLOAD validates before it sends (not-an-image and
 *   over-12MB are their own error lines) and a failed upload
 *   lands on the upload error line — the photo is never
 *   treated as uploaded on a failure.
 * - THE ENHANCE gates on ok + the proven result url; the
 *   out-of-credits body is translated into the credits error
 *   line, and any other failure into the server's message —
 *   success is never claimed for an enhancement that didn't
 *   come back.
 * - THE DOWNLOAD falls back honestly: a failed blob fetch
 *   opens the proven result url in a new tab instead of
 *   pretending a file was saved (the comment says so).
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./PhotoEnhance.tsx");

describe("the enhance gates success on ok + the proven result url", () => {
  it("non-ok or a missing url lands on the error line; credits get their own line", () => {
    expect(src).toContain("if (!res.ok || !data.url) {");
    expect(src).toContain('msg === "out_of_credits"');
    expect(src).toContain("setUploading(false);");
  });
});

describe("the download falls back to the proven url instead of faking a save", () => {
  it("a failed blob fetch opens the result in a new tab", () => {
    expect(src).toContain("if (!res.ok) throw new Error(`download ${res.status}`);");
    expect(src).toContain('window.open(result.url, "_blank", "noopener");');
  });
});
