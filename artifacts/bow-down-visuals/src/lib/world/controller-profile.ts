/**
 * controller-profile.ts — the World speaks the language of the
 * controller actually in the player's hand (stack900, owner's
 * directive 2026-10-29: "On the virtual world, it should match
 * the controller I'm using, and I'm using a PS5 controller").
 *
 * Until this module, every pad prompt the World painted was
 * Xbox-flavoured — A, B, LB, Back, Start — because the first
 * pad work (stack600/700) was written against an Xbox pad. The
 * owner plays on a DualSense: his confirm button is named
 * Cross, his prompt button is L1, his fullscreen hold sits on
 * Create. The buttons never moved — the standard mapping is
 * positional, and every family Chrome-class browsers report
 * (DualSense, DualShock, Xbox, Switch Pro) arrives with
 * mapping "standard", so index 0 is the bottom face button on
 * all of them — but the NAMES were another controller's names.
 *
 * This module is the one place the naming lives:
 *
 *   classifyGamepadId(id) — the pad's `id` string (the only
 *     identity the Gamepad API offers) sorts into a family and
 *     a plain-words display name ("PS5 DualSense"). Chrome
 *     spells ids "DualSense Wireless Controller (Vendor: 054c
 *     Product: 0ce6)"; Firefox spells them "054c-0ce6-…". Both
 *     shapes are read. PlayStation is checked FIRST on
 *     purpose: the DualShock's own name is the generic-looking
 *     "Wireless Controller", and an Xbox-first order would
 *     never see the Sony vendor string behind it.
 *
 *   labels — per family, the name of every button ROLE the
 *     World talks about. PlayStation face buttons carry their
 *     glyphs (✕ ○ □ △) beside the words, for the surfaces that
 *     draw shapes; copy takes the words. The Switch table is
 *     the one honest rotation: Nintendo prints B at the bottom
 *     position and A at the right, so a Switch profile's
 *     confirm WORD is "B" — the index never changes, only the
 *     name bolted onto the position. The generic fallback
 *     names positions, never letters ("bottom button"), so an
 *     unknown pad is never lied to with another family's names.
 *
 *   indices — ONE positional table for every family
 *     (PAD_ROLE_INDEX). There is deliberately no per-family
 *     index table: under the standard mapping there is no
 *     index difference to encode, and inventing one would
 *     break working pads. Consumers resolve buttons THROUGH
 *     the profile (pollGamepad's profile argument, panel-nav's
 *     buttons argument via panelButtonsFor) so if a family
 *     ever does diverge, the divergence lands here, once.
 *
 *   the store — getControllerProfile / subscribeController
 *     Profile / refreshControllerProfile: a tiny observable
 *     the React hook (src/hooks/use-controller-profile.ts)
 *     drives from gamepadconnected/disconnected plus a slow
 *     id poll (a pad's id is only readable once the pad wakes,
 *     and a different pad can take the first slot mid-session;
 *     the poll is what notices). The scene's frame loop does
 *     not subscribe — it classifies the pad it already holds,
 *     per frame, through controllerProfileFromPad (memoised
 *     on the id string).
 */

export type ControllerFamily = "playstation" | "xbox" | "switch" | "generic";

/** Every button the World's copy or polls ever name, by the
 *  job it does — never by a family's letter. */
export type PadRole =
  | "confirm"
  | "back"
  | "leftFace"
  | "topFace"
  | "leftBumper"
  | "rightBumper"
  | "leftTrigger"
  | "rightTrigger"
  | "leftMenu"
  | "rightMenu"
  | "leftStickPress"
  | "rightStickPress"
  | "dpadUp"
  | "dpadDown"
  | "dpadLeft"
  | "dpadRight";

export interface PadButtonLabel {
  /** The name copy speaks: "Cross", "A", "bottom button". */
  word: string;
  /** The drawn shape, where the family has one (PlayStation's
   *  face buttons). Surfaces that draw shapes take this;
   *  sentences take the word. */
  glyph?: string;
}

