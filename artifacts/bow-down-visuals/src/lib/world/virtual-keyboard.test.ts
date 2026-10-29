import { describe, expect, it } from "vitest";
import type { GamepadLike } from "./gamepad";
import { IDLE_PANEL_PAD_EDGES, nextPanelFocusIndex, pollPanelPad, type PanelPadEdges } from "./panel-nav";
import {
  commitFieldEdit,
  computeFieldEdit,
  enterKeyBehaviour,
  enterKeyLabel,
  flattenVirtualKeys,
  isVirtualKeyboardFieldShape,
  setFieldValueNative,
  shouldSummonVirtualKeyboard,
  virtualKeyboardRows,
  type VirtualKey,
} from "./virtual-keyboard";

/* The in-World virtual keyboard (stack900) — the board the
 * owner's controller-first directive asked for: "when I'm
 * trying to text, a virtual keyboard or something should pop
 * up." These pins hold the pure half: the layout (one screen,
 * working keys that never move), the summon rule, which
 * fields may summon it, the edits its keys perform, and the
 * native-setter commit that keeps a React controlled field's
 * state truthful — capped by a composition test that drives
 * the REAL pad poll across the REAL layout into a field, the
 * way the component's usePanelPadNav does. */

const rows = (shift = false, layer: "letters" | "symbols" = "letters") =>
  virtualKeyboardRows({ layer, shift, enterLabel: "Send" });
const keyById = (list: VirtualKey[], id: string) => list.find((k) => k.id === id);

describe("virtual keyboard — the board", () => {
  it("one screen: digits, three letter rows, one working row — five rows, no paging", () => {
    const board = rows();
    expect(board).toHaveLength(5);
    expect(board[0].map((k) => k.label).join("")).toBe("1234567890");
    expect(board[1].map((k) => k.label).join("")).toBe("qwertyuiop");
    expect(board[2].map((k) => k.label).join("")).toBe("asdfghjkl");
    expect(board[3].map((k) => k.label).join("")).toBe("⇧zxcvbnm⌫");
    expect(board[4].map((k) => k.kind)).toEqual(["layer", "space", "enter", "close"]);
  });

  it("the working keys wear drawn glyphs, never controller button names", () => {
    const all = flattenVirtualKeys(rows());
    expect(keyById(all, "backspace")?.label).toBe("⌫");
    expect(keyById(all, "shift")?.label).toBe("⇧");
    expect(keyById(all, "close")?.label).toBe("✕");
    expect(keyById(all, "enter")?.label).toBe("Send");
    for (const k of all) {
      expect(k.label).not.toMatch(/cross|circle|square|triangle|button/i);
    }
  });

  it("shift uppercases letters only, and the symbols layer swaps letters for punctuation", () => {
    const shifted = flattenVirtualKeys(rows(true));
    expect(keyById(shifted, "char-q")?.char).toBe("Q");
    expect(keyById(shifted, "char-1")?.char).toBe("1");
    const symbols = flattenVirtualKeys(rows(false, "symbols"));
    expect(keyById(symbols, "char-@")?.char).toBe("@");
    expect(keyById(symbols, "char-q")).toBeUndefined();
    expect(keyById(symbols, "layer")?.label).toBe("ABC");
    /* The working row never moves between layers. */
    expect(symbols.slice(-4).map((k) => k.kind)).toEqual(["layer", "space", "enter", "close"]);
  });

  it("the Enter key says what it will do, per field", () => {
    expect(enterKeyLabel("chat")).toBe("Send");
    expect(enterKeyLabel("search")).toBe("Search");
    expect(enterKeyLabel("text")).toBe("Enter");
    expect(enterKeyBehaviour("chat")).toBe("submit");
    expect(enterKeyBehaviour("search")).toBe("submit");
    expect(enterKeyBehaviour("multiline")).toBe("newline");
  });
});

