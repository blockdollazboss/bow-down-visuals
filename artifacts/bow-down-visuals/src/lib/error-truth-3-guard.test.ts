/**
 * error-truth-3-guard.test.ts — the empty-lie guard, round 2 (stack1200).
 *
 * Round 1 (stack1000 Lane Q1, error-truth-2-guard) separated failure from
 * empty on 24 surfaces. This round censused every FE data surface built
 * or changed since — the stack1100 World desks, the X1 admin benches,
 * charts, groups/forum — for copycat drift back into the conflated shape:
 * a fetch failure rendering the same UI as a genuine zero-result, or a
 * failure state that exists but offers no working Retry (the house
 * pattern is failure sentence + a Retry that re-runs the load).
 *
 * Most stack1100 surfaces were acquitted at source (the NativeStates
 * tri-state, the benches' loadError + retryNonce, charts' LoadErrorBox).
 * Four surfaces are pinned here:
 *  - GroupOnboarding: the true conflation — its load swallowed failure
 *    behind a comment claiming the parent page covers it, then printed
 *    "This group takes direct joins" as fact on a failed questions load.
 *  - JewelryOrdersAdmin, PlainWordsDeals, PurchasesPanel: failure and
 *    empty were separated, but the failure branch carried no Retry —
 *    the only way back was a full page reload.
 *
 * Same harness constraint as round 1 (vitest node environment, no DOM):
 * the pins assert the source shapes that produce the two different
 * renders and the working retry wiring.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

describe("GroupOnboarding — a failed join-questions load is not 'direct joins'", () => {
  const src = read("components/trust/GroupOnboarding.tsx");

  it("sets its own failure state on the load's failure path", () => {
    expect(src).toMatch(/setLoadError\(true\)/);
  });

  it("no longer hides behind the parent page's error handling", () => {
    expect(src).not.toMatch(/the group page itself already surfaces load errors/);
  });

  it("renders a failure branch with a Retry wired to the real loader", () => {
    expect(src).toMatch(/loadError && \(/);
    expect(src).toMatch(/onClick=\{\(\) => void load\(\)\}/);
  });

  it("orders the failure branch before the 'direct joins' empty claim", () => {
    const errAt = src.search(/loadError && \(/);
    const emptyAt = src.indexOf("This group takes direct joins");
    expect(errAt).toBeGreaterThan(-1);
    expect(emptyAt).toBeGreaterThan(errAt);
  });

  it("gates the 'direct joins' claim on a completed load", () => {
    expect(src).toMatch(/loaded && !loadError && !myRole && user && questions\.length === 0/);
  });

  it("gates the 'Nobody is waiting' claim on a completed load", () => {
    expect(src).toMatch(/loaded && requests\.length === 0/);
  });
});

describe("JewelryOrdersAdmin — the failure branch carries a working Retry", () => {
  const src = read("components/JewelryOrdersAdmin.tsx");

  it("wires a Retry to the named loader inside the error branch", () => {
    const errAt = src.indexOf("error ? (");
    const retryAt = src.indexOf("onClick={() => void load()}", errAt);
    const emptyAt = src.indexOf("orders.length === 0", errAt);
    expect(errAt).toBeGreaterThan(-1);
    expect(retryAt).toBeGreaterThan(errAt);
    expect(emptyAt).toBeGreaterThan(retryAt);
  });
});

describe("PlainWordsDeals — the failure branch carries a working Retry", () => {
  const src = read("components/contracts/PlainWordsDeals.tsx");

  it("wires a Retry to the loader inside the loadError branch, before the empty branch", () => {
    const errAt = src.indexOf("loadError ? (");
    const retryAt = src.indexOf("onClick={() => void load()}", errAt);
    const emptyAt = src.indexOf("deals.length === 0", errAt);
    expect(errAt).toBeGreaterThan(-1);
    expect(retryAt).toBeGreaterThan(errAt);
    expect(emptyAt).toBeGreaterThan(retryAt);
  });
});

describe("KingdomBoardBlocks — a failed palace-events load is not an empty slate", () => {
  const src = read("components/world/native/KingdomBoardBlocks.tsx");
  const todayAt = src.indexOf('data-testid="world-kingdom-today"');
  const calendarAt = src.indexOf("Palace calendar (3.9)", todayAt);
  const todayBlock = src.slice(todayAt, calendarAt);

  it("records the REST leg's failure in its own state, cleared on success", () => {
    expect(src).toMatch(/const \[restFailed, setRestFailed\] = useState\(false\)/);
    expect(src).toMatch(/setRestFailed\(true\)/);
    expect(src).toMatch(/setRestFailed\(false\)/);
    expect(src).not.toMatch(/The directory slate still speaks\./);
  });

  it("(1) REST failure + empty merged slate renders the failure state, not the empty claim", () => {
    const errAt = todayBlock.indexOf("today.length === 0 && restFailed");
    const emptyAt = todayBlock.indexOf("Nothing on today's slate at the palace.");
    expect(todayAt).toBeGreaterThan(-1);
    expect(errAt).toBeGreaterThan(-1);
    expect(todayBlock).toContain("NativeErrorState");
    expect(emptyAt).toBeGreaterThan(errAt);
  });

  it("(2) the empty claim is gated behind the failure branch, so it renders only on a completed REST load", () => {
    const errAt = todayBlock.indexOf("today.length === 0 && restFailed");
    const emptyGateAt = todayBlock.indexOf("today.length === 0 && !kingLine");
    expect(errAt).toBeGreaterThan(-1);
    expect(emptyGateAt).toBeGreaterThan(errAt);
  });

  it("(3) REST failure + directory events still renders the events — error and empty both require an empty slate", () => {
    expect(src).toMatch(/mergeSlates\(restEvents, directorySlate\(directory\)\)/);
    expect(todayBlock).toContain("today.map((e)");
    expect(todayBlock).not.toMatch(/\{restFailed \? \(/);
  });

  it("(4) the failure state's Retry re-runs the loads via the tick the REST effect depends on", () => {
    const errAt = todayBlock.indexOf("NativeErrorState");
    const retryAt = todayBlock.indexOf("setTick((n) => n + 1)", errAt);
    expect(errAt).toBeGreaterThan(-1);
    expect(retryAt).toBeGreaterThan(errAt);
    expect(todayBlock.slice(errAt, retryAt)).toContain("setRestFailed(false)");
    expect(src).toMatch(/\}, \[tick\]\);/);
  });
});

describe("PurchasesPanel — the failure branch carries a working Retry", () => {
  const src = read("components/library/PurchasesPanel.tsx");

  it("extracts the load so it can be re-run (retry nonce in the effect deps)", () => {
    expect(src).toMatch(/const \[retryNonce, setRetryNonce\] = useState\(0\)/);
    expect(src).toMatch(/\}, \[user, getAccessToken, retryNonce\]\);/);
  });

  it("renders a Retry in the error branch that bumps the nonce", () => {
    const errAt = src.indexOf("if (error) {");
    const retryAt = src.indexOf("setRetryNonce((n) => n + 1)", errAt);
    const emptyAt = src.indexOf("purchases.length === 0", errAt);
    expect(errAt).toBeGreaterThan(-1);
    expect(retryAt).toBeGreaterThan(errAt);
    expect(emptyAt).toBeGreaterThan(retryAt);
  });
});
