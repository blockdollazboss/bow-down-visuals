/**
 * live-desk wave IV — #93 seam + sources: the changer follow-ons.
 *
 * Pins:
 * - the Camera & voice menus ARE the kit's own libraries
 *   (CAMERA_EFFECTS / VOICE_EFFECTS, reference-identical — the desk
 *   cannot offer an id the kit rejects) and BroadcastStudio's
 *   noise-cancellation pills in the page's order, with the page's
 *   default ("on");
 * - every pick the card can make is accepted by a REAL
 *   BackgroundChanger (constructed here on a hand-stubbed document,
 *   the kit suite's own pattern): camera effects, voice effects,
 *   noise levels, mirror, device switches — and the kit's
 *   rejections of unknown ids stay rejections;
 * - held picks ride into the kit's construction config exactly
 *   like BroadcastStudio's (a pick made with the camera off is the
 *   live setting from the first frame);
 * - the spoken notes are BroadcastStudio's own words (the opening
 *   line, the held-pick notes), and the live noise truth is the
 *   isolator's own status message — never the wanted level;
 * - the desk drives the ONE changer it already owns through the
 *   kit's own methods, takes its device lists from the kit's
 *   enumeration, and wires onNoiseStatus into the card;
 * - honest states: device switching is available only when the
 *   browser exposed the device lists — on enumeration failure the
 *   card shows the reason and NO selects, never a dead picker;
 * - law: nothing charges, and the follow-on board no longer names
 *   the changer rack (the chroma key left the board in the same
 *   wave — #95, riding the controller relay).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  CAMERA_EFFECT_OPTIONS, VOICE_EFFECT_OPTIONS, NOISE_CANCELLATION_OPTIONS,
  NOISE_CANCELLATION_DEFAULT, CAMERA_VOICE_OPENING_NOTE,
  noiseHeldNote, voiceEffectHeldNote, noiseStatusLine, deviceSwitchingAvailable,
  LIVE_WAVE4_PROMOTIONS, LIVE_NATIVE_FOLLOW_ONS,
} from "./live-desk";
import { BackgroundChanger, CAMERA_EFFECTS } from "../stream-kit/background-changer";
import { VOICE_EFFECTS, type VoiceIsolatorStatus } from "../stream-kit/voice-isolator";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const deskSrc = read("../../components/world/native/LiveDesk.tsx");
const studioSrc = read("../../components/go-live/BroadcastStudio.tsx");

describe("#93 the menus are the kit's own libraries", () => {
  it("the camera-effect menu is CAMERA_EFFECTS itself — no copy to drift", () => {
    expect(CAMERA_EFFECT_OPTIONS).toBe(CAMERA_EFFECTS);
    expect(CAMERA_EFFECT_OPTIONS.map((e) => e.id)).toEqual([
      "none", "warm", "noir", "vivid", "cool", "vintage", "vignette", "gold-frame",
    ]);
    expect(CAMERA_EFFECT_OPTIONS.map((e) => e.label)).toEqual([
      "None", "Warm Gold", "Noir", "Vivid", "Cool", "Vintage", "Vignette", "Gold Frame",
    ]);
    /* The page renders its preset row from the same array. */
    expect(studioSrc).toContain("CAMERA_EFFECTS.map(");
    expect(deskSrc).toContain("CAMERA_EFFECT_OPTIONS.map(");
  });

  it("the voice-effect menu is VOICE_EFFECTS itself", () => {
    expect(VOICE_EFFECT_OPTIONS).toBe(VOICE_EFFECTS);
    expect(VOICE_EFFECT_OPTIONS.map((e) => e.id)).toEqual([
      "none", "deep", "high", "robot", "echo", "reverb", "radio", "megaphone",
    ]);
    expect(studioSrc).toContain("VOICE_EFFECTS.map(");
    expect(deskSrc).toContain("VOICE_EFFECT_OPTIONS.map(");
  });

  it("noise pills are BroadcastStudio's, in the page's order, with the page's default", () => {
    expect(NOISE_CANCELLATION_OPTIONS.map((o) => o.level)).toEqual(["off", "on", "max"]);
    expect(NOISE_CANCELLATION_OPTIONS.map((o) => o.label)).toEqual(["Off", "On", "Max"]);
    for (const [lvl, label] of [["off", "Off"], ["on", "On"], ["max", "Max"]] as const) {
      expect(studioSrc).toContain(`["${lvl}", "${label}"]`);
    }
    expect(NOISE_CANCELLATION_DEFAULT).toBe("on");
    expect(studioSrc).toContain('useState<NoiseCancellationLevel>("on")');
  });
});

