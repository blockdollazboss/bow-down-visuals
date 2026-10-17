/**
 * scheduler-handoff-wiring.test.ts — Stack-30 Lane E (E1/E2).
 *
 * The scheduler composer auto-opens ONLY through the canonical protocol
 * (/scheduler?schedule=1&caption=… — see lib/scheduler-handoff.ts and the
 * deep-link effect in pages/scheduler.tsx, which returns early unless
 * schedule=1 and never reads a `text` param). Two senders bypassed it:
 *
 *  - E1: the label-pitch page navigated to /scheduler?caption=… WITHOUT
 *    schedule=1, so the composer never opened and the caption went
 *    nowhere.
 *  - E2: PromoteButton linked /scheduler?text=…, a param the scheduler
 *    has never read — the share text went nowhere.
 *
 * Both now build their link through buildSchedulerHref. These tests pin
 * the senders to the builder and the builder's output to the exact
 * params the composer consumes.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildSchedulerHref } from "./scheduler-handoff";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const labelPitchSource = read("../pages/label-pitch.tsx");
const promoteButtonSource = read("../components/storefront/PromoteButton.tsx");
const schedulerSource = read("../pages/scheduler.tsx");

describe("E1 — label pitch hands its announcement to the composer protocol", () => {
  it("label-pitch builds its scheduler navigation through buildSchedulerHref", () => {
    expect(labelPitchSource).toContain('import { buildSchedulerHref } from "@/lib/scheduler-handoff"');
    expect(labelPitchSource).toContain("buildSchedulerHref({ caption: `New music: ${songTitle || kit.analysis.oneLiner || \"\"}` })");
  });

  it("label-pitch no longer navigates to a bare /scheduler?caption= link (no schedule=1, composer stays shut)", () => {
    expect(labelPitchSource).not.toContain("/scheduler?caption=");
  });

  it("the href the builder produces for the pitch caption is one the composer actually consumes", () => {
    const href = buildSchedulerHref({ caption: "New music: My Song" });
    const q = new URLSearchParams(href.split("?")[1]);
    // The composer's gate + reads, mirrored from pages/scheduler.tsx.
    expect(q.get("schedule")).toBe("1");
    expect(q.get("caption")).toBe("New music: My Song");
    expect(schedulerSource).toContain('params.get("schedule") !== "1"');
    expect(schedulerSource).toContain('params.get("caption")');
  });
});
