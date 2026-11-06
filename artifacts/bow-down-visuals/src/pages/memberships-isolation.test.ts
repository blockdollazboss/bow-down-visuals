/**
 * memberships-isolation.test.ts — Stack-200 hardening wave, section C
 * (census item 38): /memberships payload guards + per-section
 * render-error isolation.
 *
 * The defect: loads settled per source but were stored by cast —
 * setDashboard(data as unknown as Dashboard) after only an
 * `activeMembers !== undefined` sniff, setMine(...) after checking
 * ONLY data.memberships is an array — while the render dereferences
 * mine.memberships.length, mine.giftsSent.map / .length,
 * mine.giftsReceived.length and tiers.map unconditionally. A partial
 * payload missing one array blanked the whole memberships manager,
 * fan side and creator side, and no section had a render boundary.
 *
 * The fix: lib/memberships-data normalizers at the fetch boundary
 * (non-shape → null → the page's existing per-source error states;
 * the unchecked gift arrays default to []), plus a SectionBoundary
 * per section. Idiom follows lane D3.
 */
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SectionBoundaryCore } from "../components/section-boundary";
import {
  normalizeDashboard,
  normalizeMembers,
  normalizeMine,
  normalizeRecovery,
  normalizeTiers,
} from "../lib/memberships-data";

const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");
const pageSource = read("./memberships.tsx");
const appSource = read("../App.tsx");

const LABELS = {
  title: "This section hit a snag",
  description:
    "Something glitched while this part of the page was loading. The rest of the page is fine — try this section again.",
  retryLabel: "Try again",
};

function makeBoundary(name: string, child: ReactElement) {
  return new SectionBoundaryCore({
    name,
    variant: "section",
    isLight: false,
    title: LABELS.title,
    description: LABELS.description,
    retryLabel: LABELS.retryLabel,
    children: child,
  });
}

function failWith(boundary: SectionBoundaryCore, error: Error) {
  Object.assign(
    boundary.state,
    SectionBoundaryCore.getDerivedStateFromError(error),
  );
}

describe("memberships shape — one bad section never blanks the manager", () => {
  it("a failed members section degrades alone; mine + tier builder still render; App-level copy absent", () => {
    const mine = makeBoundary(
      "memberships-mine",
      createElement("p", null, "YOUR MEMBERSHIPS"),
    );
    const members = makeBoundary(
      "memberships-members",
      createElement("p", null, "MEMBERS SECTION"),
    );
    const builder = makeBoundary(
      "memberships-tier-builder",
      createElement("p", null, "TIER BUILDER"),
    );
    failWith(members, new Error("member row malformed"));

    const html = [
      renderToStaticMarkup(mine.render() as ReactElement),
      renderToStaticMarkup(members.render() as ReactElement),
      renderToStaticMarkup(builder.render() as ReactElement),
    ].join("\n");

    expect(html).toContain("YOUR MEMBERSHIPS");
    expect(html).toContain("TIER BUILDER");
    expect(html).toContain('data-testid="section-error-memberships-members"');
    expect(html).not.toContain("MEMBERS SECTION");
    expect(appSource).toContain("The vault guards tripped.");
    expect(html).not.toContain("The vault guards tripped.");
  });
});

describe("memberships normalizers (census item 38)", () => {
  it("mine: the unchecked gift arrays default to [] — the exact deref that used to crash the fan side", () => {
    const mine = normalizeMine({ memberships: [{ id: "m1", status: "active" }] });
    expect(mine).not.toBeNull();
    expect(mine!.memberships).toHaveLength(1);
    expect(mine!.giftsSent).toEqual([]);
    expect(mine!.giftsReceived).toEqual([]);
    expect(() => mine!.giftsSent.map((g) => g.id)).not.toThrow();
    expect(() => mine!.giftsReceived.length).not.toThrow();
    expect(normalizeMine({ giftsSent: [] })).toBeNull();
    expect(normalizeMine(null)).toBeNull();
  });

  it("dashboard: requires a finite activeMembers; byTier defaults to []", () => {
    expect(normalizeDashboard({})).toBeNull();
    expect(normalizeDashboard({ activeMembers: "12" })).toBeNull();
    const dash = normalizeDashboard({ activeMembers: 12, mrrCents: 5000 });
    expect(dash).not.toBeNull();
    expect(dash!.activeMembers).toBe(12);
    expect(dash!.byTier).toEqual([]);
    expect(dash!.paymentsLive).toBe(false);
  });

  it("tiers/members: non-array → null (per-source error state); entries coerce, junk dropped", () => {
    expect(normalizeTiers({})).toBeNull();
    expect(normalizeMembers("x")).toBeNull();
    const tiers = normalizeTiers([{ id: "t1", name: "Gold", perks: ["a", 5] }, null]);
    expect(tiers).toHaveLength(1);
    expect(tiers![0]!.perks).toEqual(["a"]);
    const members = normalizeMembers([{ id: "u1", status: "weird" }, { id: "u2", status: "past_due" }]);
    expect(members).toHaveLength(2);
    expect(members![0]!.status).toBe("active");
    expect(members![1]!.status).toBe("past_due");
  });

  it("recovery: non-shape → null; rows coerce with an always-renderable member + recovery picture", () => {
    expect(normalizeRecovery({})).toBeNull();
    const rec = normalizeRecovery({ members: [{ member: { id: "u1" }, recovery: { state: "bogus", stepsSent: 2 } }] });
    expect(rec).not.toBeNull();
    expect(rec!.members[0]!.member.id).toBe("u1");
    expect(rec!.members[0]!.recovery.state).toBe("in_grace");
    expect(rec!.members[0]!.recovery.stepsSent).toBe(2);
    expect(rec!.automationEnabled).toBe(false);
  });
});

describe("memberships.tsx — census-38 structure (source pins)", () => {
  it("wires the normalizers at every fetch boundary — the raw casts are gone", () => {
    expect(pageSource).toContain("normalizeTiers(tR.value.data.tiers)");
    expect(pageSource).toContain("normalizeDashboard(dR.value.data)");
    expect(pageSource).toContain("normalizeMembers(mR.value.data.members)");
    expect(pageSource).toContain("normalizeMine(data)");
    expect(pageSource).toContain("normalizeRecovery(data)");
    expect(pageSource).not.toContain("as Tier[]");
    expect(pageSource).not.toContain("as Member[]");
    expect(pageSource).not.toContain("data as unknown as Dashboard");
    expect(pageSource).not.toContain("data as unknown as {");
  });

  it.each([
    "memberships-fan-club",
    "memberships-mine",
    "memberships-dashboard",
    "memberships-recovery",
    "memberships-tier-builder",
    "memberships-suggester",
    "memberships-members",
  ])("wraps section %s in its own boundary", (slug) => {
    expect(pageSource).toContain(`<SectionBoundary name="${slug}">`);
  });

  it("carries exactly 7 boundary usages", () => {
    expect(pageSource.match(/<SectionBoundary name="memberships-/g) ?? []).toHaveLength(7);
  });
});
