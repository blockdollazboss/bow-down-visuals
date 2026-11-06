/**
 * team-isolation.test.ts — Stack-200 hardening wave, section C
 * (census item 39): per-card render-error isolation on /team.
 *
 * The defect: invites, pool balance, members, group profile,
 * spending and the danger zone stacked as bare sibling Cards — one
 * card's render throw (a malformed member row, a bad pool figure)
 * replaced the whole team workspace, including the controls needed
 * to fix the team.
 *
 * The fix wraps each card in its own SectionBoundary.
 * Idiom follows lane D3: real-class composition + source pins.
 */
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SectionBoundaryCore } from "../components/section-boundary";

const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");
const pageSource = read("./team.tsx");
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

describe("team shape — one bad card never blanks the workspace", () => {
  it("a failed members card degrades alone; pool + danger zone still render; App-level copy absent", () => {
    const pool = makeBoundary(
      "team-pool",
      createElement("p", null, "POOL CARD"),
    );
    const members = makeBoundary(
      "team-members",
      createElement("p", null, "MEMBERS CARD"),
    );
    const danger = makeBoundary(
      "team-danger",
      createElement("p", null, "DANGER ZONE"),
    );
    failWith(members, new Error("member row malformed"));

    const html = [
      renderToStaticMarkup(pool.render() as ReactElement),
      renderToStaticMarkup(members.render() as ReactElement),
      renderToStaticMarkup(danger.render() as ReactElement),
    ].join("\n");

    expect(html).toContain("POOL CARD");
    expect(html).toContain("DANGER ZONE");
    expect(html).toContain('data-testid="section-error-team-members"');
    expect(html).not.toContain("MEMBERS CARD");
    expect(appSource).toContain("The vault guards tripped.");
    expect(html).not.toContain("The vault guards tripped.");
  });
});

describe("team.tsx — census-39 structure (source pins)", () => {
  it("imports the shared SectionBoundary", () => {
    expect(pageSource).toContain(
      'import { SectionBoundary } from "@/components/SectionBoundary";',
    );
  });

  it.each([
    "team-invites",
    "team-create-gate",
    "team-create",
    "team-pool",
    "team-invite",
    "team-members",
    "team-group-profile",
    "team-spending-error",
    "team-spending",
    "team-danger",
  ])("wraps card %s in its own boundary", (slug) => {
    expect(pageSource).toContain(`<SectionBoundary name="${slug}">`);
  });

  it("carries exactly 10 boundary usages", () => {
    expect(pageSource.match(/<SectionBoundary name="team-/g) ?? []).toHaveLength(10);
  });

  it("each card boundary opens immediately before its own Card (no shifted wraps)", () => {
    expect(pageSource).toContain(
      '<SectionBoundary name="team-create-gate"><Card className="p-6 bg-white/[0.03] border-white/10" data-testid="team-create-gate">',
    );
    expect(pageSource).toContain(
      '<SectionBoundary name="team-pool"><Card className="p-6 bg-gradient-to-br from-[#C9A84C]/15 to-transparent border-[#C9A84C]/30">',
    );
    expect(pageSource).toContain(
      '<SectionBoundary name="team-spending-error"><Card className="p-5 bg-white/[0.03] border-white/10" data-testid="team-spending-error">',
    );
  });
});
