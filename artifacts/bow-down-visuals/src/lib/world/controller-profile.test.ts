/**
 * Controller identity (stack900, owner's directive 2026-10-29:
 * "On the virtual world, it should match the controller I'm
 * using, and I'm using a PS5 controller").
 *
 * The World used to speak Xbox everywhere — A, B, LB, Back,
 * Start — whatever pad was in hand. These pins hold the
 * repair: the pad's id string classifies into a family with
 * plain-words name and per-family button names; the rendered
 * help line composes from those names; and every poll
 * (scene + panels) resolves its buttons through the profile,
 * whose index table is the ONE standard positional table —
 * pinned here against bindings.ts and panel-nav.ts so the
 * three readers can never drift apart.
 */
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  GENERIC_CONTROLLER_PROFILE,
  PAD_ROLE_INDEX,
  classifyGamepadId,
  controllerProfileFromPad,
  getControllerProfile,
  padButtonIndex,
  padVerbIndices,
  padWord,
  panelButtonsFor,
  refreshControllerProfile,
  subscribeControllerProfile,
  type ControllerProfile,
} from "./controller-profile";
import { PAD_SLOTS, PAD_SPRINT_BUTTONS, PAD_VERBS } from "./bindings";
import { PANEL_PAD_BUTTONS, pollPanelPad, IDLE_PANEL_PAD_EDGES } from "./panel-nav";
import {
  pollGamepad,
  IDLE_GAMEPAD_EDGES,
  type GamepadEdges,
  type GamepadIntent,
  type GamepadLike,
} from "./gamepad";

const DUALSENSE_CHROME = "DualSense Wireless Controller (Vendor: 054c Product: 0ce6)";
const DUALSENSE_FIREFOX = "054c-0ce6-DualSense Wireless Controller";
const DUALSHOCK_CHROME = "Wireless Controller (Vendor: 054c Product: 05c4)";
const DUALSHOCK_V2_CHROME = "Wireless Controller (Vendor: 054c Product: 09cc)";
const DUALSHOCK_FIREFOX = "054c-05c4-Wireless Controller";
const XBOX_360 = "Xbox 360 Controller (XInput STANDARD GAMEPAD Vendor: 045e Product: 028e)";
const XBOX_WIRELESS = "Xbox Wireless Controller (Vendor: 045e Product: 0b13)";
const XBOX_ONE_WIRED = "Controller (Xbox One For Windows) (Vendor: 045e Product: 02dd)";
const SWITCH_PRO = "Pro Controller (Vendor: 057e Product: 2009)";
const JOYCON = "Joy-Con (L) (Vendor: 057e Product: 2006)";
const UNKNOWN_PAD = "8BitDo Pro 2 (Vendor: 2dc8 Product: 6001)";

const ALL_IDS = [
  DUALSENSE_CHROME,
  DUALSENSE_FIREFOX,
  DUALSHOCK_CHROME,
  DUALSHOCK_V2_CHROME,
  DUALSHOCK_FIREFOX,
  XBOX_360,
  XBOX_WIRELESS,
  XBOX_ONE_WIRED,
  SWITCH_PRO,
  JOYCON,
  UNKNOWN_PAD,
];