describe("virtual keyboard — who may summon it, and when", () => {
  it("text fields and textareas qualify; control fields do not", () => {
    expect(isVirtualKeyboardFieldShape({ tagName: "TEXTAREA" })).toBe(true);
    expect(isVirtualKeyboardFieldShape({ tagName: "INPUT", type: "text" })).toBe(true);
    expect(isVirtualKeyboardFieldShape({ tagName: "INPUT", type: "" })).toBe(true);
    expect(isVirtualKeyboardFieldShape({ tagName: "INPUT", type: "search" })).toBe(true);
    expect(isVirtualKeyboardFieldShape({ tagName: "INPUT", type: "email" })).toBe(true);
    for (const type of ["checkbox", "radio", "file", "number", "date", "range", "hidden", "submit"]) {
      expect(isVirtualKeyboardFieldShape({ tagName: "INPUT", type })).toBe(false);
    }
    expect(isVirtualKeyboardFieldShape({ tagName: "INPUT", type: "text", disabled: true })).toBe(false);
    expect(isVirtualKeyboardFieldShape({ tagName: "TEXTAREA", readOnly: true })).toBe(false);
    expect(isVirtualKeyboardFieldShape({ tagName: "SELECT" })).toBe(false);
    expect(isVirtualKeyboardFieldShape({ tagName: "BUTTON" })).toBe(false);
  });

  it("the summon rule is exactly the two no-keyboard states", () => {
    expect(shouldSummonVirtualKeyboard({ padConnected: true, fullscreen: false })).toBe(true);
    expect(shouldSummonVirtualKeyboard({ padConnected: false, fullscreen: true })).toBe(true);
    expect(shouldSummonVirtualKeyboard({ padConnected: true, fullscreen: true })).toBe(true);
    expect(shouldSummonVirtualKeyboard({ padConnected: false, fullscreen: false })).toBe(false);
  });
});

describe("virtual keyboard — the edits", () => {
  const at = (value: string, start: number, end = start) => ({ value, selectionStart: start, selectionEnd: end });

  it("an insert lands at the caret and replaces any selection", () => {
    expect(computeFieldEdit(at("helo", 2), { type: "insert", text: "l" })).toEqual(at("hello", 3));
    expect(computeFieldEdit(at("hello world", 0, 5), { type: "insert", text: "hey" })).toEqual(at("hey world", 3));
    expect(computeFieldEdit(at("", 0), { type: "insert", text: " " })).toEqual(at(" ", 1));
    expect(computeFieldEdit(at("ab", 1), { type: "insert", text: "\n" })).toEqual(at("a\nb", 2));
  });

  it("backspace deletes the selection, else the character before the caret, else nothing", () => {
    expect(computeFieldEdit(at("hello", 5), { type: "backspace" })).toEqual(at("hell", 4));
    expect(computeFieldEdit(at("hello", 1, 4), { type: "backspace" })).toEqual(at("ho", 1));
    const start = at("hello", 0);
    expect(computeFieldEdit(start, { type: "backspace" })).toBe(start);
  });

  it("the field's own maxLength trims the insert to what fits", () => {
    expect(computeFieldEdit(at("abc", 3), { type: "insert", text: "def" }, 5)).toEqual(at("abcde", 5));
    const full = at("abcde", 5);
    expect(computeFieldEdit(full, { type: "insert", text: "x" }, 5)).toBe(full);
    /* Replacing a selection frees its room first. */
    expect(computeFieldEdit(at("abcde", 0, 2), { type: "insert", text: "XYZ" }, 5)).toEqual(at("XYcde", 2));
  });
});

/* A field element double that models the one behaviour the
 * commit exists for. The class accessors below are the
 * PROTOTYPE value path — the real element's own setter. The
 * constructor then installs an instance-level descriptor over
 * it: React's change tracker, which is exactly that shape on
 * a real input. A plain assignment writes through the tracker
 * (tracker and DOM agree → the input event is swallowed as
 * no-change); the prototype setter writes under it (the event
 * then reads as a genuine change, and the tracker catches up
 * through the change itself). */
