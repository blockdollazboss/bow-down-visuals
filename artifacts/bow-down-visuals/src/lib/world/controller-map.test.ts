/**
 * The controller map (stack900, owner's directive 2026-10-29:
 * "The controller button should have a map") — the census and
 * highlight pins for lib/world/controller-map.ts and its panel.
 *
 * What is held here:
 *   - COMPLETENESS: every button index the World's polls bind
 *     (scene verbs, action slots, panel buttons, stick
 *     presses) appears on the map exactly once, for every
 *     family and both action pages — a bound button missing
 *     from the picture is a job the player cannot discover.
 *   - NAMES: every role node's name IS the profile's word for
 *     that role (never a copy in this module) — the map can
 *     never drift from the words the help line speaks.
 *   - JOBS: read out of bindings.ts against the CURRENT
 *     action page; the system buttons carry the honest
 *     "Not used" label and nothing else does.
 *   - SEATS: every node the census builds has a spot on its
 *     family's drawing.
 *   - THE LIVE HIGHLIGHT: a physical press lights exactly its
 *     own node, per family, index-resolved through the nodes
 *     themselves — the proof the map matches the hand.
 *   - THE PANEL'S SHAPE: its pad root holds no focusable
 *     control (Back is the pad's only verb inside it), the
 *     door stands in world.tsx beside the pad line, and the
 *     page wires the map into the same pad bargain as every
 *     other panel family.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

import { ACTION_BY_ID } from "./actions";
import { PAD_SLOTS, type ActionPageId } from "./bindings";
import {
  PAD_ROLE_INDEX,
  classifyGamepadId,
  type ControllerProfile,
} from "./controller-profile";
import {
  CONTROLLER_MAP_LAYOUTS,
  NOT_USED_IN_WORLD,
  controllerMapBoundIndices,
  controllerMapNodes,
  litNodeIds,
  type ControllerMapNode,
} from "./controller-map";
import type { GamepadLike } from "./gamepad";

const DUALSENSE = classifyGamepadId("DualSense Wireless Controller (Vendor: 054c Product: 0ce6)");
const DUALSHOCK = classifyGamepadId("Wireless Controller (Vendor: 054c Product: 05c4)");
const XBOX = classifyGamepadId("Xbox Wireless Controller (Vendor: 045e Product: 0b12)");
const SWITCH = classifyGamepadId("Pro Controller (Vendor: 057e Product: 2009)");
const GENERIC = classifyGamepadId("Some Unbranded Pad (Vendor: 1234 Product: 5678)");
const PROFILES: readonly ControllerProfile[] = [DUALSENSE, DUALSHOCK, XBOX, SWITCH, GENERIC];
const PAGES: readonly ActionPageId[] = ["perform", "social"];

function byId(nodes: readonly ControllerMapNode[], id: string): ControllerMapNode {
  const node = nodes.find((n) => n.id === id);
  if (!node) throw new Error(`no node ${id}`);
  return node;
}

function fakePad(pressed: readonly number[], axes: readonly number[] = [0, 0, 0, 0]): GamepadLike {
  return {
    buttons: Array.from({ length: 18 }, (_, i) => ({ pressed: pressed.includes(i) })),
    axes,
  };
}

describe("controller map — the census covers every bound button", () => {
  for (const profile of PROFILES) {
    for (const page of PAGES) {
      it(`${profile.displayName} / ${page}: every bound index is on the map, exactly once`, () => {
        const nodes = controllerMapNodes(profile, page);
        const covered = nodes
          .map((n) => n.buttonIndex)
          .filter((i): i is number => i !== null);
        for (const idx of controllerMapBoundIndices(profile)) {
          expect(covered, `bound index ${idx}`).toContain(idx);
        }
        for (const idx of PAD_SLOTS) {
          expect(covered, `action slot ${idx}`).toContain(idx);
        }
        /* Exactly once across the standard 16: two nodes
         * claiming one button would light together and lie. */
        for (let idx = 0; idx <= 15; idx++) {
          expect(
            covered.filter((i) => i === idx),
            `index ${idx} claimed once`,
          ).toHaveLength(1);
        }
        /* And every role in the profile's own table is drawn. */
        for (const role of Object.keys(PAD_ROLE_INDEX)) {
          expect(nodes.map((n) => n.id)).toContain(role === "leftStickPress" || role === "rightStickPress" ? (role === "leftStickPress" ? "leftStick" : "rightStick") : role);
        }
      });
    }
  }
});