describe("classifyGamepadId — PlayStation", () => {
  it("a DualSense is a PS5 DualSense, in Chrome and Firefox spellings alike", () => {
    for (const id of [DUALSENSE_CHROME, DUALSENSE_FIREFOX]) {
      const p = classifyGamepadId(id);
      expect(p.family).toBe("playstation");
      expect(p.displayName).toBe("PS5 DualSense");
      expect(p.gamepadId).toBe(id);
    }
  });

  it("the DualShock's generic-looking name still lands PlayStation — the vendor string tells", () => {
    for (const id of [DUALSHOCK_CHROME, DUALSHOCK_V2_CHROME, DUALSHOCK_FIREFOX, "Wireless Controller"]) {
      const p = classifyGamepadId(id);
      expect(p.family).toBe("playstation");
      expect(p.displayName).toBe("PS4 DualShock 4");
    }
  });

  it("DualSense names: Cross confirms, L1 works the prompt, Create holds the page, Options frames", () => {
    const p = classifyGamepadId(DUALSENSE_CHROME);
    expect(padWord(p, "confirm")).toBe("Cross");
    expect(padWord(p, "back")).toBe("Circle");
    expect(padWord(p, "leftFace")).toBe("Square");
    expect(padWord(p, "topFace")).toBe("Triangle");
    expect(padWord(p, "leftBumper")).toBe("L1");
    expect(padWord(p, "rightBumper")).toBe("R1");
    expect(padWord(p, "leftTrigger")).toBe("L2");
    expect(padWord(p, "rightTrigger")).toBe("R2");
    expect(padWord(p, "leftMenu")).toBe("Create");
    expect(padWord(p, "rightMenu")).toBe("Options");
    expect(padWord(p, "leftStickPress")).toBe("L3");
    expect(padWord(p, "rightStickPress")).toBe("R3");
  });

  it("the DualShock's small left button is Share, not Create", () => {
    expect(padWord(classifyGamepadId(DUALSHOCK_CHROME), "leftMenu")).toBe("Share");
    expect(padWord(classifyGamepadId(DUALSHOCK_CHROME), "rightMenu")).toBe("Options");
  });

  it("the face buttons carry their drawn shapes beside the words", () => {
    const p = classifyGamepadId(DUALSENSE_CHROME);
    expect(p.labels.confirm.glyph).toBe("✕");
    expect(p.labels.back.glyph).toBe("○");
    expect(p.labels.leftFace.glyph).toBe("□");
    expect(p.labels.topFace.glyph).toBe("△");
  });
});

describe("classifyGamepadId — Xbox, Switch, unknown", () => {
  it("Xbox pads are Xbox, 360 named as a 360", () => {
    expect(classifyGamepadId(XBOX_360).family).toBe("xbox");
    expect(classifyGamepadId(XBOX_360).displayName).toBe("Xbox 360 controller");
    for (const id of [XBOX_WIRELESS, XBOX_ONE_WIRED]) {
      const p = classifyGamepadId(id);
      expect(p.family).toBe("xbox");
      expect(p.displayName).toBe("Xbox controller");
      expect(padWord(p, "confirm")).toBe("A");
      expect(padWord(p, "back")).toBe("B");
      expect(padWord(p, "leftBumper")).toBe("LB");
      expect(padWord(p, "leftMenu")).toBe("View");
      expect(padWord(p, "rightMenu")).toBe("Menu");
    }
  });

  it("a Switch Pro is a Switch Pro — and its printed letters honestly rotate", () => {
    const p = classifyGamepadId(SWITCH_PRO);
    expect(p.family).toBe("switch");
    expect(p.displayName).toBe("Switch Pro Controller");
    /* Nintendo prints B at the bottom position and A at the
     * right: the confirm WORD is B, the back WORD is A, while
     * the positions (indices) never move. */
    expect(padWord(p, "confirm")).toBe("B");
    expect(padWord(p, "back")).toBe("A");
    expect(padWord(p, "leftFace")).toBe("Y");
    expect(padWord(p, "topFace")).toBe("X");
    expect(padWord(p, "leftBumper")).toBe("L");
    expect(padWord(p, "leftTrigger")).toBe("ZL");
    expect(padWord(p, "leftMenu")).toBe("−");
    expect(padWord(p, "rightMenu")).toBe("+");
    expect(classifyGamepadId(JOYCON).family).toBe("switch");
    expect(classifyGamepadId(JOYCON).displayName).toBe("Nintendo Switch Joy-Con");
  });

  it("an unknown pad is never handed another family's names — positions only", () => {
    const p = classifyGamepadId(UNKNOWN_PAD);
    expect(p.family).toBe("generic");
    expect(p.displayName).toBe("Controller");
    expect(p.gamepadId).toBe(UNKNOWN_PAD);
    expect(padWord(p, "confirm")).toBe("bottom button");
    expect(padWord(p, "back")).toBe("right button");
    expect(padWord(p, "leftBumper")).toBe("left bumper");
    expect(padWord(p, "leftMenu")).toBe("left menu button");
    expect(padWord(p, "rightMenu")).toBe("right menu button");
  });

  it("no id at all is the standing generic profile, with no id", () => {
    for (const id of [null, undefined, "", "   "]) {
      const p = classifyGamepadId(id);
      expect(p).toBe(GENERIC_CONTROLLER_PROFILE);
      expect(p.gamepadId).toBeNull();
    }
    expect(controllerProfileFromPad(null)).toBe(GENERIC_CONTROLLER_PROFILE);
    expect(controllerProfileFromPad({})).toBe(GENERIC_CONTROLLER_PROFILE);
  });
});

