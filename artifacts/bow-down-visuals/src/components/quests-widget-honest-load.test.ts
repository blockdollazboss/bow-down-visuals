/**
 * QuestsWidget — honest load states (Stack-400 C-28 components
 * residual, deep-pins tranche 1). The dashboard quests widget loads
 * its weekly slate and daily trio INDEPENDENTLY (Promise.allSettled):
 * each loader throws on a non-ok response, and a rejected leg flags
 * only its own section's error state — a failed trio never takes
 * the weekly board down and a failed board never reads as "no
 * quests". With nothing loaded and the weekly leg failed, the
 * widget renders its load-failed card with a retry wired to the
 * real load; with the board loaded, a failed trio renders its own
 * error line with its own retry above the (real) weekly rows.
 *
 * Copy rides i18n keys with English defaultValue fallbacks, so the
 * pin asserts the key usage in source. The FE suite runs in node
 * (no DOM), so — like the sibling honest-load pins — these tests
 * pin the state machine in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const widget = read("./QuestsWidget.tsx");

describe("failure path — each leg fails into its own visible state", () => {
  it("both section error states exist and start clear", () => {
    expect(widget).toContain("const [weeklyError, setWeeklyError] = useState(false);");
    expect(widget).toContain("const [dailyError, setDailyError] = useState(false);");
  });

  it("each loader throws on a non-ok response", () => {
    expect(widget).toContain('const res = await fetch("/api/retention/quests", { headers });');
    expect(widget).toContain("if (!res.ok) throw new Error(`quests ${res.status}`);");
    expect(widget).toContain('const res = await fetch("/api/retention/quests/daily", { headers });');
    expect(widget).toContain("if (!res.ok) throw new Error(`daily quests ${res.status}`);");
  });

  it("the legs settle independently and a rejection flags only its own section", () => {
    expect(widget).toContain("const [weeklySettled, dailySettled] = await Promise.allSettled([loadWeekly(), loadDaily()]);");
    expect(widget).toContain("/* A failed trio read flags the trio's own error state, never the board. */");
  });

  it("an auth-headers failure flags both sections instead of emptying the widget", () => {
    expect(widget).toContain("setWeeklyError(true);\n      setDailyError(true);");
  });
});

describe("the failure renders — with retries wired to the real load", () => {
  it("nothing loaded + weekly failed renders the load-failed card, not silence", () => {
    expect(widget).toContain("if (!data) {");
    expect(widget).toContain("if (!weeklyError) return null;");
    expect(widget).toContain('t("retention.quests_load_failed", { defaultValue: "Your quests couldn\'t load — check your connection and try again." })');
    expect(widget).toContain('t("retention.quests_retry", { defaultValue: "Try again" })');
  });

  it("a failed trio renders its own error line above the loaded weekly rows", () => {
    expect(widget).toContain("{dailyError && (");
    expect(widget).toContain('t("retention.daily_quests_load_failed", { defaultValue: "Today\'s daily quests couldn\'t load — your weekly quests below are fine." })');
  });

  it("both retries call the real load", () => {
    expect(widget.split("onClick={() => void load()}").length - 1).toBeGreaterThanOrEqual(2);
  });

  it("the user's hide choice still wins over the failure card", () => {
    expect(widget.indexOf("if (hidden) return null;")).toBeLessThan(widget.indexOf("if (!data) {"));
  });
});
