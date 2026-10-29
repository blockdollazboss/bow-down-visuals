/**
 * controller-map.ts — the picture of the pad in the player's
 * hand, with every button's World job written on it (stack900,
 * owner's directive 2026-10-29: "The controller button should
 * have a map").
 *
 * B1 (controller-profile.ts) taught the World to SPEAK the
 * pad's own names; this module draws it. The panel component
 * (components/world/ControllerMapPanel.tsx) renders what is
 * described here — a schematic of the connected pad's family,
 * one node per physical control — and lights a node while the
 * player physically holds that control down, so the picture is
 * provably the pad in hand and not a poster.
 *
 * Nothing here invents a name or a job:
 *
 *   NAMES come from the profile (controller-profile.ts label
 *   tables) — Cross / Circle on the owner's DualSense, A / B
 *   on an Xbox pad, positions on an unknown one. The only
 *   names coined in this file are for the two system buttons
 *   the profile has no role for (guide, extra) and the
 *   DualSense's mute button, which the browser cannot even
 *   see; they are family furniture, not button-role names.
 *
 *   JOBS come from bindings.ts, the one binding table: the
 *   fixed verbs (PAD_VERBS, PAD_JUMP_BUTTON, the Back hold),
 *   the paged action slots (PAD_SLOTS against the CURRENT
 *   action page, labels from actions.ts ACTION_BY_ID), the
 *   sprint pair, and the panel jobs from panel-nav.ts (D-pad
 *   moves, confirm chooses, back goes back — spoken only
 *   while a panel owns the pad, and labelled as such).
 *
 *   A control with no World job says so — "Not used in the
 *   World", in dim ink on the panel. The guide button and the
 *   touchpad / Share / Capture button are real buttons the
 *   World never reads (the browser reserves the guide button
 *   for itself on most platforms); drawing them unlabelled
 *   would invite a press that does nothing, and inventing
 *   them a job would be a lie. The map tells the truth.
 *
 * Layouts are data, not drawing code: one body outline and a
 * spot per node id per family, so the census test can prove
 * every node the census builds has a seat on every family's
 * picture before a pixel is painted.
 */

import { ACTION_BY_ID } from "./actions";
import {
  PAD_SLOTS,
  actionPageById,
  type ActionPageId,
} from "./bindings";
import {
  padVerbIndices,
  panelButtonsFor,
  type ControllerFamily,
  type ControllerProfile,
  type PadRole,
} from "./controller-profile";
import type { GamepadLike } from "./gamepad";

/** The honest label for a control the World never reads. */
export const NOT_USED_IN_WORLD = "Not used in the World";

/** How far a stick must travel before the map lights it: past
 *  the game's own deadzone (0.18) by a wide margin, the same
 *  discipline panel-nav keeps — a resting thumb's drift must
 *  never light the picture. */
export const MAP_STICK_LIGHT_THRESHOLD = 0.5;

export type ControllerMapNodeKind = "button" | "stick" | "system";

export interface ControllerMapNode {
  /** Stable id: the PadRole for role buttons, "leftStick" /
   *  "rightStick" for the sticks, "guide" / "extra" / "mute"
   *  for the system furniture. */
  id: string;
  /** The control's name ON THIS PAD — the profile's word for
   *  role buttons ("Cross", "L1", "bottom button"). */
  name: string;
  /** The drawn shape where the family has one (PlayStation's
   *  face glyphs), from the profile. */
  glyph?: string;
  /** Its World job, in plain words. NOT_USED_IN_WORLD when
   *  the World never reads it. */
  job: string;
  /** A stick's press job (L3 / R3), where the stick clicks. */
  pressJob?: string;
  /** Its job while a panel owns the pad (panel-nav.ts),
   *  where it has one. */
  panelJob?: string;
  /** The standard-mapping button index this node lights
   *  from — a stick's PRESS index for stick nodes. Null when
   *  the browser never reports the control at all (the
   *  DualSense's mute button): it can be drawn and labelled,
   *  never lit. */
  buttonIndex: number | null;
  /** The stick's axis pair, for stick nodes: it lights on
   *  deflection as well as on its press. */
  axes?: readonly [number, number];
  kind: ControllerMapNodeKind;
}