describe("the help line, composed per family", () => {
  /* The exact compositions world.tsx renders: display name up
   * front, then the verbs in the pad's own words. */
  const line = (p: ControllerProfile) =>
    `${p.displayName} connected — ${padWord(p, "confirm")} steps voice, ` +
    `${padWord(p, "topFace")} switches view, ${padWord(p, "leftBumper")} works the prompt, ` +
    `${padWord(p, "leftMenu")} switches the action page, ${padWord(p, "rightStickPress")} claims the moment, ` +
    `${padWord(p, "rightMenu")} frames a photo. In a panel, ${padWord(p, "confirm")} chooses and ` +
    `${padWord(p, "back")} goes back; hold ${padWord(p, "leftMenu")} for full screen.`;

  it("the owner's DualSense hears its own names", () => {
    expect(line(classifyGamepadId(DUALSENSE_CHROME))).toBe(
      "PS5 DualSense connected — Cross steps voice, Triangle switches view, L1 works the prompt, " +
        "Create switches the action page, R3 claims the moment, Options frames a photo. " +
        "In a panel, Cross chooses and Circle goes back; hold Create for full screen.",
    );
  });

  it("an Xbox pad hears the names the old line hard-coded", () => {
    expect(line(classifyGamepadId(XBOX_WIRELESS))).toBe(
      "Xbox controller connected — A steps voice, Y switches view, LB works the prompt, " +
        "View switches the action page, RS claims the moment, Menu frames a photo. " +
        "In a panel, A chooses and B goes back; hold View for full screen.",
    );
  });

  it("a Switch Pro hears its printed letters; an unknown pad hears positions", () => {
    expect(line(classifyGamepadId(SWITCH_PRO))).toContain("B steps voice");
    expect(line(classifyGamepadId(SWITCH_PRO))).toContain("hold − for full screen");
    expect(line(classifyGamepadId(UNKNOWN_PAD))).toContain(
      "bottom button steps voice",
    );
    expect(line(classifyGamepadId(UNKNOWN_PAD))).toContain(
      "hold left menu button for full screen",
    );
  });
});

