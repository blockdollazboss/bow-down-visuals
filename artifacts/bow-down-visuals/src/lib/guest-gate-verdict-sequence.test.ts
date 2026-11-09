/**
 * guest-gate-verdict-sequence.test.ts — C-14 (Stack 400) verdict-sequence
 * pin for the transient /tools/* 404.
 *
 * The Nov 8 failure: a signed-in member opening a /tools page during a
 * slow cold load (the 45–90 s staging wake) could land on "Page Not
 * Found" for a page that exists. Mechanism (census-hardening §B): the
 * gate's verdict re-judged from `loading` on EVERY auth-state flip, so
 * the routed tree was assembled across flips and a render pass evaluated
 * mid-flip fell through to the router's catch-all 404; nothing retried
 * it. The fix is two halves, both pinned here:
 *
 *  (a) the gate fold — GuestGate renders resolveGateVerdict's fresh
 *      verdict folded through holdGateVerdict's memory, so once a
 *      location's verdict has SETTLED, an auth re-resolution holds it
 *      instead of dropping the tree back to the loader. This test
 *      replays the exact fold GuestGate.tsx performs (same functions,
 *      same order) across the cold-load flip sequence at a /tools path
 *      and asserts the rendered verdict is the tool page (children)
 *      from the moment the session first settles — never loading
 *      again, never a state that unmounts the tree into the catch-all.
 *
 *  (b) the catch-all re-check — App.tsx's NotFound wrapper consults
 *      isRegisteredRoutePath before painting the 404: registered paths
 *      (the /tools literals included) get the transient loader; only a
 *      genuinely unknown path gets the honest 404. The helper's
 *      verdicts are pinned directly, and App.tsx's wiring is pinned by
 *      source, the house pattern (node-env suite, no DOM harness).
 *
 * A config-only assertion would not have caught the original bug; this
 * drives the real shipped functions through the real flip sequence.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  holdGateVerdict,
  isRegisteredRoutePath,
  resolveGateVerdict,
  INITIAL_HELD_GATE_STATE,
  type GateSession,
  type GateVerdict,
  type HeldGateState,
} from "./guest-gate-verdict";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const gateSource = read("../components/GuestGate.tsx");
const appSource = read("../App.tsx");

const LOADING: GateSession = { user: null, loading: true };
const SIGNED_IN: GateSession = { user: { id: "member-1" }, loading: false };
const SIGNED_OUT: GateSession = { user: null, loading: false };

/**
 * The exact fold GuestGate.tsx renders: fresh verdict for the current
 * session, folded through the held memory. Returns the verdict the
 * component would render for this step, threading the state the way
 * the component's useState does.
 */
function foldStep(
  state: HeldGateState,
  location: string,
  session: GateSession,
  search = "",
): { state: HeldGateState; rendered: GateVerdict } {
  const fresh = resolveGateVerdict(location, search, session);
  const folded = holdGateVerdict(state, location, fresh);
  return { state: folded.state, rendered: folded.verdict };
}

function replay(
  location: string,
  sessions: GateSession[],
): GateVerdict[] {
  let state: HeldGateState = INITIAL_HELD_GATE_STATE;
  return sessions.map((session) => {
    const step = foldStep(state, location, session);
    state = step.state;
    return step.rendered;
  });
}

const kinds = (verdicts: GateVerdict[]) => verdicts.map((v) => v.kind);

describe("C-14 verdict sequence — signed-in member cold-loading a /tools page", () => {
  const TOOL = "/tools/ai-song-maker";

  it("renders the loader only until the session first settles, then the page — through every later flip", () => {
    // The staging-wake sequence: resolving, still resolving, settled
    // signed-in, a token-refresh re-resolution flip, settled again.
    const rendered = replay(TOOL, [LOADING, LOADING, SIGNED_IN, LOADING, SIGNED_IN]);
    expect(kinds(rendered)).toEqual([
      "loading",
      "loading",
      "children",
      "children", // ← the fix: pre-C-14 this step re-judged to "loading"
      "children",
    ]);
  });

  it("never renders a verdict that drops the mounted tree after settle", () => {
    const rendered = replay(TOOL, [SIGNED_IN, LOADING, LOADING, SIGNED_IN, LOADING]);
    const settledAt = rendered.findIndex((v) => v.kind === "children");
    expect(settledAt).toBe(0);
    for (const v of rendered.slice(settledAt)) {
      expect(v.kind).toBe("children");
    }
  });

  it("the gate component wires the fold this sequence drives (source pin)", () => {
    expect(gateSource).toContain("holdGateVerdict(held, location, fresh)");
  });
});