describe("controller map — names come from the profile, never a copy", () => {
  for (const profile of PROFILES) {
    it(`${profile.displayName}: role node names equal the profile's words`, () => {
      const nodes = controllerMapNodes(profile, "perform");
      for (const [role, label] of Object.entries(profile.labels)) {
        if (role === "leftStickPress" || role === "rightStickPress") continue;
        expect(byId(nodes, role).name, role).toBe(label.word);
        expect(byId(nodes, role).glyph).toBe(label.glyph);
        expect(byId(nodes, role).buttonIndex).toBe(
          PAD_ROLE_INDEX[role as keyof typeof PAD_ROLE_INDEX],
        );
      }
    });
  }

  it("the owner's DualSense reads Cross / Circle / Square / Triangle with their glyphs", () => {
    const nodes = controllerMapNodes(DUALSENSE, "perform");
    expect(byId(nodes, "confirm")).toMatchObject({ name: "Cross", glyph: "✕" });
    expect(byId(nodes, "back")).toMatchObject({ name: "Circle", glyph: "○" });
    expect(byId(nodes, "leftFace")).toMatchObject({ name: "Square", glyph: "□" });
    expect(byId(nodes, "topFace")).toMatchObject({ name: "Triangle", glyph: "△" });
    expect(byId(nodes, "leftMenu").name).toBe("Create");
  });

  it("the DualShock's small left button is Share, from the same profile table", () => {
    expect(byId(controllerMapNodes(DUALSHOCK, "perform"), "leftMenu").name).toBe("Share");
  });

  it("the Switch rotation is the profile's: confirm is printed B, back is printed A", () => {
    const nodes = controllerMapNodes(SWITCH, "perform");
    expect(byId(nodes, "confirm").name).toBe("B");
    expect(byId(nodes, "back").name).toBe("A");
    /* Positions never moved: confirm still lights from 0. */
    expect(byId(nodes, "confirm").buttonIndex).toBe(0);
  });

  it("an unknown pad gets positions, not another family's letters", () => {
    const nodes = controllerMapNodes(GENERIC, "perform");
    expect(byId(nodes, "confirm").name).toBe("bottom button");
    expect(byId(nodes, "back").name).toBe("right button");
  });
});