describe("the index table — one positional table, pinned against every reader", () => {
  it("every family's profile resolves roles to the standard positions", () => {
    for (const id of ALL_IDS) {
      const p = classifyGamepadId(id);
      expect(p.indices).toBe(PAD_ROLE_INDEX);
      expect(padButtonIndex(p, "confirm")).toBe(0);
      expect(padButtonIndex(p, "back")).toBe(1);
      expect(padButtonIndex(p, "leftFace")).toBe(2);
      expect(padButtonIndex(p, "topFace")).toBe(3);
      expect(padButtonIndex(p, "leftBumper")).toBe(4);
      expect(padButtonIndex(p, "rightBumper")).toBe(5);
      expect(padButtonIndex(p, "leftTrigger")).toBe(6);
      expect(padButtonIndex(p, "rightTrigger")).toBe(7);
      expect(padButtonIndex(p, "leftMenu")).toBe(8);
      expect(padButtonIndex(p, "rightMenu")).toBe(9);
      expect(padButtonIndex(p, "leftStickPress")).toBe(10);
      expect(padButtonIndex(p, "rightStickPress")).toBe(11);
      expect(padButtonIndex(p, "dpadUp")).toBe(12);
      expect(padButtonIndex(p, "dpadDown")).toBe(13);
      expect(padButtonIndex(p, "dpadLeft")).toBe(14);
      expect(padButtonIndex(p, "dpadRight")).toBe(15);
    }
  });

  it("the profile's verb set IS bindings' table, role by role", () => {
    for (const id of ALL_IDS) {
      const v = padVerbIndices(classifyGamepadId(id));
      expect(v.jump).toBe(0); // PAD_JUMP_BUTTON / PAD_VERBS voiceStep
      expect(v.voiceBack).toBe(PAD_VERBS[6] === "voiceBack" ? 6 : -1);
      expect(v.viewToggle).toBe(3);
      expect(v.interact).toBe(4);
      expect(v.pageCycle).toBe(8);
      expect(v.photoMode).toBe(9);
      expect(v.momentClaim).toBe(11);
      expect(v.slots).toEqual([...PAD_SLOTS]);
      expect(v.sprint).toEqual([...PAD_SPRINT_BUTTONS]);
      /* bindings' verb map and the profile agree on every verb. */
      const byVerb: Record<string, number> = {};
      for (const [btn, verb] of Object.entries(PAD_VERBS)) byVerb[verb] = Number(btn);
      expect(byVerb.voiceStep).toBe(v.jump);
      expect(byVerb.voiceBack).toBe(v.voiceBack);
      expect(byVerb.viewToggle).toBe(v.viewToggle);
      expect(byVerb.interact).toBe(v.interact);
      expect(byVerb.pageCycle).toBe(v.pageCycle);
      expect(byVerb.photoMode).toBe(v.photoMode);
      expect(byVerb.momentClaim).toBe(v.momentClaim);
    }
  });

  it("the profile's panel set IS panel-nav's table", () => {
    for (const id of ALL_IDS) {
      expect(panelButtonsFor(classifyGamepadId(id))).toEqual({ ...PANEL_PAD_BUTTONS });
    }
  });
});

describe("the polls resolve through the profile", () => {
  function pad(pressedIdx: number[] = []): GamepadLike {
    return {
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressedIdx.includes(i) })),
    };
  }

  it("panel poll: the profile's confirm confirms and its back goes back (DualSense)", () => {
    const buttons = panelButtonsFor(classifyGamepadId(DUALSENSE_CHROME));
    const cross = pollPanelPad(pad([0]), IDLE_PANEL_PAD_EDGES, buttons);
    expect(cross.intent.confirm).toBe(true);
    expect(cross.intent.back).toBe(false);
    const circle = pollPanelPad(pad([1]), IDLE_PANEL_PAD_EDGES, buttons);
    expect(circle.intent.back).toBe(true);
    const dpad = pollPanelPad(pad([12]), IDLE_PANEL_PAD_EDGES, buttons);
    expect(dpad.intent.move).toBe(-1);
  });

  it("scene poll through a DualSense profile: Cross tap jumps, Cross hold steps voice, Create hold fills the screen", () => {
    const profile = classifyGamepadId(DUALSENSE_CHROME);
    let edges: GamepadEdges = IDLE_GAMEPAD_EDGES;
    const step = (pressedIdx: number[], now: number): GamepadIntent => {
      const r = pollGamepad(pad(pressedIdx), edges, "perform", now, profile);
      edges = r.edges;
      return r.intent;
    };
    expect(step([0], 16).jump).toBe(true);
    expect(step([0], 500).toggleVoice).toBe(true);
    step([], 516);
    expect(step([8], 600).pageCycle).toBe(true);
    expect(step([8], 1300).fullscreenToggle).toBe(true);
    step([], 1316);
    expect(step([1], 1400).action).toBe("dance"); // Circle sits on the dance slot
  });

  it("a scripted session answers identically with no profile and with every family's profile", () => {
    const script: { pressed: number[]; now: number }[] = [
      { pressed: [], now: 0 },
      { pressed: [0], now: 16 },
      { pressed: [0], now: 32 },
      { pressed: [0], now: 500 },
      { pressed: [], now: 516 },
      { pressed: [8], now: 600 },
      { pressed: [8], now: 1300 },
      { pressed: [], now: 1316 },
      { pressed: [3], now: 1400 },
      { pressed: [4], now: 1500 },
      { pressed: [9], now: 1600 },
      { pressed: [11], now: 1700 },
      { pressed: [7], now: 1800 },
      { pressed: [13], now: 1900 },
      { pressed: [2], now: 2000 },
    ];
    const run = (profile?: ControllerProfile): GamepadIntent[] => {
      let edges: GamepadEdges = IDLE_GAMEPAD_EDGES;
      return script.map(({ pressed, now }) => {
        const r = pollGamepad(pad(pressed), edges, "perform", now, profile);
        edges = r.edges;
        return r.intent;
      });
    };
    const baseline = run(undefined);
    expect(baseline[1]!.jump).toBe(true);
    expect(baseline[3]!.toggleVoice).toBe(true);
    expect(baseline[5]!.pageCycle).toBe(true);
    expect(baseline[6]!.fullscreenToggle).toBe(true);
    expect(baseline[8]!.toggleView).toBe(true);
    expect(baseline[9]!.interact).toBe(true);
    expect(baseline[10]!.photoMode).toBe(true);
    expect(baseline[11]!.momentClaim).toBe(true);
    expect(baseline[12]!.sprint).toBe(true);
    expect(baseline[13]!.action).toBe("sit");
    expect(baseline[14]!.action).toBe("clap");
    for (const id of ALL_IDS) {
      expect(run(classifyGamepadId(id))).toEqual(baseline);
    }
  });
});