export interface ControllerProfile {
  family: ControllerFamily;
  /** The pad's name in plain words, for the help line and the
   *  fullscreen chip: "PS5 DualSense", "Xbox controller". */
  displayName: string;
  /** The raw gamepad id this profile was classified from;
   *  null when no pad is connected (the generic profile). */
  gamepadId: string | null;
  labels: Readonly<Record<PadRole, PadButtonLabel>>;
  /** Role → standard-mapping button index. One table for
   *  every family today (see the header); it rides on the
   *  profile so resolution always passes through here. */
  indices: Readonly<Record<PadRole, number>>;
}

/** The standard mapping, by role: the W3C gamepad layout every
 *  family in the classifier reports. Index 0 is the bottom
 *  face button on a DualSense, an Xbox pad and a Switch Pro
 *  alike — positions are the API's contract; names are not. */
export const PAD_ROLE_INDEX: Readonly<Record<PadRole, number>> = {
  confirm: 0,
  back: 1,
  leftFace: 2,
  topFace: 3,
  leftBumper: 4,
  rightBumper: 5,
  leftTrigger: 6,
  rightTrigger: 7,
  leftMenu: 8,
  rightMenu: 9,
  leftStickPress: 10,
  rightStickPress: 11,
  dpadUp: 12,
  dpadDown: 13,
  dpadLeft: 14,
  dpadRight: 15,
};

const DPAD_LABELS: Pick<Record<PadRole, PadButtonLabel>, "dpadUp" | "dpadDown" | "dpadLeft" | "dpadRight"> = {
  dpadUp: { word: "D-pad up" },
  dpadDown: { word: "D-pad down" },
  dpadLeft: { word: "D-pad left" },
  dpadRight: { word: "D-pad right" },
};

function playstationLabels(leftMenuWord: "Create" | "Share"): Record<PadRole, PadButtonLabel> {
  return {
    confirm: { word: "Cross", glyph: "✕" },
    back: { word: "Circle", glyph: "○" },
    leftFace: { word: "Square", glyph: "□" },
    topFace: { word: "Triangle", glyph: "△" },
    leftBumper: { word: "L1" },
    rightBumper: { word: "R1" },
    leftTrigger: { word: "L2" },
    rightTrigger: { word: "R2" },
    leftMenu: { word: leftMenuWord },
    rightMenu: { word: "Options" },
    leftStickPress: { word: "L3" },
    rightStickPress: { word: "R3" },
    ...DPAD_LABELS,
  };
}

const XBOX_LABELS: Record<PadRole, PadButtonLabel> = {
  confirm: { word: "A" },
  back: { word: "B" },
  leftFace: { word: "X" },
  topFace: { word: "Y" },
  leftBumper: { word: "LB" },
  rightBumper: { word: "RB" },
  leftTrigger: { word: "LT" },
  rightTrigger: { word: "RT" },
  leftMenu: { word: "View" },
  rightMenu: { word: "Menu" },
  leftStickPress: { word: "LS" },
  rightStickPress: { word: "RS" },
  ...DPAD_LABELS,
};

/* Nintendo's printing, honestly rotated: the button AT the
 * confirm position is lettered B on a Switch Pro, the one at
 * the back position is lettered A. The positions (and so the
 * indices) are the standard mapping's; only the names turn. */
const SWITCH_LABELS: Record<PadRole, PadButtonLabel> = {
  confirm: { word: "B" },
  back: { word: "A" },
  leftFace: { word: "Y" },
  topFace: { word: "X" },
  leftBumper: { word: "L" },
  rightBumper: { word: "R" },
  leftTrigger: { word: "ZL" },
  rightTrigger: { word: "ZR" },
  leftMenu: { word: "−", glyph: "−" },
  rightMenu: { word: "+", glyph: "+" },
  leftStickPress: { word: "left stick press" },
  rightStickPress: { word: "right stick press" },
  ...DPAD_LABELS,
};

/* No family claimed this pad: name the POSITIONS. An unknown
 * pad told "press bottom button" can always find its button;
 * told "press A" it is being handed a stranger's controller. */
