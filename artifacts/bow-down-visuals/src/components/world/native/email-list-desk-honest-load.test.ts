/**
 * EmailListDesk (the World email-list desk) — honest load
 * states (Stack-400 C-28 components residual, deep-pins
 * tranche 2). The desk judges its panels by weight, and each
 * weight gets its honest shape:
 *
 * - THE LISTS ride a state machine: non-ok throws into
 *   listsState "failed"; the list + the active selection seed
 *   only from a proven payload.
 * - THE WORKING PANELS (subscribers + stats, automations) ride
 *   their own loading/ready/failed machines inside
 *   loadListPanels — a failed subscribers read is a failed
 *   panel, never an empty list with zeroed stats.
 * - THE READOUTS (segments, campaign history) record only on
 *   ok and are documented as readouts: "the desk stands
 *   without them" — their absence claims nothing.
 *
 * NO FIX in this lane — every family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("./EmailListDesk.tsx");

describe("the lists: failure is a state, never an empty desk", () => {
  it("a non-ok read throws into the failed state; success records + readies", () => {
    expect(desk).toContain('if (!res.ok) throw new Error("lists");');
    expect(desk).toContain("setLists(parsed);");
    expect(desk).toContain('setListsState("ready");');
    expect(desk).toContain('catch { if (!cancelled) setListsState("failed"); }');
  });
});

describe("the working panels ride their own machines", () => {
  it("subscribers: non-ok throws into the failed panel state", () => {
    expect(desk).toContain('setSubsState("loading");');
    expect(desk).toContain('if (!res.ok) throw new Error("subs");');
    expect(desk).toContain("setSubscribers(parsed.subscribers);");
    expect(desk).toContain('setSubsState("ready");');
    expect(desk).toContain('} catch { setSubsState("failed"); }');
  });

  it("automations mirror it with autoState", () => {
    expect(desk).toContain('setAutoState("loading");');
    expect(desk).toContain('if (!res.ok) throw new Error("autos");');
    expect(desk).toContain('setAutoState("ready");');
    expect(desk).toContain('} catch { setAutoState("failed"); }');
  });
});

describe("the readouts are documented as readouts", () => {
  it("segments and campaigns record only on ok and the desk stands without them", () => {
    expect(desk).toContain("/* segments are a readout — the desk stands without them */");
    expect(desk).toContain("/* campaign history is a readout — the desk stands without it */");
    expect(desk).toContain("if (res.ok) setSegments(parseSegments(await res.json()));");
    expect(desk).toContain("if (res.ok) setCampaigns(parseCampaigns(await res.json()));");
  });
});