describe("the store — the pad in hand, reactively", () => {
  const originalNavigator = globalThis.navigator;
  let getGamepadsStub: (() => unknown[]) | null = null;

  function stubPads(pads: unknown[]) {
    getGamepadsStub = () => pads;
    Object.defineProperty(globalThis, "navigator", {
      value: { getGamepads: () => getGamepadsStub?.() ?? [] },
      configurable: true,
    });
  }

  afterEach(() => {
    Object.defineProperty(globalThis, "navigator", {
      value: originalNavigator,
      configurable: true,
    });
    stubPads([]);
    refreshControllerProfile();
  });

  it("adopts the first connected pad, names it, and only speaks on change", () => {
    stubPads([]);
    expect(refreshControllerProfile().gamepadId).toBeNull();

    let heard = 0;
    const off = subscribeControllerProfile(() => {
      heard += 1;
    });
    stubPads([null, { id: DUALSENSE_CHROME }]);
    const adopted = refreshControllerProfile();
    expect(adopted.displayName).toBe("PS5 DualSense");
    expect(getControllerProfile()).toBe(adopted);
    expect(heard).toBe(1);

    /* A steady pad re-read is silent. */
    refreshControllerProfile();
    expect(heard).toBe(1);

    /* A different pad taking the slot re-names the World. */
    stubPads([{ id: XBOX_WIRELESS }]);
    expect(refreshControllerProfile().family).toBe("xbox");
    expect(heard).toBe(2);

    /* Unplugged: back to the standing generic profile. */
    stubPads([]);
    expect(refreshControllerProfile().gamepadId).toBeNull();
    expect(heard).toBe(3);
    off();
  });
});

describe("the wiring — page, scene and panels read the one profile", () => {
  const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

  it("the scene classifies the pad it holds and polls through its profile", () => {
    const scene = read("./hall-scene.ts");
    expect(scene).toContain("controllerProfileFromPad(pad)");
  });

  it("the panel hook resolves its buttons through the profile store", () => {
    const hook = read("../../hooks/use-panel-pad-nav.ts");
    expect(hook).toContain("panelButtonsFor(getControllerProfile())");
  });

  it("no rendered pad prompt in the page hard-codes another family's names", () => {
    const page = read("../../pages/world.tsx");
    expect(page).not.toContain('"press Start"');
    expect(page).not.toContain("A steps voice");
    expect(page).not.toContain("Back switches the action page");
    expect(page).not.toContain("hold Back for full");
    /* The two kbd chips at the prompts render the profile's
       interact word (L1 on the owner's pad). */
    expect(page.split('padWord(padProfile, "leftBumper")').length - 1).toBeGreaterThanOrEqual(3);
  });
});
