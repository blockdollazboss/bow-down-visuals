/**
 * SplitsOverview (the Splits view inside the Money Tracker,
 * /coach?tab=money) — honest load states (Stack-400 C-28
 * components residual, deep-pins tranche 6).
 *
 * - THE OVERVIEW is the full four-state exemplar in early
 *   returns: loading renders first, then the error state (with
 *   a retry wired to the real loader), then the genuine empty
 *   state, then data. Its loader throws on non-ok before
 *   recording anything, so a failed read can never land as
 *   "No split agreements yet".
 * - The null-res return is unreachable defense, not a silent
 *   swallow: the load rides confirmedFetch with skipConfirm,
 *   and a null only ever comes from a declined confirmation
 *   (which skipConfirm never shows); the finally still clears
 *   the loading flag either way, so the panel can never spin
 *   forever.
 * - THE fetchReleaseOptions HELPER is fail-soft BY CONTRACT:
 *   it feeds optional release pickers in the entry forms, and
 *   every consumer's call site was already pinned in tranches
 *   2–3 (money-tracker, publishing-splits, coach-panels). An
 *   empty option list there is a picker with nothing to pick,
 *   never a data view dressed as empty.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./SplitsOverview.tsx");

describe("the splits overview: loading, error, empty, data — in that order", () => {
  it("the loader throws on non-ok before recording any data", () => {
    expect(src).toContain('if (!res.ok) throw new Error(apiErrorMessage(json, "Couldn\'t load the splits overview."));');
    expect(src).toContain("setData(json);");
    expect(src).toContain('setError(plainErrorText(err, "Couldn\'t load the splits overview."));');
  });

  it("the null-res return can never strand the spinner — finally clears loading", () => {
    expect(src).toContain("if (!res) return;");
    expect(src).toContain('const res = await confirmedFetch("/api/splits/overview", { skipConfirm: true });');
    expect(src).toContain("setLoading(false);");
  });

  it("the render chain is loading → error (with retry) → genuine empty → data", () => {
    const loadingIdx = src.indexOf("if (loading) {");
    const errorIdx = src.indexOf("if (error) {");
    const emptyIdx = src.indexOf("if (!data || data.releases.length === 0) {");
    expect(loadingIdx).toBeGreaterThan(-1);
    expect(errorIdx).toBeGreaterThan(loadingIdx);
    expect(emptyIdx).toBeGreaterThan(errorIdx);
    expect(src).toContain("Computing everyone's shares…");
    expect(src).toContain("onClick={load}");
    expect(src).toContain("No split agreements yet");
  });
});

describe("the release-options helper is fail-soft by contract", () => {
  it("any failure returns an empty option list for the picker forms", () => {
    expect(src).toContain("if (!res || !res.ok) return [];");
    expect(src).toContain("return (data.releases ?? []).map((r) => ({ id: r.id, title: r.title }));");
  });
});
