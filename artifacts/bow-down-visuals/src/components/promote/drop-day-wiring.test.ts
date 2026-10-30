/**
 * drop-day-wiring.test.ts — Drop Day Kit (#169) H3 source contracts.
 *
 * Pins the docking + honesty shape of the kit's Promote home:
 * - the panel docks INSIDE Promote (mounted by pages/promote.tsx)
 *   and is NOT a standalone page: no App.tsx route, no sidebar
 *   door, no page file;
 * - the panel reads the kit family's real endpoints only — the
 *   /mine list, the one-tap assemble, the activation PATCH — and
 *   its checklist comes from the server, never derived client-side;
 * - the announcement step goes through the Scheduler's own door
 *   (buildSchedulerHref + releaseAnnounceCaption, the DE-4
 *   protocol) — the query string is never hand-rolled here;
 * - no countdown timer is revived: countdown widgets are retired
 *   by owner ruling, and the presave page owns the countdown —
 *   this panel carries no ticking timer of any kind.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

const panel = read("components/promote/DropDayPanel.tsx");
const promote = read("pages/promote.tsx");
const app = read("App.tsx");

describe("drop day docking — inside Promote, never standalone", () => {
  it("promote.tsx mounts the panel", () => {
    expect(promote).toContain("DropDayPanel");
    expect(promote).toContain("<DropDayPanel />");
  });

  it("no route, no page file, no sidebar door exists for the panel", () => {
    expect(app).not.toContain("DropDayPanel");
    expect(app).not.toContain("drop-day-panel");
    expect(existsSync(join(SRC, "pages/drop-day.tsx"))).toBe(false);
    expect(existsSync(join(SRC, "pages/drop-day-kit.tsx"))).toBe(false);
    const sidebar = read("components/layout/app-sidebar.tsx");
    expect(sidebar).not.toContain("DropDayPanel");
  });
});

describe("drop day endpoints — the kit family's real doors only", () => {
  it("reads the /mine list and uses the assemble + activate doors", () => {
    expect(panel).toContain("/api/drop-day-kits/mine");
    expect(panel).toContain('fetch("/api/drop-day-kits"');
    expect(panel).toContain("/status");
    expect(panel).toContain('"PATCH"');
  });

  it("renders the server-derived checklist — it never derives steps itself", () => {
    expect(panel).toContain("kit.checklist");
    expect(panel).not.toContain("assembleChecklist");
  });
});

describe("drop day announcement — through the Scheduler's own door", () => {
  it("uses buildSchedulerHref + releaseAnnounceCaption (DE-4)", () => {
    expect(panel).toContain("buildSchedulerHref");
    expect(panel).toContain("releaseAnnounceCaption");
    expect(panel).toContain('from "@/lib/scheduler-handoff"');
  });

  it("never hand-rolls the scheduler query string", () => {
    expect(panel).not.toContain("schedule=1");
    expect(panel).not.toContain("/scheduler?");
  });
});

describe("drop day — the retired countdown shape stays retired", () => {
  it("the panel carries no ticking timer", () => {
    expect(panel).not.toContain("setInterval");
    expect(panel).not.toContain("useCountdown");
  });
});