class FakeField {
  _dom = "";
  _tracked = "";
  selectionStart: number | null = 0;
  selectionEnd: number | null = 0;
  selectionCalls: Array<[number, number]> = [];
  changes: string[] = [];
  constructor() {
    Object.defineProperty(this, "value", {
      configurable: true,
      get: () => this._dom,
      set: (v: string) => {
        this._tracked = v;
        this._dom = v;
      },
    });
  }
  get value(): string {
    return this._dom;
  }
  set value(v: string) {
    this._dom = v;
  }
  setSelectionRange(start: number, end: number) {
    this.selectionCalls.push([start, end]);
    this.selectionStart = start;
    this.selectionEnd = end;
  }
  dispatchEvent(event: unknown): boolean {
    const type = (event as { type?: string }).type;
    if (type === "input" && this._tracked !== this._dom) {
      this._tracked = this._dom;
      this.changes.push(this._dom);
    }
    return true;
  }
}

describe("virtual keyboard — the commit keeps React state truthful", () => {
  it("a plain assignment is swallowed by the tracker (the trap, proven on the double)", () => {
    const plain = new FakeField();
    plain.value = "typed";
    plain.dispatchEvent({ type: "input" });
    expect(plain.changes).toEqual([]);
  });

  it("commitFieldEdit lands the value, the caret and the change", () => {
    const field = new FakeField();
    setFieldValueNative(field, "he");
    expect(field.value).toBe("he");
    commitFieldEdit(
      field,
      { value: "hey", selectionStart: 3, selectionEnd: 3 },
      () => ({ type: "input" }),
    );
    expect(field.value).toBe("hey");
    expect(field.changes).toEqual(["hey"]);
    expect(field.selectionCalls).toEqual([[3, 3]]);
  });
});

/* The pad composition: the real poll (panel-nav) walking the
 * real layout into a field — the same loop usePanelPadNav
 * runs, at the level vitest's node environment can prove. */
function pad(buttonsDown: number[] = []): GamepadLike {
  return {
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: buttonsDown.includes(i) })),
    axes: [0, 0],
  };
}

describe("virtual keyboard — the pad types on it", () => {
  it("D-pad walks the keys, A types, ⇧ cases one letter, ⌫ deletes", () => {
    let shift = false;
    let field = { value: "", selectionStart: 0, selectionEnd: 0 };
    let edges: PanelPadEdges = IDLE_PANEL_PAD_EDGES;
    let focus = 0; /* the pad hook's standing-in seat: the first key */

    const keys = () => flattenVirtualKeys(rows(shift));
    const press = (buttons: number[]) => {
      const polled = pollPanelPad(pad(buttons), edges);
      edges = polled.edges;
      return polled.intent;
    };
    const release = () => {
      edges = pollPanelPad(pad([]), edges).edges;
    };
    const walkTo = (id: string) => {
      const targetIndex = keys().findIndex((k) => k.id === id);
      expect(targetIndex).toBeGreaterThanOrEqual(0);
      let guard = 0;
      while (focus !== targetIndex && guard++ < 200) {
        const intent = press([15]); /* D-pad right: forward */
        release();
        focus = nextPanelFocusIndex(focus, keys().length, intent.move);
      }
      expect(focus).toBe(targetIndex);
    };
    const confirm = () => {
      const intent = press([0]); /* A */
      release();
      expect(intent.confirm).toBe(true);
      const key = keys()[focus];
      if (key.kind === "shift") shift = !shift;
      else if (key.kind === "char") {
        field = computeFieldEdit(field, { type: "insert", text: key.char ?? "" });
        if (shift) shift = false;
      } else if (key.kind === "space") {
        field = computeFieldEdit(field, { type: "insert", text: " " });
        if (shift) shift = false;
      } else if (key.kind === "backspace") {
        field = computeFieldEdit(field, { type: "backspace" });
      }
    };

    walkTo("shift");
    confirm();
    walkTo("char-h");
    confirm();
    expect(field.value).toBe("H");
    walkTo("char-i");
    confirm();
    expect(field.value).toBe("Hi");
    walkTo("backspace");
    confirm();
    expect(field.value).toBe("H");
    /* B is the way out: the poll speaks it as `back`, which the
     * hook hands to the board's close — ownership returns. */
    const out = press([1]);
    release();
    expect(out.back).toBe(true);
  });
});