describe("controller map — jobs are bindings.ts truth, against the current page", () => {
  it("the fixed verbs carry their jobs", () => {
    const nodes = controllerMapNodes(DUALSENSE, "perform");
    expect(byId(nodes, "confirm").job).toContain("Jump");
    expect(byId(nodes, "leftMenu").job).toContain("full screen");
    expect(byId(nodes, "leftMenu").job).toContain("action page");
    expect(byId(nodes, "topFace").job).toBe("Switch view");
    expect(byId(nodes, "leftTrigger").job).toBe("Step voice back");
    expect(byId(nodes, "rightTrigger").job).toBe("Sprint — hold");
    /* Button 9's row names both jobs since the stack900 join
       composed B8's tap (settings) with the hold (photo). */
    expect(byId(nodes, "rightMenu").job).toBe("World settings — tap · photo mode — hold");
    expect(byId(nodes, "leftBumper").job).toContain("prompt");
    expect(byId(nodes, "leftStick").job).toContain("Move");
    expect(byId(nodes, "leftStick").pressJob).toBe("Sprint — hold");
    expect(byId(nodes, "rightStick").pressJob).toContain("Claim");
  });

  it("slot jobs follow the action page, labelled from actions.ts", () => {
    const perform = controllerMapNodes(DUALSENSE, "perform");
    expect(byId(perform, "back").job).toContain(ACTION_BY_ID.get("dance")!.label);
    expect(byId(perform, "dpadUp").job).toContain(ACTION_BY_ID.get("bow")!.label);
    expect(byId(perform, "leftFace").job).toContain(ACTION_BY_ID.get("clap")!.label);
    const social = controllerMapNodes(DUALSENSE, "social");
    expect(byId(social, "back").job).toContain(ACTION_BY_ID.get("highfive")!.label);
    expect(byId(social, "dpadUp").job).toContain(ACTION_BY_ID.get("point")!.label);
    expect(byId(social, "leftFace").job).toContain(ACTION_BY_ID.get("salute")!.label);
    expect(byId(social, "dpadUp").job).toContain("Social");
  });

  it("panel jobs are spoken only where panel-nav grants them", () => {
    const nodes = controllerMapNodes(DUALSENSE, "perform");
    expect(byId(nodes, "confirm").panelJob).toContain("Choose");
    expect(byId(nodes, "back").panelJob).toContain("Go back");
    for (const d of ["dpadUp", "dpadDown", "dpadLeft", "dpadRight"]) {
      expect(byId(nodes, d).panelJob).toContain("selection");
    }
    expect(byId(nodes, "leftTrigger").panelJob).toBeUndefined();
    expect(byId(nodes, "topFace").panelJob).toBeUndefined();
  });

  it("the honest label: system buttons are 'not used', and nothing else is", () => {
    for (const profile of PROFILES) {
      const nodes = controllerMapNodes(profile, "perform");
      const unused = nodes.filter((n) => n.job === NOT_USED_IN_WORLD).map((n) => n.id);
      if (profile === DUALSENSE) {
        expect(unused.sort()).toEqual(["extra", "guide", "mute"]);
        expect(byId(nodes, "mute").buttonIndex).toBeNull();
      } else {
        expect(unused.sort()).toEqual(["extra", "guide"]);
      }
      expect(byId(nodes, "guide").buttonIndex).toBe(16);
      expect(byId(nodes, "extra").buttonIndex).toBe(17);
    }
    /* The furniture names are the family's own. */
    expect(byId(controllerMapNodes(DUALSENSE, "perform"), "extra").name).toBe("Touchpad");
    expect(byId(controllerMapNodes(XBOX, "perform"), "guide").name).toBe("Xbox button");
    expect(byId(controllerMapNodes(SWITCH, "perform"), "extra").name).toBe("Capture button");
  });
});

describe("controller map — every node has a seat on its family's drawing", () => {
  for (const profile of PROFILES) {
    it(`${profile.displayName}: layout seats the whole census`, () => {
      const layout = CONTROLLER_MAP_LAYOUTS[profile.family];
      expect(layout.viewBox).toBe("0 0 720 360");
      expect(layout.bodyPath.length).toBeGreaterThan(50);
      for (const node of controllerMapNodes(profile, "perform")) {
        expect(layout.spots[node.id], `${profile.family} seat for ${node.id}`).toBeDefined();
      }
    });
  }
});

