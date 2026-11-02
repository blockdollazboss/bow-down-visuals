/**
 * drop-day-checklist.test.ts — Drop Day Kit (#169), H3 delta.
 *
 * Pins the release-day checklist contract:
 * - every step is derived from real state (the release's own fields,
 *   the kit, the presave captures, the Scheduler's release-attributed
 *   posts) — a step is 'done' only when its rail proves it;
 * - the teaser step is NEVER 'done': it renders in Create and the
 *   kit cannot see that render, so a ready spec reads 'action', and
 *   a missing input reads 'todo';
 * - the banner step ticks ONLY on proven renders: banners render at
 *   assembly and the stored payload carries each render's ref, so
 *   'done' requires every banner to carry one — spec-only and
 *   partly rendered sets read 'action' and name the count;
 * - the announcement step reads the Scheduler's buckets honestly —
 *   posted/scheduled = done, a waiting draft = action, and with no
 *   presave page the step is 'todo' (the announcement's link rides
 *   on that page);
 * - the heads-up step follows the kit's own lifecycle: no kit =
 *   todo, draft = action (activate to arm), active = done with the
 *   REAL capture count, landed = done.
 */
import { describe, expect, it } from "vitest";
import {
  assembleChecklist,
  assembleKit,
  type AnnounceState,
  type KitRelease,
} from "../drop-day-kit";

const FULL: KitRelease = {
  id: "rel-1",
  userId: "user-1",
  title: "Midnight Run",
  artistName: "Thy Cheat Code",
  releaseDate: "2026-11-15",
  audioUrl: "https://cdn.example/track.mp3",
  artworkUrl: "https://cdn.example/cover.jpg",
  status: "packaged",
  presaveSlug: "midnight-run",
};

const BARE: KitRelease = {
  ...FULL,
  releaseDate: null,
  audioUrl: null,
  artworkUrl: null,
  presaveSlug: null,
};

const NONE: AnnounceState = { draft: 0, scheduled: 0, posted: 0 };

function step(steps: ReturnType<typeof assembleChecklist>, id: string) {
  const s = steps.find((x) => x.id === id);
  expect(s, `step ${id} exists`).toBeDefined();
  return s!;
}

describe("assembleChecklist — shape", () => {
  it("always returns the eight steps in run-through order", () => {
    const steps = assembleChecklist({ release: FULL, kit: assembleKit(FULL), kitStatus: "active", captures: 3, announce: NONE });
    expect(steps.map((s) => s.id)).toEqual([
      "audio", "artwork", "release_date", "presave_page",
      "teaser", "banners", "announce", "heads_up",
    ]);
  });
});

describe("assembleChecklist — field steps follow the release's own fields", () => {
  it("a complete release: audio, artwork, date, presave all done", () => {
    const steps = assembleChecklist({ release: FULL, kit: null, kitStatus: null, captures: 0, announce: NONE });
    for (const id of ["audio", "artwork", "release_date", "presave_page"]) {
      expect(step(steps, id).state).toBe("done");
    }
  });

  it("a bare release: all four are todo, and each names where it is fixed", () => {
    const steps = assembleChecklist({ release: BARE, kit: null, kitStatus: null, captures: 0, announce: NONE });
    for (const id of ["audio", "artwork", "release_date", "presave_page"]) {
      expect(step(steps, id).state).toBe("todo");
      expect(step(steps, id).detail).toContain("Distribute");
    }
  });
});