describe("C-14 verdict sequence — guest bounced from a locked /tools page", () => {
  const TOOL = "/tools/ai-thumbnail-maker";

  it("settles on the login bounce and holds it through re-resolution flips", () => {
    const rendered = replay(TOOL, [LOADING, SIGNED_OUT, LOADING, SIGNED_OUT]);
    expect(kinds(rendered)).toEqual(["loading", "redirect", "redirect", "redirect"]);
    const targets = rendered
      .filter((v) => v.kind === "redirect")
      .map((v) => (v.kind === "redirect" ? v.to : ""));
    // Every held redirect is the SAME bounce — built once from the
    // location the visitor was headed to, never re-derived mid-flip.
    expect(new Set(targets).size).toBe(1);
    expect(targets[0]).toBe(
      `/login?next=${encodeURIComponent(TOOL)}`,
    );
  });
});

describe("C-14 verdict sequence — the hold is per-location", () => {
  it("a settled verdict never leaks across a navigation", () => {
    let state: HeldGateState = INITIAL_HELD_GATE_STATE;
    const atTools = foldStep(state, "/tools/ai-song-maker", SIGNED_IN);
    state = atTools.state;
    expect(atTools.rendered.kind).toBe("children");
    // Navigate elsewhere while the session re-resolves: nothing has
    // settled at the new location, so the loader is honest there.
    const atDashboard = foldStep(state, "/dashboard", LOADING);
    expect(atDashboard.rendered.kind).toBe("loading");
    const settled = foldStep(atDashboard.state, "/dashboard", SIGNED_IN);
    expect(settled.rendered.kind).toBe("children");
  });

  it("an alias verdict settles and holds like any other", () => {
    // /challenge is a matrix redirect alias (→ /contests) judged for
    // EVERY session, above the auth branch.
    const rendered = replay("/challenge", [LOADING, SIGNED_IN, LOADING]);
    expect(kinds(rendered)).toEqual(["loading", "redirect", "redirect"]);
    const redirect = rendered[1];
    expect(redirect.kind === "redirect" && redirect.to).toBe("/contests");
  });
});

describe("C-14 catch-all re-check — isRegisteredRoutePath", () => {
  it("registers the /tools literals the transient 404 hit", () => {
    for (const p of [
      "/tools",
      "/tools/ai-thumbnail-maker",
      "/tools/ai-hook-generator",
      "/tools/ai-music-video-maker",
      "/tools/ai-caption-generator",
      "/tools/ai-clip-maker",
      "/tools/ai-song-maker",
    ]) {
      expect(isRegisteredRoutePath(p), p).toBe(true);
    }
  });

  it("registers parameterized routes by shape, with the gate's tolerances", () => {
    for (const p of [
      "/",
      "/artist/thy-cheat-code",
      "/challenge/summer-jam/winners",
      "/storefront/product/abc123",
      "/tools/ai-song-maker/", // one trailing slash tolerated
      "/tools/ai-song-maker?from=nav", // query ignored
    ]) {
      expect(isRegisteredRoutePath(p), p).toBe(true);
    }
  });

  it("keeps the honest 404 for genuinely unknown or malformed paths", () => {
    for (const p of [
      "/definitely-not-a-page",
      "/tools/not-a-real-tool",
      "/artist/", // empty :param segment
      "/a//b", // empty middle segment
      "//evil.example", // protocol-relative
      "tools/ai-song-maker", // no leading slash
      "",
      "*", // the catch-all's own matrix entry names the 404, not a page
    ]) {
      expect(isRegisteredRoutePath(p), JSON.stringify(p)).toBe(false);
    }
  });

  it("App.tsx's catch-all consults the re-check before painting the 404 (source pin)", () => {
    expect(appSource).toContain("function NotFound()");
    expect(appSource).toContain("isRegisteredRoutePath(location)");
    expect(appSource).toContain("<Route component={NotFound} />");
    expect(appSource).toContain("return <NotFoundPage />;");
  });
});