/* The two system buttons have no PadRole — the profile names
 * roles, and these do no role's work. Their furniture names
 * per family live here, the map's own extension; every
 * role button's name still comes from the profile alone. */
const SYSTEM_NAMES: Readonly<
  Record<ControllerFamily, { guide: string; extra: string }>
> = {
  playstation: { guide: "PS button", extra: "Touchpad" },
  xbox: { guide: "Xbox button", extra: "Share button" },
  switch: { guide: "Home button", extra: "Capture button" },
  generic: { guide: "Guide button", extra: "Extra button" },
};

const GUIDE_BUTTON_INDEX = 16;
const EXTRA_BUTTON_INDEX = 17;

/**
 * The full census: every control on the pad, named from the
 * profile, with its job read out of bindings.ts against the
 * CURRENT action page (the slot buttons perform different
 * actions per page — the map shows the page the player is
 * on, and its header says which).
 */
export function controllerMapNodes(
  profile: ControllerProfile,
  actionPage: ActionPageId,
): ControllerMapNode[] {
  const page = actionPageById(actionPage);
  const slotJob = (buttonIndex: number): string => {
    const slot = PAD_SLOTS.indexOf(buttonIndex);
    const action = slot >= 0 ? page.slots[slot] : undefined;
    const label = action ? ACTION_BY_ID.get(action)?.label : undefined;
    return label ? `${label} — ${page.label} action` : NOT_USED_IN_WORLD;
  };
  const role = (
    r: PadRole,
    job: string,
    panelJob?: string,
  ): ControllerMapNode => ({
    id: r,
    name: profile.labels[r].word,
    glyph: profile.labels[r].glyph,
    job,
    panelJob,
    buttonIndex: profile.indices[r],
    kind: "button",
  });

  const nodes: ControllerMapNode[] = [
    role("leftTrigger", "Step voice back"),
    role("rightTrigger", "Sprint — hold"),
    role("leftBumper", "Work the prompt you're standing at"),
    role("rightBumper", slotJob(profile.indices.rightBumper)),
    {
      id: "leftStick",
      name: "Left stick",
      job: "Move — walk and strafe",
      pressJob: "Sprint — hold",
      buttonIndex: profile.indices.leftStickPress,
      axes: [0, 1],
      kind: "stick",
    },
    {
      id: "rightStick",
      name: "Right stick",
      job: "Camera — look around",
      pressJob: "Claim the live moment",
      buttonIndex: profile.indices.rightStickPress,
      axes: [2, 3],
      kind: "stick",
    },
    role("dpadUp", slotJob(profile.indices.dpadUp), "Move the selection"),
    role("dpadRight", slotJob(profile.indices.dpadRight), "Move the selection"),
    role("dpadDown", slotJob(profile.indices.dpadDown), "Move the selection"),
    role("dpadLeft", slotJob(profile.indices.dpadLeft), "Move the selection"),
    role("leftFace", slotJob(profile.indices.leftFace)),
    role("topFace", "Switch view"),
    role("back", slotJob(profile.indices.back), "Go back / close the panel"),
    role(
      "confirm",
      "Jump — tap · step voice — hold",
      "Choose the selected control",
    ),
    role("leftMenu", "Switch action page — tap · full screen — hold"),
    role("rightMenu", "Photo mode"),
    {
      id: "guide",
      name: SYSTEM_NAMES[profile.family].guide,
      job: NOT_USED_IN_WORLD,
      buttonIndex: GUIDE_BUTTON_INDEX,
      kind: "system",
    },
    {
      id: "extra",
      name: SYSTEM_NAMES[profile.family].extra,
      job: NOT_USED_IN_WORLD,
      buttonIndex: EXTRA_BUTTON_INDEX,
      kind: "system",
    },
  ];

  /* The DualSense carries one more physical button the
   * browser never reports: mute, under the PS button. It is
   * drawn and honestly labelled; with no index it can never
   * light, and the map says why in the panel's footnote. The
   * DualShock has no such button, so the name decides. */
  if (profile.family === "playstation" && profile.displayName.includes("DualSense")) {
    nodes.push({
      id: "mute",
      name: "Mute button",
      job: NOT_USED_IN_WORLD,
      buttonIndex: null,
      kind: "system",
    });
  }
  return nodes;
}

