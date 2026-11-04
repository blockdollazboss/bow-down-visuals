/**
 * move-home-desk — stack1500 world parity wave #4b item 31 pins.
 *
 * The Move Home desk is the guided five-step setup's native form.
 * These pins hold: the status guard reads the rail's exact
 * MoveHomeStatus shape (server titles/blurbs/blockers ride
 * through untouched; drifted steps drop; a non-state body is
 * failure, never an empty flow); the registry pin proves the
 * draft rail is registered FREE through the throw-on-unregistered
 * helper; the answers payload mirrors the answers schema's
 * bounds; the step paths and the locale rider match the routes.
 */
import { describe, expect, it } from "vitest";
import { getCreditCost } from "@/lib/credit-costs";
import {
  MOVE_HOME_ALL_SETTLED_COPY,
  MOVE_HOME_APPROVE_COPY,
  MOVE_HOME_BLOCKER_COPY,
  MOVE_HOME_DRAFT_ENDPOINT,
  MOVE_HOME_STEPS,
  buildMoveHomeAnswersPayload,
  moveHomeAllSettled,
  moveHomeAnswersDraftOf,
  moveHomeAnswersReady,
  moveHomeDraftCost,
  moveHomeDraftOf,
  moveHomeDraftPath,
  moveHomeStatusOfResponse,
  moveHomeStepPath,
  withLocale,
} from "./move-home-desk";

const STATUS_BODY = {
  moveHome: {
    answers: { displayName: "Thy Cheat Code", vertical: "music", genre: "Hip-hop" },
    drafts: {
      profile: { displayName: "Thy Cheat Code", vertical: "music", bio: "The King.", slug: "thy-cheat-code", socialLinks: {} },
      store: null,
      press_kit: null,
      email_list: null,
      launch_posts: null,
      copySource: "assembled",
    },
    steps: [
      { key: "profile", title: "Your profile", blurb: "Name, bio and links.", status: "drafted" },
      { key: "store", title: "Starter shop", blurb: "Your first products.", status: "pending", blockedReason: "needs_profile" },
      { key: "press_kit", title: "Press kit", blurb: "For bookers.", status: "pending" },
      { key: "email_list", title: "Email list", blurb: "Your list.", status: "approved", appliedRef: "list-1" },
      { key: "launch_posts", title: "Launch posts", blurb: "Announce it.", status: "pending", blockedReason: "no_connected_accounts" },
      { key: "bogus", title: "Drift", blurb: "", status: "drafted" },
    ],
    completedAt: null,
    context: {
      hasProfile: false,
      profileSlug: null,
      connectedPlatforms: [],
      trackCount: 2,
      videoCount: 1,
    },
  },
};

describe("the status guard — the rail's MoveHomeStatus shape", () => {
  it("reads steps with the server's own titles, blurbs, statuses and blockers", () => {
    const view = moveHomeStatusOfResponse(STATUS_BODY)!;
    expect(view.steps.map((s) => s.key)).toEqual(["profile", "store", "press_kit", "email_list", "launch_posts"]);
    expect(view.steps[0]).toMatchObject({ title: "Your profile", status: "drafted" });
    expect(view.steps[1]!.blockedReason).toBe("needs_profile");
    expect(view.steps[3]).toMatchObject({ status: "approved", appliedRef: "list-1" });
    expect(view.steps[4]!.blockedReason).toBe("no_connected_accounts");
    expect(view.context).toMatchObject({ trackCount: 2, videoCount: 1, hasProfile: false });
    expect(view.copySource).toBe("assembled");
    expect(view.answers.displayName).toBe("Thy Cheat Code");
  });

  it("a non-state body is failure, never an empty flow", () => {
    expect(moveHomeStatusOfResponse({})).toBeNull();
    expect(moveHomeStatusOfResponse(null)).toBeNull();
    expect(moveHomeStatusOfResponse({ moveHome: { steps: "all" } })).toBeNull();
    expect(moveHomeStatusOfResponse({ moveHome: { steps: [], context: {} } })).toBeNull();
  });

  it("draft lookup returns the step's object or null", () => {
    const view = moveHomeStatusOfResponse(STATUS_BODY)!;
    expect(moveHomeDraftOf(view, "profile")).toMatchObject({ slug: "thy-cheat-code" });
    expect(moveHomeDraftOf(view, "store")).toBeNull();
  });

  it("all-settled mirrors the rail's done state", () => {
    const view = moveHomeStatusOfResponse(STATUS_BODY)!;
    expect(moveHomeAllSettled(view)).toBe(false);
    const done = moveHomeStatusOfResponse({
      moveHome: {
        ...STATUS_BODY.moveHome,
        steps: STATUS_BODY.moveHome.steps
          .filter((s) => s.key !== "bogus")
          .map((s) => ({ ...s, status: s.key === "store" ? "skipped" : "approved", blockedReason: undefined })),
      },
    })!;
    expect(moveHomeAllSettled(done)).toBe(true);
    expect(MOVE_HOME_ALL_SETTLED_COPY).toContain("complete");
  });
});