describe("controller map — the live highlight points at the pressed button", () => {
  const nodes = controllerMapNodes(DUALSENSE, "perform");

  it("face and menu presses light exactly their own nodes", () => {
    expect([...litNodeIds(fakePad([0]), nodes)]).toEqual(["confirm"]);
    expect([...litNodeIds(fakePad([1]), nodes)]).toEqual(["back"]);
    expect([...litNodeIds(fakePad([8]), nodes)]).toEqual(["leftMenu"]);
    expect([...litNodeIds(fakePad([12]), nodes)]).toEqual(["dpadUp"]);
    expect([...litNodeIds(fakePad([4, 5]), nodes)].sort()).toEqual(["leftBumper", "rightBumper"]);
  });

  it("the system buttons light too — they are drawn, so they answer", () => {
    expect([...litNodeIds(fakePad([16]), nodes)]).toEqual(["guide"]);
    expect([...litNodeIds(fakePad([17]), nodes)]).toEqual(["extra"]);
  });

  it("a stick lights on its press and on a real push, never on drift", () => {
    expect([...litNodeIds(fakePad([10]), nodes)]).toEqual(["leftStick"]);
    expect([...litNodeIds(fakePad([11]), nodes)]).toEqual(["rightStick"]);
    expect([...litNodeIds(fakePad([], [0.9, 0, 0, 0]), nodes)]).toEqual(["leftStick"]);
    expect([...litNodeIds(fakePad([], [0, 0, 0, -0.9]), nodes)]).toEqual(["rightStick"]);
    expect(litNodeIds(fakePad([], [0.3, 0.1, 0, 0]), nodes).size).toBe(0);
  });

  it("no pad, no light; the mute node can never light (the browser never reports it)", () => {
    expect(litNodeIds(null, nodes).size).toBe(0);
    const all = fakePad(
      Array.from({ length: 18 }, (_, i) => i),
      [1, 1, 1, 1],
    );
    expect(litNodeIds(all, nodes).has("mute")).toBe(false);
  });

  it("resolution is positional on every family — the Switch B position confirms", () => {
    const switchNodes = controllerMapNodes(SWITCH, "perform");
    expect([...litNodeIds(fakePad([0]), switchNodes)]).toEqual(["confirm"]);
    const xboxNodes = controllerMapNodes(XBOX, "perform");
    expect([...litNodeIds(fakePad([3]), xboxNodes)]).toEqual(["topFace"]);
  });
});

describe("controller map — the panel's shape and the page's wiring", () => {
  const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
  const panel = read("../../components/world/ControllerMapPanel.tsx");
  const page = read("../../pages/world.tsx");

  it("the panel renders the census and the highlight from the lib, in both themes", () => {
    expect(panel).toContain("controllerMapNodes(profile, actionPage)");
    expect(panel).toContain("litNodeIds(pad, nodesRef.current)");
    expect(panel).toContain("CONTROLLER_MAP_LAYOUTS[profile.family]");
    expect(panel).toContain("firstGamepad");
    expect(panel).toContain('data-testid="world-controller-map"');
    expect(panel).toContain('data-testid="world-controller-map-close"');
  });

  it("the pad root holds no focusable control — Back is the pad's only verb inside", () => {
    /* Anchor on the JSX attribute (the header comment names
     * the testid too, earlier in the file). */
    const root = panel.slice(panel.indexOf('data-testid="world-controller-map">'));
    expect(root).not.toContain("<button");
    expect(root).not.toContain("<a ");
    expect(root).not.toContain("<input");
    /* The Close button lives ABOVE the root, for the mouse. */
    expect(panel.indexOf('data-testid="world-controller-map-close"')).toBeLessThan(
      panel.indexOf('data-testid="world-controller-map">'),
    );
  });

  it("the door stands in world.tsx and the map joins the pad bargain", () => {
    expect(page).toContain('data-testid="world-pad-map-toggle"');
    expect(page).toContain("import ControllerMapPanel from \"@/components/world/ControllerMapPanel\";");
    expect(page).toContain("'[data-testid=\"world-controller-map\"]'");
    expect(page).toContain("active: padMapOpen && status === \"inside\"");
    expect(page).toContain("onClose: () => setPadMapOpen(false),");
    /* Opening the map retires the other panels (one at a time). */
    const door = page.slice(page.indexOf('data-testid="world-pad-map-toggle"'));
    expect(door.slice(0, 700)).toContain("setCharPanelOpen(false);");
    expect(door.slice(0, 700)).toContain("setScreenPanelOpen(false);");
    expect(door.slice(0, 700)).toContain("setHostPanelOpen(false);");
    expect(door.slice(0, 700)).toContain("closeStation();");
  });
});
