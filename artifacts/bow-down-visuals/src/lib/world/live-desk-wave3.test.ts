/**
 * live-desk wave III — parity wave 6, #92 seam + sources.
 *
 * Pins:
 * - #92 "Behind me" is BroadcastStudio's green-screen panel carried
 *   on the SAME kit: the desk constructs a BackgroundChanger with
 *   audio, takes its composited output stream as the camera feed
 *   (camRef — the stream the transport publishes), and drives it
 *   through the kit's own setMode / setQuality / setImage /
 *   setFineTune — never a second keyer or pipeline;
 * - the backdrop choice is backdrop-selection's ONE selection
 *   (built-ins, validated upload, pasted URL), resolved through
 *   backdropSelectionSource at every call site, with the held-pick /
 *   restore-on-failure bookkeeping the page runs;
 * - the fine-tune settings ride the kit's own device store
 *   (bdv-greenscreen-finetune) via load/saveGreenScreenFineTune —
 *   the same store BroadcastStudio reads and writes, so a cutout
 *   tuned on either surface is the cutout both surfaces run;
 * - engine truth is spoken the page's way: the LIVE engine kind,
 *   the fallback note with its real reason, and engine-down only
 *   when a backdrop mode is in play AND the kit carries an error;
 * - law: nothing charges (going live and its effects are free on
 *   the 2D site), the scene kit's chroma key is named a follow-on
 *   (it rides the stage compositor — no second keyer here), and
 *   RTMP's verdict is the deployment's env gate, not a fake door.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  BACKGROUND_MODE_OPTIONS, BACKGROUND_QUALITY_OPTIONS,
  GREENSCREEN_FINE_TUNE_SLIDERS, fineTuneSlidersForMode,
  engineKindLabel, engineFallbackNote, engineDownFromStatus, backdropTileActive,
  LIVE_WAVE3_PROMOTIONS, LIVE_NATIVE_FOLLOW_ONS,
} from "./live-desk";
import {
  loadGreenScreenFineTune, saveGreenScreenFineTune,
  GREENSCREEN_FINETUNE_DEFAULTS, GREENSCREEN_FINETUNE_KEY,
} from "../stream-kit/greenscreen-finetune";
import { isSelectionActive } from "../stream-kit/backdrop-selection";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const deskSrc = read("../../components/world/native/LiveDesk.tsx");
const studioSrc = read("../../components/go-live/BroadcastStudio.tsx");
const rtmpIngestSrc = read("../../../../api-server/src/lib/rtmp-ingest.ts");

describe("#92 the mode + quality menus are BroadcastStudio's own", () => {
  it("pins the mode pills in the page's order with the page's labels", () => {
    expect(BACKGROUND_MODE_OPTIONS.map((o) => o.mode)).toEqual(["green", "blur", "image", "none"]);
    expect(BACKGROUND_MODE_OPTIONS.map((o) => o.label)).toEqual(["Green Screen", "Blur", "Backdrop", "Original"]);
    for (const { label } of BACKGROUND_MODE_OPTIONS) expect(studioSrc).toContain(`"${label}"`);
  });

  it("pins the quality pills in the page's order with the page's labels", () => {
    expect(BACKGROUND_QUALITY_OPTIONS.map((o) => o.quality)).toEqual(["auto", "pro", "tasks"]);
    expect(BACKGROUND_QUALITY_OPTIONS.map((o) => o.label)).toEqual(["Auto", "Pro", "MediaPipe"]);
    for (const { label } of BACKGROUND_QUALITY_OPTIONS) expect(studioSrc).toContain(`"${label}"`);
  });
});

describe("#92 fine-tune — the kit's sliders, the kit's ranges", () => {
  it("mirrors BroadcastStudio's slider table row for row", () => {
    expect(GREENSCREEN_FINE_TUNE_SLIDERS.map((s) => s.key)).toEqual([
      "sensitivity", "edgeShift", "softness", "smoothing", "spill", "blur", "dim",
    ]);
    for (const s of GREENSCREEN_FINE_TUNE_SLIDERS) {
      expect(studioSrc).toContain(`key: "${s.key}"`);
      expect(studioSrc).toContain(`label: "${s.label}"`);
      expect(studioSrc).toContain(s.hint);
    }
  });

  it("slider ranges are the sanitizer's ranges in greenscreen-finetune.ts", () => {
    const byKey = Object.fromEntries(GREENSCREEN_FINE_TUNE_SLIDERS.map((s) => [s.key, s]));
    expect([byKey.sensitivity!.min, byKey.sensitivity!.max]).toEqual([-50, 50]);
    expect([byKey.edgeShift!.min, byKey.edgeShift!.max]).toEqual([-3, 3]);
    expect([byKey.softness!.min, byKey.softness!.max]).toEqual([-2, 3]);
    expect([byKey.smoothing!.min, byKey.smoothing!.max]).toEqual([0, 100]);
    expect([byKey.spill!.min, byKey.spill!.max]).toEqual([0, 100]);
    expect([byKey.blur!.min, byKey.blur!.max]).toEqual([0, 40]);
    expect([byKey.dim!.min, byKey.dim!.max]).toEqual([0, 85]);
  });

  it("gates sliders by mode exactly like the page: Original shows none", () => {
    expect(fineTuneSlidersForMode("none")).toHaveLength(0);
    expect(fineTuneSlidersForMode("green").map((s) => s.key)).toEqual(["sensitivity", "edgeShift", "softness", "smoothing", "spill"]);
    expect(fineTuneSlidersForMode("blur").map((s) => s.key)).toEqual(["sensitivity", "edgeShift", "softness", "smoothing", "spill", "blur"]);
    expect(fineTuneSlidersForMode("image").map((s) => s.key)).toEqual(["sensitivity", "edgeShift", "softness", "smoothing", "spill", "dim"]);
  });

  it("formats values the page's way", () => {
    const byKey = Object.fromEntries(GREENSCREEN_FINE_TUNE_SLIDERS.map((s) => [s.key, s]));
    expect(byKey.sensitivity!.format(5)).toBe("+5");
    expect(byKey.sensitivity!.format(-3)).toBe("-3");
    expect(byKey.sensitivity!.format(0)).toBe("0");
    expect(byKey.smoothing!.format(50)).toBe("50%");
    expect(byKey.blur!.format(18)).toBe("18px");
    expect(byKey.dim!.format(0)).toBe("0%");
  });
});

describe("#92 the settings ride the kit's ONE device store", () => {
  function fakeStorage() {
    const map = new Map<string, string>();
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => { map.set(k, v); },
      map,
    };
  }

  it("is the same key BroadcastStudio's panel loads and saves", () => {
    expect(GREENSCREEN_FINETUNE_KEY).toBe("bdv-greenscreen-finetune");
    expect(studioSrc).toContain("loadGreenScreenFineTune()");
    expect(studioSrc).toContain("saveGreenScreenFineTune(next)");
    expect(deskSrc).toContain("loadGreenScreenFineTune()");
    expect(deskSrc).toContain("saveGreenScreenFineTune(next)");
  });

  it("round-trips: what the desk saves is what either surface loads", () => {
    const storage = fakeStorage();
    const tuned = { ...GREENSCREEN_FINETUNE_DEFAULTS, sensitivity: 20, spill: 80, dim: 30 };
    saveGreenScreenFineTune(tuned, storage);
    expect(loadGreenScreenFineTune(storage)).toEqual(tuned);
    /* A fresh surface with nothing saved gets the shipped defaults. */
    expect(loadGreenScreenFineTune(fakeStorage())).toEqual(GREENSCREEN_FINETUNE_DEFAULTS);
    /* Junk in the store sanitizes back to a complete in-range value. */
    const junk = fakeStorage();
    junk.map.set(GREENSCREEN_FINETUNE_KEY, JSON.stringify({ sensitivity: 999, blur: -5 }));
    const cleaned = loadGreenScreenFineTune(junk);
    expect(cleaned.sensitivity).toBe(50);
    expect(cleaned.blur).toBe(0);
  });
});