describe("the free pin — the registry's own row", () => {
  it("the draft endpoint is registered and costs 0", () => {
    expect(MOVE_HOME_DRAFT_ENDPOINT).toBe("/api/move-home/draft");
    expect(getCreditCost(MOVE_HOME_DRAFT_ENDPOINT)?.cost).toBe(0);
    expect(moveHomeDraftCost()).toBe(0);
  });
});

describe("paths + the locale rider", () => {
  it("step paths match the routes", () => {
    expect(moveHomeDraftPath("press_kit")).toBe("/api/move-home/drafts/press_kit");
    expect(moveHomeStepPath("store", "approve")).toBe("/api/move-home/steps/store/approve");
    expect(moveHomeStepPath("store", "skip")).toBe("/api/move-home/steps/store/skip");
    expect(moveHomeStepPath("store", "reopen")).toBe("/api/move-home/steps/store/reopen");
  });

  it("the locale rides as a query param, like the page sends it", () => {
    expect(withLocale("/api/move-home", "es")).toBe("/api/move-home?locale=es");
    expect(withLocale("/api/move-home", undefined)).toBe("/api/move-home");
  });
});

describe("the answers payload — the schema's bounds", () => {
  it("trims, caps, drops blanks, and keeps a valid vertical", () => {
    const payload = buildMoveHomeAnswersPayload({
      displayName: "  Thy  ",
      vertical: "music",
      genre: "",
      bioSeed: "x".repeat(700),
      tagline: " The Code ",
      location: "",
      handle: "thy",
      starterProductTitle: "",
    });
    expect(payload.displayName).toBe("Thy");
    expect(payload.vertical).toBe("music");
    expect(payload.genre).toBeUndefined();
    expect(payload.bioSeed).toHaveLength(600);
    expect(payload.tagline).toBe("The Code");
    expect(payload.handle).toBe("thy");
  });

  it("an unknown vertical never rides", () => {
    const payload = buildMoveHomeAnswersPayload({
      displayName: "Thy", vertical: "wizard", genre: "", bioSeed: "", tagline: "", location: "", handle: "", starterProductTitle: "",
    });
    expect(payload.vertical).toBeUndefined();
  });

  it("readiness needs a name and a real vertical; the form seeds from saved answers", () => {
    const draft = moveHomeAnswersDraftOf({ displayName: "Thy", vertical: "video" });
    expect(draft).toMatchObject({ displayName: "Thy", vertical: "video", genre: "" });
    expect(moveHomeAnswersReady(draft)).toBe(true);
    expect(moveHomeAnswersReady({ ...draft, displayName: " " })).toBe(false);
    expect(moveHomeAnswersDraftOf({}).vertical).toBe("music");
  });
});

describe("the desk's own copy — blockers and approve honesty", () => {
  it("every step has an approve line and every blocker a plain-words line", () => {
    for (const step of MOVE_HOME_STEPS) {
      expect(MOVE_HOME_APPROVE_COPY[step].length).toBeGreaterThan(10);
    }
    expect(Object.keys(MOVE_HOME_BLOCKER_COPY).sort()).toEqual(
      ["needs_media", "needs_profile", "no_connected_accounts"],
    );
    expect(MOVE_HOME_APPROVE_COPY.store).toContain("nothing is for sale");
    expect(MOVE_HOME_APPROVE_COPY.launch_posts).toContain("queues");
  });
});