const GENERIC_LABELS: Record<PadRole, PadButtonLabel> = {
  confirm: { word: "bottom button" },
  back: { word: "right button" },
  leftFace: { word: "left button" },
  topFace: { word: "top button" },
  leftBumper: { word: "left bumper" },
  rightBumper: { word: "right bumper" },
  leftTrigger: { word: "left trigger" },
  rightTrigger: { word: "right trigger" },
  leftMenu: { word: "left menu button" },
  rightMenu: { word: "right menu button" },
  leftStickPress: { word: "left stick press" },
  rightStickPress: { word: "right stick press" },
  ...DPAD_LABELS,
};

function makeProfile(
  family: ControllerFamily,
  displayName: string,
  gamepadId: string | null,
  labels: Record<PadRole, PadButtonLabel>,
): ControllerProfile {
  return { family, displayName, gamepadId, labels, indices: PAD_ROLE_INDEX };
}

/** The standing profile when no pad is connected (or none has
 *  been classified yet): generic names, no id. The help line
 *  never renders from it — it stands only while padConnected
 *  is false — but every consumer can read it safely. */
export const GENERIC_CONTROLLER_PROFILE: ControllerProfile = makeProfile(
  "generic",
  "Controller",
  null,
  GENERIC_LABELS,
);

/* Vendor ids as they appear inside gamepad id strings:
 * Chrome "(Vendor: 054c Product: 0ce6)", Firefox "054c-0ce6-…". */
const VENDOR_SONY = "054c";
const VENDOR_MICROSOFT = "045e";
const VENDOR_NINTENDO = "057e";

function hasVendor(lowerId: string, vendor: string): boolean {
  return lowerId.includes(`vendor: ${vendor}`) || lowerId.startsWith(`${vendor}-`);
}

/**
 * Sort a gamepad `id` string into its family profile. The
 * order of the checks is load-bearing (see the header):
 * PlayStation first, because the DualShock calls itself
 * "Wireless Controller"; the Sony vendor string is what
 * tells it apart from every other wireless pad.
 */
export function classifyGamepadId(id: string | null | undefined): ControllerProfile {
  const raw = typeof id === "string" ? id.trim() : "";
  if (!raw) return GENERIC_CONTROLLER_PROFILE;
  const lower = raw.toLowerCase();

  if (lower.includes("dualsense")) {
    return makeProfile("playstation", "PS5 DualSense", raw, playstationLabels("Create"));
  }
  if (lower.includes("dualshock")) {
    return makeProfile("playstation", "PS4 DualShock 4", raw, playstationLabels("Share"));
  }
  if (hasVendor(lower, VENDOR_SONY) || lower.includes("sony")) {
    /* The DualShock 4's product ids (05c4, 09cc) and its bare
     * name both mean the PS4 pad — its small left button is
     * Share, not Create. Anything else Sony is a PlayStation
     * pad of the current shape until named otherwise. */
    if (lower.includes("05c4") || lower.includes("09cc") || lower.includes("wireless controller")) {
      return makeProfile("playstation", "PS4 DualShock 4", raw, playstationLabels("Share"));
    }
    return makeProfile("playstation", "PlayStation controller", raw, playstationLabels("Create"));
  }
  if (lower === "wireless controller") {
    /* The DualShock 4's legacy bare name, from browsers that
     * report no vendor: it has only ever been this pad. */
    return makeProfile("playstation", "PS4 DualShock 4", raw, playstationLabels("Share"));
  }
  if (lower.includes("xbox") || hasVendor(lower, VENDOR_MICROSOFT)) {
    return makeProfile(
      "xbox",
      lower.includes("360") ? "Xbox 360 controller" : "Xbox controller",
      raw,
      XBOX_LABELS,
    );
  }
  if (hasVendor(lower, VENDOR_NINTENDO) || lower.includes("joy-con") || lower.includes("nintendo")) {
    return makeProfile(
      "switch",
      lower.includes("joy-con") ? "Nintendo Switch Joy-Con" : "Switch Pro Controller",
      raw,
      SWITCH_LABELS,
    );
  }
  return makeProfile("generic", "Controller", raw, GENERIC_LABELS);
}

