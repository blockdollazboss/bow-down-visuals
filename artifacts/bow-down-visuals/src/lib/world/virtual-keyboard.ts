/**
 * The in-World virtual keyboard — the pure half (stack900).
 *
 * The owner's directive, from his controller-first life in the
 * World (2026-10-29): "when I'm trying to text, a virtual
 * keyboard or something should pop up." Inside the World — above
 * all in fullscreen, pad in hand — focusing a text field gave
 * the walker no way to type at all: the panels are DOM, the
 * scene's pad poll speaks only avatar, and no on-screen board
 * existed. The room chat, the herald, every desk's search and
 * name fields — all of them dead ends for a pad walker.
 *
 * This module is the board's brain, kept pure the way
 * panel-nav.ts is: the layout (one screen, two layers, no
 * paging maze — NOTHING DIFFICULT), which fields may summon it,
 * when it may summon (a pad is connected OR the World is
 * fullscreen — the two states where a physical keyboard cannot
 * be assumed), and the text edits its keys perform, computed
 * against the field's real value + selection so a press lands
 * exactly where the walker's caret stood.
 *
 * The DOM half (components/world/VirtualKeyboard.tsx) writes
 * those edits through the field's native value setter and a
 * real bubbling `input` event — the one road that keeps a
 * React controlled input's state truthful, because React's own
 * change tracker sits on the element and a plain assignment
 * reads as "nothing changed". The pad half rides the existing
 * panel arbitration: the keyboard is one more panel family in
 * the page's derivation (its usePanelPadNav is active while it
 * is open, the other families stand down, the scene's
 * padPanelHold covers it), so the pad has exactly one owner at
 * a time and ownership returns when the board closes.
 *
 * Key faces are drawn glyphs (⌫ ⏎ ⇧) and plain characters —
 * never a controller button name — so the board reads the same
 * whatever pad the walker holds.
 */

/* ── The board ─────────────────────────────────────────── */

export type VirtualKeyboardLayer = "letters" | "symbols";

export type VirtualKeyKind =
  | "char"
  | "space"
  | "backspace"
  | "shift"
  | "layer"
  | "enter"
  | "close";

export interface VirtualKey {
  /** Stable identity across layers/shift (focus + testids). */
  id: string;
  /** What the key face shows. */
  label: string;
  kind: VirtualKeyKind;
  /** For kind "char": the character this press inserts, with
   *  the layer + shift already resolved by the layout builder. */
  char?: string;
  /** The space bar spans the row's middle. */
  wide?: boolean;
}

function charKey(ch: string): VirtualKey {
  return { id: `char-${ch}`, label: ch, kind: "char", char: ch };
}

const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];
const LETTER_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
const SYMBOL_ROWS = [
  ["!", "@", "#", "$", "%", "^", "&", "*", "(", ")"],
  ["-", "_", "=", "+", "[", "]", "{", "}", ";", ":"],
  ["'", '"', ",", ".", "?", "/", "\\", "|", "~", "`"],
];

/**
 * The board's rows for one layer. One screen, always: the
 * letters layer carries the digit row (chat, search and names
 * are mostly letters + digits), the symbols layer swaps the
 * letter rows for the punctuation a message actually uses, and
 * the working keys (⇧ ⌫ ␣ ⏎ ✕) never move — a walker learns
 * the board once.
 *
 * `enterLabel` is resolved by the caller from the field's
 * context (Send on chat, Search on a search box, Enter
 * elsewhere) so the key says what it will do.
 */
export function virtualKeyboardRows(opts: {
  layer: VirtualKeyboardLayer;
  shift: boolean;
  enterLabel: string;
}): VirtualKey[][] {
  const { layer, shift, enterLabel } = opts;
  const shiftKey: VirtualKey = { id: "shift", label: "⇧", kind: "shift" };
  const backspaceKey: VirtualKey = { id: "backspace", label: "⌫", kind: "backspace" };
  const layerKey: VirtualKey = {
    id: "layer",
    label: layer === "letters" ? "#+=" : "ABC",
    kind: "layer",
  };
  const bottomRow: VirtualKey[] = [
    layerKey,
    { id: "space", label: "␣", kind: "space", wide: true },
    { id: "enter", label: enterLabel, kind: "enter" },
    { id: "close", label: "✕", kind: "close" },
  ];
  if (layer === "symbols") {
    return [
      SYMBOL_ROWS[0].map(charKey),
      SYMBOL_ROWS[1].map(charKey),
      SYMBOL_ROWS[2].map(charKey),
      bottomRow,
    ];
  }
  const letter = (ch: string): VirtualKey => {
    const shown = shift ? ch.toUpperCase() : ch;
    return { id: `char-${ch}`, label: shown, kind: "char", char: shown };
  };
  return [
    DIGITS.map(charKey),
    [...LETTER_ROWS[0]].map(letter),
    [...LETTER_ROWS[1]].map(letter),
    [shiftKey, ...[...LETTER_ROWS[2]].map(letter), backspaceKey],
    bottomRow,
  ];
}

/** Every key on the board, in reading (focus) order — the
 *  order the pad walks, the same linear order panel navigation
 *  gives every other panel. */
export function flattenVirtualKeys(rows: VirtualKey[][]): VirtualKey[] {
  return rows.flat();
}

/* ── Which fields may summon the board ─────────────────── */

/**
 * The structural shape of a field, resolved by the DOM half
 * from the real element (an input's `type` IDL attribute is
 * the RESOLVED type — a no-type input reads "text", exactly
 * the default a browser applies). Kept structural so the
 * classification is testable without a DOM.
 */
