/**
 * parity-rewalk.test.ts — Stack-100 #2 items 68–80: facet D's
 * parity re-walk claims, verified against the CURRENT tree.
 *
 * Facet D was written against an earlier build of the world; most
 * of its station-honesty claims describe surfaces that have since
 * been rebuilt natively (the Hook Desk, the scheduler desk, the
 * tutorial strip). Each test below pins the CURRENT shipped
 * behaviour with the evidence that closes the claim — so if the
 * defect ever returns, the pin breaks and says which item it was.
 * The two claims that were still real (71 receipt, 79 stream key)
 * are fixed and pinned in scheduler-desk.test.ts / live-desk.test.ts;
 * item 97's channel is pinned in panel-payload.test.ts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import {
  dailyDropStationForKind,
  normalizeDailyDropCatalog,
  type DailyDropKind,
} from "./daily-drop-catalog";
import { PALACE_STATIONS, STATION_BY_ID } from "./stations";
import { SCHEDULER_BEST_TIME_COST_VISUAL_BUCS } from "./scheduler-desk";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const hookDeskSrc = read("../../components/world/native/HookDesk.tsx");
const songTabsSrc = read("../../components/world/native/SongDeskTabs.tsx");
const schedulerDeskSrc = read("../../components/world/native/SchedulerDesk.tsx");
const schedulerLibSrc = read("./scheduler-desk.ts");
const worldSrc = read("../../pages/world.tsx");
const panelSrc = read("../../components/world/StationPanel.tsx");
const postAssistSrc = read("../../components/world/native/PostAssist.tsx");
const businessSrc = read("../../components/world/native/BusinessDesks.tsx");
const sharedSrc = read("../../components/world/native/CreateDeskShared.tsx");
const ateliersSrc = read("./ateliers.ts");

describe("item 68 (D-H1) — Hook Desk Preview: STALE, pinned", () => {
  it("the shipped Hook Desk has no Preview button and saves no draft — results render in-panel", () => {
    /* The facet's Preview was the pre-native desk's draft-saver.
       The native desk generates on its rails and renders results
       IN the panel with copy buttons — there is nothing to preview
       elsewhere and no draft is ever written. */
    expect(hookDeskSrc).not.toContain("Preview");
    expect(hookDeskSrc).not.toContain("draft");
    expect(hookDeskSrc).not.toContain("Draft");
    expect(hookDeskSrc).toContain('data-testid="world-hook-desk-result"');
    expect(hookDeskSrc).toContain('data-testid="world-hook-desk-run"');
  });
});

describe("item 69 (D-H2) — Song Desk hum tab: STALE, pinned", () => {
  it("no humAudioUrl exists; the hum ref is state declared before any use", () => {
    /* create-finishers.ts (the facet's cite) no longer exists; the
       hum bench is SongHumBench in SongDeskTabs.tsx, where humRef
       is a useState declared above both the analyze and generate
       paths that read it. */
    expect(songTabsSrc).not.toContain("humAudioUrl");
    const declared = songTabsSrc.indexOf("const [humRef, setHumRef] = useState");
    const firstUse = songTabsSrc.indexOf("humGenerateFields({ humRef");
    expect(declared).toBeGreaterThan(-1);
    expect(firstUse).toBeGreaterThan(declared);
    expect(songTabsSrc).toContain('data-testid="world-song-hum-bench"');
  });
});

describe("items 72 + 73 (D-S2 / D-H5) — scheduler AI gate + pricing badge: STALE, pinned", () => {
  it("the in-world scheduler has no AI toggle, no feature-flag gate copy, and no 'included' badge", () => {
    /* The facet's toggle/badge lived on a surface that no longer
       exists in-world. The desk's only AI surface is the best-time
       ask, which carries no toggle and no gate attribution. */
    expect(schedulerDeskSrc).not.toContain("Write with AI");
    expect(schedulerDeskSrc).not.toContain("included");
    expect(schedulerDeskSrc).not.toContain("entitlement");
    expect(schedulerLibSrc).not.toContain("Write with AI");
    expect(schedulerLibSrc).not.toContain("entitlement");
  });

  it("the best-time price shown is the desk lib's named constant, printed before the ask runs", () => {
    /* Not a dynamic fetch dressed as certainty: the price is the
       rail's own constant (scheduler-desk.ts, mirroring the
       route's charge) interpolated into the copy that stands
       BEFORE the button. */
    expect(SCHEDULER_BEST_TIME_COST_VISUAL_BUCS).toBe(100);
    expect(schedulerDeskSrc).toContain(
      "Ask for the best times — {SCHEDULER_BEST_TIME_COST_VISUAL_BUCS} Visual Bucs, refunded if the AI fails.",
    );
    expect(schedulerDeskSrc).toContain('data-testid="world-scheduler-best-time-ask"');
  });
});

