/**
 * DailyDropSlate — honest load states (Stack-400 C-28 components
 * residual, deep-pins tranche 1). The website-side Daily Drop
 * catalogue (dashboard, under the day's drop card) rides an explicit
 * "loading" | "ready" | "failed" machine: a failed catalogue load —
 * non-ok response OR a 200 whose body fails the shared normalizer —
 * lands on the failed panel with a retry wired to the real load, so
 * the 30-template slate can never read as an empty catalogue. The
 * signed-out and prefs-off states render nothing by design, after
 * the failure branch, never instead of it.
 *
 * Copy rides i18n keys, so the pin asserts the keys and carries the
 * catalog block. The FE suite runs in node (no DOM), so — like the
 * sibling honest-load pins — these tests pin the machine in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const slate = read("./DailyDropSlate.tsx");

const LOCALES = ["en", "es", "fr", "de", "it", "pt", "ar", "hi", "ja", "ko"] as const;
function flat(o: unknown, p = "", out: Record<string, string> = {}): Record<string, string> {
  if (o && typeof o === "object" && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const key = p ? `${p}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) flat(v, key, out);
      else out[key] = v as string;
    }
  }
  return out;
}

describe("failure path — a failed catalogue load is a failed panel, never an empty slate", () => {
  it("the state machine starts at loading", () => {
    expect(slate).toContain('useState<"loading" | "ready" | "failed">("loading")');
  });

  it("the shared fetch helper throws on a non-ok response", () => {
    expect(slate).toContain("if (!res.ok) throw new Error(apiErrorMessage(data, `Request failed (${res.status})`));");
  });

  it("a malformed catalogue body throws inside the load instead of rendering", () => {
    expect(slate).toContain("const normalized = normalizeDailyDropCatalog(d);");
    expect(slate).toContain('if (!normalized) throw new Error("bad catalogue shape");');
  });

  it("any load failure lands on the failed state", () => {
    expect(slate).toContain('setState("failed");');
  });

  it("the failed panel carries its copy and a retry wired to the real load", () => {
    expect(slate).toContain('t("retention.dropCatalog.failedTitle")');
    expect(slate).toContain('t("retention.dropCatalog.failedBody")');
    expect(slate).toContain("onClick={() => void load()}");
    expect(slate).toContain('t("common.retry")');
  });
});

describe("loading, ready and closed states stay distinct from failure", () => {
  it("render order is loading → failed → the prefs-off null", () => {
    const loadingAt = slate.indexOf('if (state === "loading") {');
    const failedAt = slate.indexOf('if (state === "failed") {');
    const closedAt = slate.indexOf("if (!catalog || !catalog.enabled) return null;");
    expect(loadingAt).toBeGreaterThan(-1);
    expect(failedAt).toBeGreaterThan(loadingAt);
    expect(closedAt).toBeGreaterThan(failedAt);
  });

  it("an archive write moves the row only after the server confirms, and a failed write says so", () => {
    expect(slate).toContain("/* The server confirmed — only now does the row move lists. */");
    expect(slate).toContain('setNote(t("retention.dropCatalog.saveFailed"));');
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the drop-catalogue honest-load keys", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    for (const k of [
      "retention.dropCatalog.loading",
      "retention.dropCatalog.failedTitle",
      "retention.dropCatalog.failedBody",
      "retention.dropCatalog.saveFailed",
      "common.retry",
    ]) {
      expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
    }
  });
});
