/**
 * The binding table (lib/world/bindings) — pinned so the layout
 * can never quietly rot: every controller input has exactly one
 * job, every action can be reached from pad, keyboard and deck,
 * page 1 is the layout that shipped (muscle memory is a
 * contract), and the role gates hold for every input family.
 */
import { describe, it, expect } from "vitest";
import { WORLD_ACTIONS } from "./actions";
import {
  ACTION_PAGES,
  PAD_SLOTS,
  PAD_SPRINT_BUTTONS,
  PAD_VERBS,
  PAD_JUMP_BUTTON,
  PAD_VOICE_LONG_PRESS_MS,
  PAD_MENU_BUTTON,
  PAD_PHOTO_LONG_PRESS_MS,
  KEY_VERBS,
  actionForPadButton,
  padButtonForAction,
  actionForSlot,
  actionForKey,
  pageForAction,
  nextActionPage,
  verbRoleOk,
  actionRoleOk,
  type WorldVerb,
} from "./bindings";

/** The layout that shipped before paging existed — gamepad.ts's
 *  original ACTION_BUTTONS, in its priority order. */
const LEGACY_PAD_MAP: ReadonlyArray<readonly [number, string]> = [
  [12, "bow"],
  [15, "cheer"],
  [13, "sit"],
  [14, "wave"],
  [2, "clap"],
  [1, "dance"],
  [5, "spin"],
];

describe("the paged action table", () => {
  it("covers every action exactly once across the pages", () => {
    const placed = ACTION_PAGES.flatMap((p) => [...p.slots]);
    expect(placed).toHaveLength(WORLD_ACTIONS.length);
    expect(new Set(placed).size).toBe(placed.length);
    expect(new Set(placed)).toEqual(new Set(WORLD_ACTIONS.map((a) => a.id)));
    for (const page of ACTION_PAGES) expect(page.slots).toHaveLength(PAD_SLOTS.length);
  });

  it("page 1 is byte-identical to the shipped pad layout", () => {
    for (const [button, id] of LEGACY_PAD_MAP) {
      expect(actionForPadButton("perform", button)).toBe(id);
    }
  });

  it("every action resolves from pad, digit key and deck slot alike", () => {
    for (const def of WORLD_ACTIONS) {
      const home = padButtonForAction(def.id);
      expect(home).not.toBeNull();
      const page = home!.page;
      const slot = PAD_SLOTS.indexOf(home!.button);
      expect(actionForSlot(page, slot)).toBe(def.id);
      expect(actionForKey(page, `Digit${slot + 1}`)).toBe(def.id);
      expect(pageForAction(def.id)).toBe(page);
    }
    expect(actionForKey("perform", "Digit8")).toBeNull();
    expect(actionForKey("perform", "KeyW")).toBeNull();
    expect(actionForPadButton("perform", 0)).toBeNull();
  });

  it("pages cycle perform → social → perform", () => {
    expect(nextActionPage("perform")).toBe("social");
    expect(nextActionPage("social")).toBe("perform");
  });
});

describe("one input, one job", () => {
  it("no standard button is claimed twice across verbs, slots and sprint", () => {
    const claimed = new Map<number, string>();
    for (const [btn, verb] of Object.entries(PAD_VERBS)) claimed.set(Number(btn), `verb:${verb}`);
    for (const btn of PAD_SLOTS) {
      expect(claimed.has(btn), `slot button ${btn} already claimed by ${claimed.get(btn)}`).toBe(false);
      claimed.set(btn, "slot");
    }
    for (const btn of PAD_SPRINT_BUTTONS) {
      expect(claimed.has(btn), `sprint button ${btn} already claimed`).toBe(false);
      claimed.set(btn, "sprint");
    }
    // The full standard face of the pad: 0..15 minus the two
    // sticks' axes — every indexed button is accounted for, and
    // Guide (16) is deliberately NOT among them (OS-reserved).
    expect(claimed.has(16)).toBe(false);
    expect(claimed.size).toBe(16);
    /* The jump (stack300) claims NO seventeenth button: it
     *  shares A with voiceStep by gesture — tap jumps, the
     *  long-press steps voice — so A's claim stays the voice
     *  verb's and the face stays exactly sixteen. */
    expect(PAD_JUMP_BUTTON).toBe(0);
    expect(claimed.get(PAD_JUMP_BUTTON)).toBe("verb:voiceStep");
    expect(PAD_VOICE_LONG_PRESS_MS).toBeGreaterThan(0);
    /* The settings toggle (stack900) claims NO seventeenth
     *  button either: it shares Start with photoMode by
     *  gesture — tap opens the settings, the long-press frames
     *  the photo — so Start's claim stays the photo verb's and
     *  the face stays exactly sixteen. */
    expect(PAD_MENU_BUTTON).toBe(9);
    expect(claimed.get(PAD_MENU_BUTTON)).toBe("verb:photoMode");
    expect(PAD_PHOTO_LONG_PRESS_MS).toBeGreaterThan(0);
  });

  it("keyboard verbs never collide with the digit slots or movement", () => {
    for (const code of Object.keys(KEY_VERBS)) {
      expect(code).not.toMatch(/^Digit/);
      expect(["KeyW", "KeyA", "KeyS", "KeyD"]).not.toContain(code);
    }
    /* Space is the keyboard's jump (stack300). */
    expect(KEY_VERBS["Space"]).toBe("jump");
  });

  it("the table carries no punishment verb for any role", () => {
    const verbs = new Set<WorldVerb>([...Object.values(PAD_VERBS), ...Object.values(KEY_VERBS)]);
    for (const v of verbs) expect(v).not.toMatch(/mute|remove|kick|lock|herald|admin/i);
  });
});

describe("role gates", () => {
  it("guests keep looking (photo, view) and nothing that performs, speaks, opens or claims", () => {
    expect(verbRoleOk("photoMode", "guest")).toBe(true);
    expect(verbRoleOk("viewToggle", "guest")).toBe(true);
    /* The jump is moving, not performing — guests walk, hurry
     *  and jump (stack300). */
    expect(verbRoleOk("jump", "guest")).toBe(true);
    expect(verbRoleOk("jump", "member")).toBe(true);
    /* Fullscreen is a view state like photo mode — guests keep
     *  it (stack700): a guest on a controller can always get
     *  their screen back. */
    expect(verbRoleOk("fullscreen", "guest")).toBe(true);
    expect(verbRoleOk("fullscreen", "member")).toBe(true);
    expect(verbRoleOk("fullscreen", "admin")).toBe(true);
    /* The settings toggle is a looking verb too (stack900):
     *  the settings panel is device settings and help, its
     *  door chip already serves guests, so the pad's road to
     *  the same panel serves them as well. */
    expect(verbRoleOk("settingsToggle", "guest")).toBe(true);
    expect(verbRoleOk("settingsToggle", "member")).toBe(true);
    expect(verbRoleOk("settingsToggle", "admin")).toBe(true);
    for (const verb of ["voiceStep", "voiceBack", "interact", "pageCycle", "momentClaim"] as WorldVerb[]) {
      expect(verbRoleOk(verb, "guest")).toBe(false);
      expect(verbRoleOk(verb, "member")).toBe(true);
      expect(verbRoleOk(verb, "admin")).toBe(true);
    }
    expect(actionRoleOk("guest")).toBe(false);
    expect(actionRoleOk("member")).toBe(true);
    expect(actionRoleOk("admin")).toBe(true);
  });
});