describe("#92 engine truth is spoken the page's way", () => {
  it("labels the LIVE engine kind, never the wanted one", () => {
    expect(engineKindLabel("pro")).toBe("Pro");
    expect(engineKindLabel("tasks")).toBe("MediaPipe Tasks");
    expect(engineKindLabel("off")).toBe("Off");
    expect(studioSrc).toContain("Background engine:");
  });

  it("speaks every fallback reason verbatim, and stays silent otherwise", () => {
    expect(engineFallbackNote(null)).toBeNull();
    expect(engineFallbackNote({ kind: "pro", fellBack: false, reason: null })).toBeNull();
    expect(engineFallbackNote({ kind: "off", fellBack: true, reason: "pro-stopped" })).toBe(
      "Pro engine stopped on this device — camera is running plain. Try MediaPipe, or reopen the studio.",
    );
    expect(engineFallbackNote({ kind: "off", fellBack: true, reason: "tasks-stopped" })).toBe(
      "MediaPipe engine stopped on this device — camera is running plain. Try Pro, or reopen the studio.",
    );
    expect(engineFallbackNote({ kind: "off", fellBack: true, reason: "tasks-init-failed" })).toBe(
      "MediaPipe engine couldn't start on this device — camera is running plain.",
    );
    expect(engineFallbackNote({ kind: "off", fellBack: true, reason: "pro-init-failed" })).toBe(
      "Pro engine couldn't start on this device — camera is running plain.",
    );
    for (const reason of ["pro-stopped", "tasks-stopped", "tasks-init-failed"] as const) {
      expect(studioSrc).toContain(`engineDetail.reason === "${reason}"`);
    }
  });

  it("engine-down is a failure only with a backdrop mode in play AND a kit error", () => {
    expect(engineDownFromStatus("off", "none", false)).toBe(false);
    expect(engineDownFromStatus("off", "none", true)).toBe(true);
    expect(engineDownFromStatus("off", "green", false)).toBe(true);
    expect(engineDownFromStatus("off", "image", false)).toBe(true);
    expect(engineDownFromStatus("pro", "green", false)).toBe(false);
    expect(engineDownFromStatus("tasks", "blur", true)).toBe(false);
    /* The page's construction-site form of the same rule. */
    expect(studioSrc).toContain('kind === "off" && !(c && c.mode === "none" && !c.engineError)');
  });
});