let memoId: string | null | undefined;
let memoProfile: ControllerProfile | null = null;

/** The profile for a pad object (anything carrying an `id`).
 *  Memoised on the id string — the scene asks every frame and
 *  classification is string work; a pad swap changes the id
 *  and re-classifies on the next ask. */
export function controllerProfileFromPad(
  pad: { id?: string | null } | null | undefined,
): ControllerProfile {
  const id = pad?.id ?? null;
  if (memoProfile !== null && memoId === id) return memoProfile;
  const profile = classifyGamepadId(id);
  memoId = id;
  memoProfile = profile;
  return profile;
}

/** The word a prompt speaks for a role on this profile. */
export function padWord(profile: ControllerProfile, role: PadRole): string {
  return profile.labels[role].word;
}

/** The button index a role sits on, resolved through the
 *  profile (the one table today — see the header). */
export function padButtonIndex(profile: ControllerProfile, role: PadRole): number {
  return profile.indices[role];
}

/** The scene poll's working set, resolved from a profile:
 *  bindings.ts jobs restated as roles. `slots` is in
 *  bindings.PAD_SLOTS order (D-pad ↑ → ↓ ←, left face, back,
 *  right bumper) — the action pages read by position. */
export interface PadVerbIndices {
  jump: number;
  voiceBack: number;
  viewToggle: number;
  interact: number;
  pageCycle: number;
  photoMode: number;
  momentClaim: number;
  sprint: readonly number[];
  slots: readonly number[];
}

export function padVerbIndices(profile: ControllerProfile): PadVerbIndices {
  const i = profile.indices;
  return {
    jump: i.confirm,
    voiceBack: i.leftTrigger,
    viewToggle: i.topFace,
    interact: i.leftBumper,
    pageCycle: i.leftMenu,
    photoMode: i.rightMenu,
    momentClaim: i.rightStickPress,
    sprint: [i.rightTrigger, i.leftStickPress],
    slots: [i.dpadUp, i.dpadRight, i.dpadDown, i.dpadLeft, i.leftFace, i.back, i.rightBumper],
  };
}

/** The panel poll's working set, resolved from a profile —
 *  panel-nav's button table in role terms. */
export function panelButtonsFor(profile: ControllerProfile): {
  up: number;
  down: number;
  left: number;
  right: number;
  confirm: number;
  back: number;
} {
  const i = profile.indices;
  return {
    up: i.dpadUp,
    down: i.dpadDown,
    left: i.dpadLeft,
    right: i.dpadRight,
    confirm: i.confirm,
    back: i.back,
  };
}

/* ── The reactive store ─────────────────────────────────────
 * One active profile for the page. The hook refreshes it on
 * connect/disconnect and on a slow poll; consumers read the
 * snapshot. Change is judged on the id + family, so a steady
 * pad never re-renders the page once a second. */

let activeProfile: ControllerProfile = GENERIC_CONTROLLER_PROFILE;
const profileListeners = new Set<() => void>();

export function getControllerProfile(): ControllerProfile {
  return activeProfile;
}

export function subscribeControllerProfile(listener: () => void): () => void {
  profileListeners.add(listener);
  return () => {
    profileListeners.delete(listener);
  };
}

/** Re-read the browser's pad list and adopt the first pad's
 *  profile — the SAME first pad the scene polls for input, so
 *  the pad that drives is always the pad that names. Returns
 *  the active profile; notifies only on a real change. */
export function refreshControllerProfile(): ControllerProfile {
  let next: ControllerProfile = GENERIC_CONTROLLER_PROFILE;
  try {
    const pads =
      typeof navigator !== "undefined" ? (navigator.getGamepads?.() ?? []) : [];
    for (const pad of pads) {
      if (pad) {
        next = controllerProfileFromPad(pad);
        break;
      }
    }
  } catch {
    /* no gamepad API — the generic profile stands */
  }
  if (next.gamepadId !== activeProfile.gamepadId || next.family !== activeProfile.family) {
    activeProfile = next;
    for (const listener of [...profileListeners]) listener();
  }
  return activeProfile;
}
