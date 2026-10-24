/**
 * fan-graph-visibility.test.ts — the Fan Graph must be FINDABLE on an
 * empty account (live-verified gap, Oct 24 2026).
 *
 * The owner walked /email-list on the pushed build and found no Fan
 * Graph tab or section anywhere. Source audit: the tab button in
 * email-list.tsx is unconditional, but FanGraphTab gated its whole
 * stat row on a successful summary fetch (`{summary && ...}` with a
 * null initial state) — so at zero fans, or on any failed load, the
 * feature's visible surface collapsed to a search box and the owner
 * reasonably concluded it wasn't there. A shipped feature the owner
 * cannot find is not shipped.
 *
 * Pins:
 *  1. The email-list tab bar carries the Fan Graph tab and renders
 *     FanGraphTab for it (the desk wiring).
 *  2. FanGraphTab renders its stat cards from a ZERO-DEFAULT summary
 *     (no fetch-gated stats row) and carries the honest empty-state
 *     line — so an empty account shows five cards at 0 plus the
 *     one-line explanation.
 *  3. The API end of the empty state is behavior-pinned in
 *     api-server fan-graph.test.ts ("an EMPTY account ... gets 200
 *     with an all-zero summary").
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const emailListSource = read("../pages/email-list.tsx");
const fanGraphTabSource = read("./FanGraphTab.tsx");

describe("Fan Graph visibility on an empty account", () => {
  it("the email-list tab bar carries the Fan Graph tab, wired to FanGraphTab", () => {
    expect(emailListSource).toContain('onClick={() => setTab("fans")}');
    expect(emailListSource).toContain('t("email-list.fan_graph")');
    expect(emailListSource).toContain('{tab === "fans" && <FanGraphTab />}');
  });

  it("the stat row renders from a zero default — never gated on a fetch", () => {
    expect(fanGraphTabSource).toContain("const EMPTY_SUMMARY: FanGraphSummary");
    expect(fanGraphTabSource).toContain("useState<FanGraphSummary>(EMPTY_SUMMARY)");
    expect(fanGraphTabSource).toContain("setSummary(data.summary ?? EMPTY_SUMMARY)");
    // The pre-fix shape: stats hidden until a summary arrived.
    expect(fanGraphTabSource).not.toContain("{summary && (");
    expect(fanGraphTabSource).not.toContain("useState<FanGraphSummary | null>(null)");
  });

  it("the honest empty state is one visible line, not an error", () => {
    expect(fanGraphTabSource).toContain('t("email-list.fan_graph_empty")');
    expect(fanGraphTabSource).toContain('fans.length === 0 ? (');
    const en = JSON.parse(read("../locales/en.json")) as {
      "email-list": Record<string, string>;
    };
    expect(en["email-list"]!["fan_graph_empty"]).toContain("No fans here yet.");
    expect(en["email-list"]!["fan_graph"]).toBe("Fan Graph");
  });
});
