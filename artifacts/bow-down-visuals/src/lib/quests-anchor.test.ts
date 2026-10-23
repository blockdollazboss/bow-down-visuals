import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Stack-28 #44 (A1-03) — sidebar Quests door must land on the widget. */
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("quests anchor (Stack-28 #44)", () => {
  it("widget exposes id=quests with scroll margin", () => {
    const w = read("../components/QuestsWidget.tsx");
    expect(w).toContain('id="quests"');
    expect(w).toContain("scroll-mt-");
  });
  it("sidebar Quests entry points at the anchor and dashboard scrolls to it", () => {
    expect(read("../components/layout/app-sidebar.tsx")).toContain('href: "/dashboard#quests"');
    const dash = read("../pages/dashboard.tsx");
    expect(dash).toContain('window.location.hash !== "#quests"');
    expect(dash).toContain('getElementById("quests")');
  });
});
