/**
 * move-home-desk-components — stack1500 world parity wave #4b
 * item 31 source-contract pins. The Move Home desk must sit in
 * the My Studio stack in StationPanel (a lazy DeskDoor beside
 * the Academy desk) with:
 * - the answers form + the free draft run on the seam's rails;
 * - the rail's own step titles/blurbs/blockers rendered as-is;
 * - per-step editors on each step's PATCH rail and the
 *   approve / skip / reopen verbs on theirs;
 * - NO confirmed-spend seam (the whole flow is free — the seam
 *   pins the registry's cost-0 row instead);
 * - members-only honesty for guests.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("../../components/world/native/MoveHomeDesk.tsx");
const panel = read("../../components/world/StationPanel.tsx");
const routes = read("../../../../api-server/src/routes/move-home.ts");

describe("the My Studio mount", () => {
  it("is a lazy DeskDoor in the my-studio stack", () => {
    expect(panel).toContain('const MoveHomeDesk = lazy(() => import("@/components/world/native/MoveHomeDesk")');
    expect(panel).toContain("<MoveHomeDesk isLight={isLight} isGuest={isGuest} />");
    expect(desk).toContain("export function MoveHomeDesk({ isLight, isGuest }: { isLight: boolean; isGuest: boolean })");
    expect(desk).toContain('data-testid="world-move-home-desk"');
  });
});

describe("the flow — answers, draft run, steps", () => {
  it("loads status with the locale rider and saves answers on the PUT rail", () => {
    expect(desk).toContain("withLocale(MOVE_HOME_PATH, locale)");
    expect(desk).toContain("moveHomeStatusOfResponse");
    expect(desk).toContain('method: "PUT"');
    expect(desk).toContain("buildMoveHomeAnswersPayload(answers)");
    expect(desk).toContain('data-testid="world-move-home-answers"');
  });

  it("the draft run posts the draft rail and is presented as free", () => {
    expect(desk).toContain('post("/api/move-home/draft")');
    expect(desk).toContain("moveHomeDraftCost()");
    expect(desk).toContain('t("worldRemainder.mvhBuildDrafts")');
  });

  it("renders the rail's own step titles, blurbs and blockers — never invented ones", () => {
    expect(desk).toContain("{step.title}");
    expect(desk).toContain("{step.blurb}");
    expect(desk).toContain("t(BLOCKER_KEY[step.blockedReason]!)");
    expect(desk).toContain("t(APPROVE_KEY[step.key]!)");
  });

  it("a blocked step gets no approve button path — verbs render only for drafted/settled steps", () => {
    expect(desk).toContain('step.status === "drafted" && draft');
    expect(desk).toContain('step.status === "approved" || step.status === "skipped"');
    expect(desk).toContain("moveHomeStepPath(step.key, verb)");
  });
});

describe("the editors — one per step, on the PATCH rail", () => {
  it("all five editors exist and save through the drafts rail", () => {
    for (const name of ["ProfileEditor", "StoreEditor", "PressKitEditor", "EmailListEditor", "LaunchPostsEditor"]) {
      expect(desk).toContain(`function ${name}`);
    }
    expect(desk).toContain('method: "PATCH"');
    expect(desk).toContain("moveHomeDraftPath(step)");
    expect(desk).toContain('data-testid="world-move-home-editor"');
  });

  it("the store editor speaks honestly: drafts, not live products", () => {
    expect(desk).toContain('t("worldRemainder.mvhStoreDraftsNote")');
  });

  it("the routes carry exactly the verbs the desk calls", () => {
    expect(routes).toContain('"/move-home/draft"');
    expect(routes).toContain('"/move-home/drafts/:step"');
    expect(routes).toContain('"/move-home/steps/:step/approve"');
    expect(routes).toContain('"/move-home/steps/:step/skip"');
    expect(routes).toContain('"/move-home/steps/:step/reopen"');
    expect(routes).toContain('"/move-home/answers"');
  });
});

describe("free + honest states", () => {
  it("no confirmed-spend seam anywhere in the desk", () => {
    expect(desk).not.toContain("confirmedFetch");
    expect(desk).not.toContain("useConfirmedApi");
  });

  it("guests get the sign-in line; loading/failed/empty render as themselves", () => {
    expect(desk).toContain('t("worldRemainder.mvhGuestBody")');
    expect(desk).toContain("NativeLoadingState");
    expect(desk).toContain("NativeErrorState");
    expect(desk).toContain("NativeEmptyState");
  });
});