/**
 * The nodes lit by the pad RIGHT NOW — the live highlight's
 * whole mechanism, pure so the census can pin it per family:
 * a node lights when its button is physically pressed, and a
 * stick node also lights while its stick is pushed past the
 * threshold. Indices resolve through the nodes themselves
 * (which took them from the profile), so the highlight can
 * never point at a different button than the label names.
 */
export function litNodeIds(
  pad: GamepadLike | null | undefined,
  nodes: readonly ControllerMapNode[],
): ReadonlySet<string> {
  const lit = new Set<string>();
  if (!pad) return lit;
  for (const node of nodes) {
    if (node.buttonIndex !== null && pad.buttons[node.buttonIndex]?.pressed) {
      lit.add(node.id);
      continue;
    }
    if (node.axes) {
      const x = pad.axes[node.axes[0]] ?? 0;
      const y = pad.axes[node.axes[1]] ?? 0;
      if (x * x + y * y > MAP_STICK_LIGHT_THRESHOLD * MAP_STICK_LIGHT_THRESHOLD) {
        lit.add(node.id);
      }
    }
  }
  return lit;
}

/* ── The pictures ───────────────────────────────────────────
 * One schematic per family: a body outline and a seat for
 * every node id. Schematic on purpose — the shapes teach the
 * hand (the DualSense's touchpad slab and low symmetric
 * sticks, the Xbox pad's high left stick, the Switch Pro's
 * rotated face letters are positions, which the seats carry)
 * without pretending to be product renders. */

export type ControllerMapSpotShape = "circle" | "rect" | "stick" | "dpadCell";

export interface ControllerMapSpot {
  x: number;
  y: number;
  shape: ControllerMapSpotShape;
  /** Circle / stick radius, or rect corner radius. */
  r: number;
  /** Rect width / height (rect and dpadCell shapes). */
  w?: number;
  h?: number;
}

export interface ControllerMapLayout {
  viewBox: string;
  bodyPath: string;
  spots: Readonly<Record<string, ControllerMapSpot>>;
}

const circle = (x: number, y: number, r: number): ControllerMapSpot => ({
  x,
  y,
  shape: "circle",
  r,
});
const rect = (x: number, y: number, w: number, h: number, r = 6): ControllerMapSpot => ({
  x,
  y,
  shape: "rect",
  r,
  w,
  h,
});
const stick = (x: number, y: number): ControllerMapSpot => ({
  x,
  y,
  shape: "stick",
  r: 27,
});
const dpadCells = (
  cx: number,
  cy: number,
): Record<"dpadUp" | "dpadRight" | "dpadDown" | "dpadLeft", ControllerMapSpot> => ({
  dpadUp: { x: cx, y: cy - 27, shape: "dpadCell", r: 3, w: 25, h: 27 },
  dpadRight: { x: cx + 27, y: cy, shape: "dpadCell", r: 3, w: 27, h: 25 },
  dpadDown: { x: cx, y: cy + 27, shape: "dpadCell", r: 3, w: 25, h: 27 },
  dpadLeft: { x: cx - 27, y: cy, shape: "dpadCell", r: 3, w: 27, h: 25 },
});
const faceDiamond = (
  cx: number,
  cy: number,
): Record<"topFace" | "back" | "confirm" | "leftFace", ControllerMapSpot> => ({
  topFace: circle(cx, cy - 37, 16),
  back: circle(cx + 37, cy, 16),
  confirm: circle(cx, cy + 37, 16),
  leftFace: circle(cx - 37, cy, 16),
});

export const CONTROLLER_MAP_LAYOUTS: Readonly<
  Record<ControllerFamily, ControllerMapLayout>