export interface VirtualKeyboardFieldShape {
  tagName: string;
  type?: string;
  disabled?: boolean;
  readOnly?: boolean;
}

/** Input types whose job is free text. Number, date, file,
 *  range, checkbox and radio fields are NOT text entry — they
 *  carry their own controls (steppers, pickers, toggles) that
 *  panel navigation already reaches, and letters poured into
 *  them through a value setter are swallowed by the browser. */
export const VIRTUAL_KEYBOARD_INPUT_TYPES: ReadonlySet<string> = new Set([
  "text",
  "search",
  "email",
  "url",
  "tel",
  "password",
  "",
]);

export function isVirtualKeyboardFieldShape(shape: VirtualKeyboardFieldShape): boolean {
  if (shape.disabled || shape.readOnly) return false;
  const tag = shape.tagName.toUpperCase();
  if (tag === "TEXTAREA") return true;
  if (tag !== "INPUT") return false;
  return VIRTUAL_KEYBOARD_INPUT_TYPES.has((shape.type ?? "text").toLowerCase());
}

/**
 * The summon rule (the owner's two no-keyboard states): a pad
 * is connected, or the World is fullscreen. With a desk, a
 * physical keyboard and neither condition, the board stays
 * away — it is an aid for the states that strand a walker,
 * never a pop-up tax on ordinary typing.
 */
export function shouldSummonVirtualKeyboard(env: {
  padConnected: boolean;
  fullscreen: boolean;
}): boolean {
  return env.padConnected || env.fullscreen;
}

/* ── The Enter key, per field ──────────────────────────── */

export type VirtualKeyboardEnterContext = "chat" | "search" | "text" | "multiline";

/** What Enter does: a single-line field's Enter is its form's
 *  submit; a textarea's Enter is a newline (its submit lives
 *  on the desk's own button, like the physical key). */
export function enterKeyBehaviour(context: VirtualKeyboardEnterContext): "submit" | "newline" {
  return context === "multiline" ? "newline" : "submit";
}

/** The Enter key says what it will do. */
export function enterKeyLabel(context: VirtualKeyboardEnterContext): string {
  switch (context) {
    case "chat":
      return "Send";
    case "search":
      return "Search";
    case "multiline":
      return "⏎";
    default:
      return "Enter";
  }
}

/* ── The edits ─────────────────────────────────────────── */

export interface FieldEditState {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

export type VirtualKeyEditAction =
  | { type: "insert"; text: string }
  | { type: "backspace" };

/**
 * One key press against a field's value + selection. Pure:
 * the same (state, action) always edits the same way — an
 * insert replaces the selection and lands the caret after the
 * inserted text; backspace deletes the selection, or the
 * character before the caret, or nothing at the very start.
 * `maxLength` is the field's own limit (a negative value means
 * none): an insert that would overflow is trimmed to what
 * fits, the way the physical key simply stops answering.
 */
export function computeFieldEdit(
  state: FieldEditState,
  action: VirtualKeyEditAction,
  maxLength = -1,
): FieldEditState {
  const { value, selectionStart: start, selectionEnd: end } = state;
  if (action.type === "backspace") {
    if (end > start) {
      return { value: value.slice(0, start) + value.slice(end), selectionStart: start, selectionEnd: start };
    }
    if (start > 0) {
      return {
        value: value.slice(0, start - 1) + value.slice(start),
        selectionStart: start - 1,
        selectionEnd: start - 1,
      };
    }
    return state;
  }
  let text = action.text;
  if (maxLength >= 0) {
    const room = maxLength - (value.length - (end - start));
    if (room <= 0) return state;
    text = text.slice(0, room);
  }
  const caret = start + text.length;
  return {
    value: value.slice(0, start) + text + value.slice(end),
    selectionStart: caret,
    selectionEnd: caret,
  };
}

/* ── Writing through the field's real value path ───────── */

/** The slice of a field element the commit touches. */
export interface FieldElementLike {
  value: string;
  selectionStart: number | null;
  selectionEnd: number | null;
  setSelectionRange?: (start: number, end: number) => void;
  dispatchEvent: (event: unknown) => boolean;
}

/**
 * Set a field's value through its PROTOTYPE setter, never the
 * instance's own property. React installs its change tracker
 * as a value descriptor on the element instance itself: a
 * plain `el.value = next` writes through that tracker, which
 * then believes the DOM and React agree — and the `input`
 * event that follows is swallowed as "no change", leaving
 * controlled state stale. The prototype setter writes the
 * value the tracker does not see, so the event lands as a
 * genuine change. (The standard native-setter pattern, kept
 * here in one tested place.)
 */
export function setFieldValueNative(el: FieldElementLike, value: string): void {
  const proto = Object.getPrototypeOf(el) as object | null;
  const desc = proto ? Object.getOwnPropertyDescriptor(proto, "value") : undefined;
  if (desc?.set) desc.set.call(el, value);
  else el.value = value;
}

/**
 * Commit one computed edit to a live field: write the value
 * natively, restore the caret, then fire the field's real
 * `input` event so its onChange — React state, desk state,
 * whatever owns the field — moves exactly as if the walker
 * had typed on a physical keyboard. `makeInputEvent` is
 * injected so this stays testable without a DOM (the
 * component passes `() => new Event("input", { bubbles: true })`).
 */
export function commitFieldEdit(
  el: FieldElementLike,
  next: FieldEditState,
  makeInputEvent: () => unknown,
): void {
  setFieldValueNative(el, next.value);
  try {
    el.setSelectionRange?.(next.selectionStart, next.selectionEnd);
  } catch {
    /* some input types refuse a selection — the value stands */
  }
  el.dispatchEvent(makeInputEvent());
}
