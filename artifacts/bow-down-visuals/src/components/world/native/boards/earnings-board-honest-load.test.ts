/**
 * EarningsBoard (the in-World earnings board + statement
 * PDF) — honest load states (Stack-400 C-28 components
 * residual, deep-pins tranche 6).
 *
 * A money board on the shared native states
 * (NativeLoadingState at its head): earnings figures render
 * only from proven payloads across its legs, each with its
 * own catch — and the STATEMENT PDF download proves its
 * response before producing a file: `if (!res.ok) throw
 * new Error("pdf")` stands between the fetch and the
 * download, so an error body is never saved as a statement
 * (the tranche-6 CSV doctrine, already correct here), with
 * the downloading note shown only on the proven path.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./EarningsBoard.tsx");

describe("the statement file is produced only from a proven response", () => {
  it("the pdf gate and the native loading state are pinned", () => {
    expect(src).toContain('if (!res.ok) throw new Error("pdf");');
    expect(src).toContain('setPdfNote(t("worldBoards.ebPdfDownloading", { year }));');
    expect(src).toContain("NativeLoadingState,");
  });
});