> = {
  playstation: {
    viewBox: "0 0 720 360",
    bodyPath:
      "M168 84 H552 C596 84 624 112 632 154 L644 232 C647 258 634 276 612 274 C590 272 578 252 566 226 L550 188 H170 L154 226 C142 252 130 272 108 274 C86 276 73 258 76 232 L88 154 C96 112 124 84 168 84 Z",
    spots: {
      leftTrigger: rect(186, 42, 68, 18, 8),
      rightTrigger: rect(534, 42, 68, 18, 8),
      leftBumper: rect(192, 67, 76, 20, 9),
      rightBumper: rect(528, 67, 76, 20, 9),
      extra: rect(360, 118, 118, 56, 10),
      leftMenu: circle(288, 100, 9),
      rightMenu: circle(432, 100, 9),
      guide: circle(360, 158, 11),
      mute: circle(360, 186, 6),
      ...dpadCells(172, 152),
      ...faceDiamond(548, 152),
      leftStick: stick(272, 224),
      rightStick: stick(448, 224),
    },
  },
  xbox: {
    viewBox: "0 0 720 360",
    bodyPath:
      "M176 88 C148 88 128 110 122 142 L108 224 C104 252 118 272 142 270 C164 268 176 250 186 226 L198 192 H522 L534 226 C544 250 556 268 578 270 C602 272 616 252 612 224 L598 142 C592 110 572 88 544 88 Z",
    spots: {
      leftTrigger: rect(196, 48, 68, 18, 8),
      rightTrigger: rect(524, 48, 68, 18, 8),
      leftBumper: rect(202, 73, 76, 20, 9),
      rightBumper: rect(518, 73, 76, 20, 9),
      guide: circle(360, 100, 12),
      extra: circle(360, 142, 8),
      leftMenu: circle(312, 128, 9),
      rightMenu: circle(408, 128, 9),
      leftStick: stick(232, 140),
      ...dpadCells(318, 216),
      ...faceDiamond(540, 146),
      rightStick: stick(428, 216),
    },
  },
  switch: {
    viewBox: "0 0 720 360",
    bodyPath:
      "M140 92 H580 C612 92 634 116 638 148 L644 214 C646 240 632 256 610 254 C588 252 576 236 566 214 L556 188 H164 L154 214 C144 236 132 252 110 254 C88 256 74 240 76 214 L82 148 C86 116 108 92 140 92 Z",
    spots: {
      leftTrigger: rect(180, 52, 68, 18, 8),
      rightTrigger: rect(540, 52, 68, 18, 8),
      leftBumper: rect(186, 77, 76, 20, 9),
      rightBumper: rect(534, 77, 76, 20, 9),
      leftMenu: circle(306, 116, 9),
      rightMenu: circle(414, 116, 9),
      guide: circle(378, 152, 10),
      extra: rect(342, 152, 17, 17, 4),
      leftStick: stick(196, 128),
      ...dpadCells(196, 220),
      ...faceDiamond(536, 140),
      rightStick: stick(440, 216),
    },
  },
  generic: {
    viewBox: "0 0 720 360",
    bodyPath:
      "M168 88 H552 C592 88 620 114 628 152 L638 228 C641 254 628 272 606 270 C585 268 573 250 562 226 L548 190 H172 L158 226 C147 250 135 268 114 270 C92 272 79 254 82 228 L92 152 C100 114 128 88 168 88 Z",
    spots: {
      leftTrigger: rect(186, 46, 68, 18, 8),
      rightTrigger: rect(534, 46, 68, 18, 8),
      leftBumper: rect(192, 70, 76, 20, 9),
      rightBumper: rect(528, 70, 76, 20, 9),
      leftMenu: circle(300, 106, 9),
      rightMenu: circle(420, 106, 9),
      guide: circle(360, 148, 10),
      extra: circle(360, 182, 8),
      ...dpadCells(172, 152),
      ...faceDiamond(548, 152),
      leftStick: stick(272, 222),
      rightStick: stick(448, 222),
    },
  },
};

/** The verb census the map must cover, restated for the
 *  tests from the same sources the jobs were read out of:
 *  every index the scene's verb poll reads, every action
 *  slot, every panel button, and both stick presses. */
export function controllerMapBoundIndices(profile: ControllerProfile): ReadonlySet<number> {
  const bound = new Set<number>();
  const verbs = padVerbIndices(profile);
  for (const idx of [
    verbs.jump,
    verbs.voiceBack,
    verbs.viewToggle,
    verbs.interact,
    verbs.pageCycle,
    verbs.photoMode,
    verbs.momentClaim,
    ...verbs.sprint,
    ...verbs.slots,
  ]) {
    bound.add(idx);
  }
  const panel = panelButtonsFor(profile);
  for (const idx of [panel.up, panel.down, panel.left, panel.right, panel.confirm, panel.back]) {
    bound.add(idx);
  }
  return bound;
}