describe("#92 the backdrop tile rule is the page's rule", () => {
  it("a selection is the active tile only in Backdrop mode", () => {
    const builtin = { kind: "builtin", id: "stage" } as const;
    const other = { kind: "builtin", id: "marble" } as const;
    const custom = { kind: "custom", name: "mine.png" } as const;
    expect(backdropTileActive(builtin, builtin, "image")).toBe(true);
    expect(backdropTileActive(builtin, builtin, "green")).toBe(false);
    expect(backdropTileActive(builtin, other, "image")).toBe(false);
    expect(backdropTileActive(custom, custom, "image")).toBe(true);
    expect(backdropTileActive(custom, builtin, "image")).toBe(false);
    /* The rule is backdrop-selection's own isSelectionActive + the mode gate. */
    expect(isSelectionActive(builtin, builtin)).toBe(true);
    expect(studioSrc).toContain('isSelectionActive(backdropSel, { kind: "builtin", id: b.id }) && mode === "image"');
  });
});

describe("#92 the desk drives the ONE kit — source pins", () => {
  it("constructs the BackgroundChanger with audio and the held choices, like the page", () => {
    expect(deskSrc).toContain('from "@/lib/stream-kit/background-changer"');
    expect(deskSrc).toContain("new BackgroundChanger({");
    expect(deskSrc).toContain("audio: true");
    expect(studioSrc).toContain("new BackgroundChanger({");
    expect(studioSrc).toContain("audio: true");
  });

  it("takes the kit's composited output stream as the feed the transport publishes", () => {
    expect(deskSrc).toContain("const feed = changer.getStream();");
    expect(deskSrc).toContain("camRef.current = feed;");
    expect(deskSrc).toContain("createStreamTransport(status?.transport ?? \"own\")");
    expect(deskSrc).toContain("destinations: [{ ...SITE_DESTINATION }]");
  });

  it("drives the kit through its own methods — no second keyer, no parallel pipeline", () => {
    expect(deskSrc).toContain("changer.setMode(m)");
    expect(deskSrc).toContain("changerRef.current?.setQuality(q)");
    expect(deskSrc).toContain("await changer.setImage(source)");
    expect(deskSrc).toContain("changerRef.current?.setFineTune(next)");
    expect(deskSrc).not.toContain("applyChromaKey");
    expect(deskSrc).not.toContain("chromaAlpha");
    expect(deskSrc).not.toContain("from \"@/lib/stream-kit/scenes\"");
  });

  it("resolves the ONE backdrop selection the page's way at every call site", () => {
    expect(deskSrc).toContain("backdropSelectionSource(backdropSelRef.current, customBackdropRef.current?.source ?? null)");
    expect(deskSrc).toContain("validateBackdropUpload(file)");
    expect(deskSrc).toContain("selectionAfterUpload(backdropSelRef.current, { ok: true, name: file.name })");
    expect(deskSrc).toContain("greenScreenCueVisible(bgMode)");
    expect(deskSrc).toContain("BACKDROPS.map(");
  });

  it("carries the panel's testids and charges nothing", () => {
    for (const testid of [
      "world-live-behind-me", "world-live-bg-engine-status", "world-live-bg-engine-down",
      "world-live-bg-upload", "world-live-bg-url", "world-live-bg-backdrop-custom",
      "world-live-bg-finetune", "world-live-bg-finetune-reset", "world-live-bg-note",
      /* per-option testids ride the templates, exactly as the page's do */
      "`world-live-bg-mode-${m}`", "`world-live-bg-quality-${q}`",
      "`world-live-bg-backdrop-${b.id}`", "`world-live-bg-finetune-${s.key}`",
    ]) {
      expect(deskSrc).toContain(testid);
    }
    expect(deskSrc).not.toContain("chargeCredits");
    expect(deskSrc).not.toContain("confirmedFetch");
  });

  it("leaves the 2D studio's own panel untouched — the kit's home surface stays whole", () => {
    expect(studioSrc).toContain('data-testid="greenscreen-finetune"');
    expect(studioSrc).toContain('data-testid="gs-bg-cue"');
    expect(studioSrc).toContain('data-testid="engine-status"');
  });
});

describe("#92 the board records wave III and the honest follow-ons", () => {
  it("records the promotion", () => {
    expect(LIVE_WAVE3_PROMOTIONS).toHaveLength(1);
    expect(LIVE_WAVE3_PROMOTIONS[0]).toContain("#92");
    expect(LIVE_WAVE3_PROMOTIONS[0]).toContain("BackgroundChanger");
  });

  it("names the chroma-key and changer follow-ons instead of faking them", () => {
    const joined = LIVE_NATIVE_FOLLOW_ONS.join(" ");
    expect(joined).toContain("chroma key");
    expect(joined).toContain("stage compositor");
    expect(joined).toContain("Camera effects");
  });

  it("RTMP's verdict is the deployment env gate — the server's own words", () => {
    expect(LIVE_NATIVE_FOLLOW_ONS.join(" ")).toContain("LIVE_RTMP_INGEST=on");
    expect(rtmpIngestSrc).toContain('env["LIVE_RTMP_INGEST"]');
    expect(rtmpIngestSrc).toContain("door closed — LIVE_RTMP_INGEST is not 'on' for this deployment");
  });
});