describe("assembleChecklist — teaser never ticks; banners tick only on proven renders", () => {
  it("ready specs read 'action', never 'done' — in every kit state", () => {
    for (const kitStatus of [null, "draft", "active", "landed"]) {
      const steps = assembleChecklist({
        release: FULL,
        kit: assembleKit(FULL),
        kitStatus,
        captures: 0,
        announce: NONE,
      });
      expect(step(steps, "teaser").state).toBe("action");
      /* assembleKit's banners are specs (imageRef null) — unproven
         renders read 'action' exactly like the teaser. */
      expect(step(steps, "banners").state).toBe("action");
    }
  });

  it("a fully rendered banner set is 'done' — the stored refs are the proof", () => {
    const kit = assembleKit(FULL);
    const rendered = {
      ...kit,
      banners: kit.banners.map((b) => ({ ...b, imageRef: `r2://generated-clips/drop-day-kits/x/banner-${b.size}.jpg` })),
    };
    const steps = assembleChecklist({ release: FULL, kit: rendered, kitStatus: "draft", captures: 0, announce: NONE });
    expect(step(steps, "banners").state).toBe("done");
    /* The teaser still cannot tick — its render lives in Create. */
    expect(step(steps, "teaser").state).toBe("action");
  });

  it("a partly rendered set stays 'action' and names the count", () => {
    const kit = assembleKit(FULL);
    const partial = {
      ...kit,
      banners: kit.banners.map((b, i) => (i < 2 ? { ...b, imageRef: "r2://generated-clips/x.jpg" } : b)),
    };
    const steps = assembleChecklist({ release: FULL, kit: partial, kitStatus: "draft", captures: 0, announce: NONE });
    const s = step(steps, "banners");
    expect(s.state).toBe("action");
    expect(s.detail).toContain("2 of 4");
  });

  it("missing inputs read 'todo' and name the blocker", () => {
    const steps = assembleChecklist({ release: BARE, kit: null, kitStatus: null, captures: 0, announce: NONE });
    expect(step(steps, "teaser").state).toBe("todo");
    expect(step(steps, "teaser").detail).toContain("track audio");
    expect(step(steps, "banners").state).toBe("todo");
    expect(step(steps, "banners").detail).toContain("cover art");
  });

  it("inputs present but no kit assembled: 'todo' — there is no spec yet to render", () => {
    const steps = assembleChecklist({ release: FULL, kit: null, kitStatus: null, captures: 0, announce: NONE });
    expect(step(steps, "teaser").state).toBe("todo");
    expect(step(steps, "teaser").detail).toContain("Assemble the kit");
    expect(step(steps, "banners").state).toBe("todo");
    expect(step(steps, "banners").detail).toContain("Assemble the kit");
  });
});

describe("assembleChecklist — the announcement reads the Scheduler's buckets", () => {
  const base = { release: FULL, kit: assembleKit(FULL), kitStatus: "active", captures: 0 };

  it("a posted announcement is done", () => {
    const steps = assembleChecklist({ ...base, announce: { draft: 0, scheduled: 0, posted: 1 } });
    expect(step(steps, "announce").state).toBe("done");
  });

  it("a scheduled announcement is done — it fires on its own", () => {
    const steps = assembleChecklist({ ...base, announce: { draft: 0, scheduled: 2, posted: 0 } });
    expect(step(steps, "announce").state).toBe("done");
  });

  it("a waiting draft is the creator's action, not done", () => {
    const steps = assembleChecklist({ ...base, announce: { draft: 1, scheduled: 0, posted: 0 } });
    expect(step(steps, "announce").state).toBe("action");
  });

  it("no posts yet, presave live: action — the composer opens pre-written", () => {
    const steps = assembleChecklist({ ...base, announce: NONE });
    expect(step(steps, "announce").state).toBe("action");
  });

  it("no presave page: todo — the announcement's link rides on that page", () => {
    const steps = assembleChecklist({ ...base, release: { ...FULL, presaveSlug: null }, announce: NONE });
    expect(step(steps, "announce").state).toBe("todo");
    expect(step(steps, "announce").detail).toContain("presave page");
  });
});

describe("assembleChecklist — the heads-up follows the kit's lifecycle", () => {
  const base = { release: FULL, kit: assembleKit(FULL), captures: 0, announce: NONE };

  it("no kit: todo", () => {
    const steps = assembleChecklist({ ...base, kit: null, kitStatus: null });
    expect(step(steps, "heads_up").state).toBe("todo");
  });

  it("draft kit: action — activate to arm", () => {
    const steps = assembleChecklist({ ...base, kitStatus: "draft" });
    expect(step(steps, "heads_up").state).toBe("action");
    expect(step(steps, "heads_up").detail).toContain("Activate the kit");
  });

  it("active kit: done, carrying the real capture count", () => {
    const steps = assembleChecklist({ ...base, kitStatus: "active", captures: 42 });
    const s = step(steps, "heads_up");
    expect(s.state).toBe("done");
    expect(s.detail).toContain("42");
  });

  it("landed kit: done", () => {
    const steps = assembleChecklist({ ...base, kitStatus: "landed" });
    expect(step(steps, "heads_up").state).toBe("done");
  });
});