describe("item 74 (D-H6) — Daily Drop music kinds: STALE, pinned", () => {
  it("the server slate's kind union is exactly the client's four kinds — no sample-pack/preset/wallpaper kinds exist to strand", () => {
    const serverSrc = readFileSync(
      new URL("../../../../api-server/src/routes/retention-drops.ts", import.meta.url),
      "utf8",
    );
    const union = serverSrc.match(/export type DailyDropKind = ([^;]+);/);
    expect(union).not.toBeNull();
    const serverKinds = [...union![1].matchAll(/"([a-z-]+)"/g)].map((m) => m[1]).sort();
    expect(serverKinds).toEqual(["caption", "hook", "thumbnail", "video"]);
  });

  it("every kind routes to a real station, and an unknown kind fails the whole catalogue closed", () => {
    const kinds: DailyDropKind[] = ["thumbnail", "caption", "video", "hook"];
    for (const kind of kinds) {
      const stationId = dailyDropStationForKind(kind);
      expect(stationId).not.toBeNull();
      expect(STATION_BY_ID.has(stationId!)).toBe(true);
    }
    /* A future server kind the client doesn't know must not render
       as a partial slate — normalize refuses the catalogue. */
    expect(
      normalizeDailyDropCatalog({
        enabled: true,
        date: "2026-10-23",
        drops: [{ key: "x", kind: "sample-pack", href: "/packs", isToday: false, archived: false }],
      }),
    ).toBeNull();
  });
});

describe("item 75 (D-H7) — Atelier roster copy: STALE, pinned", () => {
  it("no 'today's bench' copy and no rosterFor rotation exist; the Ateliers Slate is the Kingdom Board", () => {
    expect(ateliersSrc).not.toContain("today's bench");
    expect(ateliersSrc).not.toContain("rosterFor");
    expect(read("./stations.ts")).not.toContain("rosterFor");
    const slate = STATION_BY_ID.get("ateliers-slate");
    expect(slate?.panel).toEqual({ kind: "custom", id: "kingdom-board" });
  });
});

describe("item 76 (D-H8) — one My-Studio truth: STALE, pinned", () => {
  it("exactly one my-studio station, rendered once, and no getStatus anywhere in the world lib", () => {
    expect(PALACE_STATIONS.filter((s) => s.id === "my-studio")).toHaveLength(1);
    expect(panelSrc.match(/<StudioBoard/g)).toHaveLength(1);
    const libFiles = readdirSync(new URL(".", import.meta.url)).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
    );
    for (const f of libFiles) {
      expect(read(`./${f}`), f).not.toContain("getStatus");
    }
  });
});

describe("item 77 (D-X1) — tutorial follows the walker: STALE, pinned", () => {
  it("world.tsx refreshes the tutorial on room change and on station-panel close", () => {
    /* There is no WorldTutorialOverlay anymore; the strip + guidance
       line read tutorialStatus, which the page re-reads at exactly
       the moments a step can land: entering, changing rooms
       (roomId dep), and closing a station panel. */
    expect(worldSrc).toContain("}, [status, roomId, refreshTutorial]);");
    expect(worldSrc).toContain("A station visit is where tutorial steps land");
    expect(worldSrc).not.toContain("WorldTutorialOverlay");
  });
});

describe("item 78 (D-X2) — no side-effects in render: STALE, pinned", () => {
  it("world.tsx's only setTimeout calls live inside TimerRef callbacks, never in render", () => {
    const lines = worldSrc.split("\n").filter((l) => l.includes("setTimeout("));
    /* The useRef declarations mention setTimeout in their TYPE
       (ReturnType<typeof setTimeout>) — the CALLS are what this
       pin counts. Three since 2026-10-25: the original two, plus
       the interact note's retire timer — armed only inside the
       interact resolver (a TimerRef press callback), never in
       render, so the invariant this pin guards still holds. */
    const calls = lines.filter((l) => l.includes("= setTimeout("));
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call).toMatch(/TimerRef\.current = setTimeout\(/);
    }
    expect(worldSrc).not.toContain("JOIN_VOICE");
    /* The voice-blocked note is plain rendered state, set from the
       socket callback — no timer in its path. */
    expect(worldSrc).toContain("{voiceNote && <span");
  });
});

describe("item 80 (D-H4) — Post Assist names its place: STALE, pinned", () => {
  it("the block's copy names the in-world composer it drafts into — never the 2D page", () => {
    expect(postAssistSrc).not.toContain("Post Assist page");
    expect(postAssistSrc).not.toContain("on the website");
    expect(postAssistSrc).toContain("Drafted into your composer below");
    expect(postAssistSrc).toContain("The draft lands in your composer");
    /* In the Promote Room the draft hands to the in-world Scheduler
       in the SAME desk stack — the flow finishes where it stands. */
    expect(businessSrc).toContain('title="Post Assist — Write It For Me"');
    expect(businessSrc).toContain("<SchedulerDeskSection");
    expect(businessSrc).toContain('data-testid="world-promote-assist-schedule"');
  });
});

describe("item 97 sub-claims (D-97c wallpaper / D-97d schedule-it): STALE halves, pinned", () => {
  it("D-97d: 'Schedule it' already keeps its payload — the standalone composer opens inline with a SchedulerPrefill", () => {
    /* No hardcoded editor URL: CreateDeskShared renders
       SchedulerComposeStandalone with the desk's schedulePrefill
       (create-desks.ts schedulePrefillForMedia builds the typed
       SchedulerPrefill; create-desks.test.ts pins its shape). */
    expect(sharedSrc).toContain("<SchedulerComposeStandalone");
    expect(sharedSrc).toContain("prefill={props.schedulePrefill}");
    expect(sharedSrc).not.toContain("/video-editor");
  });

  it("D-97c: no wallpaper handoff exists in the world — no surface navigates out for one", () => {
    expect(read("./daily-drop-catalog.ts").toLowerCase()).not.toContain("wallpaper");
    expect(read("../../components/world/native/DailyDropCatalog.tsx").toLowerCase()).not.toContain("wallpaper");
  });
});