describe("#93 every pick is one the REAL kit accepts", () => {
  beforeEach(() => {
    /* The kit suite's hand-faked DOM, minimal: the constructor only
       builds hidden video/canvas elements and reads 2d contexts. */
    vi.stubGlobal("document", {
      createElement: () => ({
        muted: false, playsInline: false, width: 0, height: 0,
        getContext: () => null,
      }),
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("camera effects: every menu id lands; an unknown id throws", () => {
    const changer = new BackgroundChanger({});
    for (const e of CAMERA_EFFECT_OPTIONS) {
      changer.setCameraEffect(e.id);
      expect(changer.getCameraEffect()).toBe(e.id);
    }
    expect(() => changer.setCameraEffect("not-a-kit-effect")).toThrow(/Unknown camera effect/);
  });

  it("voice effects: every menu id lands; an unknown id is refused", async () => {
    const changer = new BackgroundChanger({});
    for (const e of VOICE_EFFECT_OPTIONS) {
      await changer.setVoiceEffect(e.id);
      expect(changer.getVoiceEffect()).toBe(e.id);
    }
    await expect(changer.setVoiceEffect("not-a-kit-effect")).rejects.toThrow(/Unknown voice effect/);
  });

  it("noise levels: every pill lands, and switching the feature off reads false", async () => {
    const changer = new BackgroundChanger({});
    for (const { level } of NOISE_CANCELLATION_OPTIONS) {
      await changer.setNoiseCancellation(level);
      expect(changer.getNoiseCancellation()).toBe(level);
    }
    await changer.setNoiseCancellation(false);
    expect(changer.getNoiseCancellation()).toBe(false);
    await expect(changer.setNoiseCancellation("loud" as never)).rejects.toThrow(/Unknown noise-cancellation level/);
  });

  it("mirror + device switches drive the kit's own state", async () => {
    const changer = new BackgroundChanger({});
    changer.setMirror(true);
    expect(changer.mirror).toBe(true);
    changer.setMirror(false);
    expect(changer.mirror).toBe(false);
    /* Not running: a switch records the chosen device on the kit —
       the same device the next start() acquires. */
    await changer.switchCamera("cam-2");
    expect(changer.deviceId).toBe("cam-2");
    await changer.switchMicrophone("mic-2");
    expect(changer.microphoneDeviceId).toBe("mic-2");
  });

  it("held picks ride into the construction config — the desk's exact keys", () => {
    const changer = new BackgroundChanger({
      noiseCancellation: "max",
      voiceEffect: "echo",
      cameraEffect: "noir",
      mirror: true,
    });
    expect(changer.getNoiseCancellation()).toBe("max");
    expect(changer.getVoiceEffect()).toBe("echo");
    expect(changer.getCameraEffect()).toBe("noir");
    expect(changer.mirror).toBe(true);
    /* And the desk constructs its changer with those very keys. */
    expect(deskSrc).toContain("noiseCancellation: ncLevel");
    expect(deskSrc).toContain("voiceEffect: voiceFx");
    expect(deskSrc).toContain("cameraEffect: camFx");
    expect(deskSrc).toContain("await changer.start(cameraId || undefined)");
  });
});

describe("#93 the spoken notes are BroadcastStudio's own words", () => {
  it("the opening line is the page's initial voice note, verbatim", () => {
    expect(CAMERA_VOICE_OPENING_NOTE).toBe("Noise cancellation starts with the camera.");
    expect(studioSrc).toContain('"Noise cancellation starts with the camera."');
    expect(deskSrc).toContain("useState<string>(CAMERA_VOICE_OPENING_NOTE)");
  });

  it("held noise picks speak the page's sentences", () => {
    expect(noiseHeldNote("off")).toBe("Noise cancellation is off — your mic will pass through unchanged.");
    expect(noiseHeldNote("on")).toBe("Noise cancellation will start with the camera.");
    expect(noiseHeldNote("max")).toBe("Noise cancellation will start with the camera.");
    expect(studioSrc).toContain("Noise cancellation is off — your mic will pass through unchanged.");
    expect(studioSrc).toContain("Noise cancellation will start with the camera.");
  });

  it("held voice-effect picks speak the page's sentences — and never invent a label", () => {
    expect(voiceEffectHeldNote("none")).toBe("Voice effects are off.");
    expect(voiceEffectHeldNote("echo")).toBe("Echo will be on your voice when you start the camera.");
    expect(voiceEffectHeldNote("megaphone")).toBe("Megaphone will be on your voice when you start the camera.");
    expect(voiceEffectHeldNote("not-a-kit-effect")).toBe("Voice effects are off.");
    expect(studioSrc).toContain('"Voice effects are off."');
    expect(studioSrc).toContain("will be on your voice when you start the camera.");
  });

  it("the live noise truth is the isolator's own message, or silence", () => {
    expect(noiseStatusLine(null)).toBeNull();
    const silent = { level: "on", effectiveLevel: "on", mlState: "active", fellBack: false, effect: "none", message: "" } as VoiceIsolatorStatus;
    expect(noiseStatusLine(silent)).toBeNull();
    const fellBack = { ...silent, level: "max", effectiveLevel: "on", fellBack: true, message: "Max needs the ML model — running at On." } as VoiceIsolatorStatus;
    expect(noiseStatusLine(fellBack)).toBe("Max needs the ML model — running at On.");
  });
});

describe("#93 the desk drives the ONE kit — source pins", () => {
  it("live picks call the kit's own methods on the desk's changer", () => {
    expect(deskSrc).toContain("changerRef.current?.setCameraEffect(id)");
    expect(deskSrc).toContain("changer.setNoiseCancellation(level)");
    expect(deskSrc).toContain("changer.setVoiceEffect(id)");
    expect(deskSrc).toContain("changer.switchCamera(deviceId || undefined)");
    expect(deskSrc).toContain("changer.switchMicrophone(deviceId || undefined)");
    expect(deskSrc).toContain("changerRef.current?.setMirror(next)");
  });

  it("held picks speak through the seam's notes before the camera runs", () => {
    expect(deskSrc).toContain("setCvNote(noiseHeldNote(level))");
    expect(deskSrc).toContain("setCvNote(voiceEffectHeldNote(id))");
    expect(deskSrc).toContain("noiseStatusLine(changer.getNoiseStatus())");
  });

  it("the isolator's live status speaks into the card via onNoiseStatus", () => {
    expect(deskSrc).toContain("onNoiseStatus: (s) =>");
    expect(studioSrc).toContain("onNoiseStatus: (s) => setNcMsg(s.message)");
  });

  it("device lists ride the kit's enumeration — on mount and after the camera starts", () => {
    expect(deskSrc).toContain("BackgroundChanger.listCameras()");
    expect(deskSrc).toContain("BackgroundChanger.listMicrophones()");
    expect(deskSrc).toContain("useEffect(() => { void loadDevices(); }, [loadDevices]);");
    expect(deskSrc).toContain("void loadDevices();");
  });

  it("carries the card's testids and charges nothing", () => {
    for (const testid of [
      "world-live-camera-voice", "world-live-camera-select", "world-live-mic-select",
      "world-live-mirror", "world-live-cv-note", "world-live-devices-unavailable",
      "`world-live-camfx-${e.id}`", "`world-live-fx-${e.id}`", "`world-live-nc-${level}`",
    ]) {
      expect(deskSrc).toContain(testid);
    }
    expect(deskSrc).not.toContain("chargeCredits");
    expect(deskSrc).not.toContain("confirmedFetch");
  });

  it("leaves the 2D studio's own rack untouched — the kit's home surface stays whole", () => {
    expect(studioSrc).toContain('data-testid="btn-start-camera"');
    expect(studioSrc).toContain("changerRef.current?.setCameraEffect(e.id)");
    expect(studioSrc).toContain("await changerRef.current.switchCamera(e.target.value || undefined)");
  });
});

describe("#93 honest states + the board", () => {
  it("device switching exists only when the browser exposed the lists", () => {
    expect(deviceSwitchingAvailable(false)).toBe(true);
    expect(deviceSwitchingAvailable(true)).toBe(false);
    /* The card: selects on the available branch, the reason on the
       other — the two never render together. */
    expect(deskSrc).toContain("deviceSwitchingAvailable(devicesError !== null) ? (");
    expect(deskSrc).toContain('data-testid="world-live-devices-unavailable"');
    expect(deskSrc).toContain("Camera and microphone switching isn&rsquo;t available here");
  });

  it("records the wave-IV promotion", () => {
    /* Join widening (stack100 phase-2): the wave-IV board carries
       every wave-IV lane's entry — this lane's entry is found by
       containment, not by sole occupancy of the board. */
    const mine = LIVE_WAVE4_PROMOTIONS.filter((entry) => entry.includes("#93"));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toContain("Camera & voice");
    expect(mine[0]).toContain("BackgroundChanger");
  });

  it("the follow-on board no longer names the changer rack or the chroma key", () => {
    const joined = LIVE_NATIVE_FOLLOW_ONS.join(" ");
    expect(joined).not.toContain("Camera effects");
    expect(joined).not.toContain("noise cancellation / voice effects");
    expect(joined).not.toContain("not yet carried");
    /* Join widening (stack100 phase-2): the per-source chroma key
       left the follow-on board in the same wave (#95, pinned by the
       live-desk-chroma suite) — neither follow-on is named here. */
    expect(joined).not.toContain("chroma key");
    expect(joined).not.toContain("stage compositor");
  });
});
