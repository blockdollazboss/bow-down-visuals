import { useEffect, useRef, useState } from "react";
import { usePanelPadNav } from "@/hooks/use-panel-pad-nav";
import {
  commitFieldEdit,
  computeFieldEdit,
  enterKeyBehaviour,
  enterKeyLabel,
  isVirtualKeyboardFieldShape,
  shouldSummonVirtualKeyboard,
  virtualKeyboardRows,
  type FieldEditState,
  type VirtualKey,
  type VirtualKeyEditAction,
  type VirtualKeyboardEnterContext,
  type VirtualKeyboardLayer,
} from "@/lib/world/virtual-keyboard";

type TextField = HTMLInputElement | HTMLTextAreaElement;

/**
 * The in-World virtual keyboard (stack900) — the DOM half of
 * lib/world/virtual-keyboard. The owner's directive
 * (2026-10-29): "when I'm trying to text, a virtual keyboard
 * or something should pop up."
 *
 * The board summons itself: a text field anywhere inside the
 * World page — the room chat, the herald, every desk's search,
 * name and note fields, all of them, because the trigger is a
 * focusin census of the page root rather than a wire per
 * field — gains focus while a gamepad is connected or the
 * World is fullscreen (the two states where no physical
 * keyboard can be assumed), and the board opens attached to
 * that field. It closes on submit, on Esc, on focus leaving
 * for a non-text control, or on its own ✕ / the pad's B.
 *
 * Three roads work it, and none fights another:
 *   · the pad — one more usePanelPadNav family. While the
 *     board is open its hook is the page's ONLY active pad
 *     reader (world.tsx derives the other families' `active`
 *     from the board's closed state, and the scene's
 *     padPanelHold covers the board too): D-pad/stick walks
 *     the keys, A types, B puts the board away and hands the
 *     pad back to the panel underneath.
 *   · mouse / touch — the keys are plain buttons; a mousedown
 *     is default-prevented so a click never blurs the field
 *     mid-word.
 *   · a physical keyboard — typing into the field is never
 *     intercepted. If pad focus is sitting on a key when the
 *     walker types physically, a capture-phase listener
 *     applies the same edit itself, so the letter lands in
 *     the field instead of dying on a focused button.
 *
 * Every edit writes through the field's native value setter
 * plus a real bubbling `input` event (lib's commitFieldEdit),
 * so a controlled field's React state moves exactly as if the
 * walker had typed on hardware — the desk's own onChange is
 * the only road the text ever travels.
 */
export default function WorldVirtualKeyboard(opts: {
  /** The World page root — the board's whole world. */
  resolveScope: () => HTMLElement | null;
  isLight: boolean;
  padConnected: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { isLight, padConnected } = opts;
  const resolveScopeRef = useRef(opts.resolveScope);
  resolveScopeRef.current = opts.resolveScope;
  const onOpenChangeRef = useRef(opts.onOpenChange);
  onOpenChangeRef.current = opts.onOpenChange;

  const [target, setTarget] = useState<TextField | null>(null);
  const [shift, setShift] = useState(false);
  const [layer, setLayer] = useState<VirtualKeyboardLayer>("letters");
  const [echo, setEcho] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  /** The key rows alone: the pad's container, so its first
   *  standing-in focus lands on a key — never on the header's
   *  ✕, which would make the pad's first A a dismissal. The
   *  pad's way out is B; the ✕ belongs to mouse and touch. */
  const rowsRef = useRef<HTMLDivElement | null>(null);
  const targetRef = useRef<TextField | null>(null);
  targetRef.current = target;
  /** A deliberate close returns focus to the field — that
   *  focusin must not instantly re-summon the board it just
   *  dismissed. The guard names the field and a short window;
   *  a genuine re-entry (a click after the window, a different
   *  field at any time) summons normally. */
  const suppressRef = useRef<{ el: TextField; until: number } | null>(null);
  const open = target !== null;

  useEffect(() => {
    onOpenChangeRef.current(open);
  }, [open ]);

  const closeKeyboard = (returnFocus: boolean) => {
    const el = targetRef.current;
    setTarget(null);
    setShift(false);
    setLayer("letters");
    if (el && returnFocus && el.isConnected) {
      suppressRef.current = { el, until: Date.now() + 1200 };
      try {
        el.focus({ preventScroll: true });
      } catch {
        /* field vanished mid-close — nothing to hand back */
      }
    }
  };
  const closeRef = useRef(closeKeyboard);
  closeRef.current = closeKeyboard;

  /* The summon + dismissal census: one focusin/focusout pair
   * on the document, scoped to the World page root. */
  useEffect(() => {
    const summonable = (el: TextField): boolean =>
      shouldSummonVirtualKeyboard({
        padConnected,
        fullscreen: Boolean(document.fullscreenElement),
      }) &&
      isVirtualKeyboardFieldShape({
        tagName: el.tagName,
        type: el instanceof HTMLInputElement ? el.type : undefined,
        disabled: el.disabled,
        readOnly: el.readOnly,
      });

    const onFocusIn = (e: FocusEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el) return;
      if (rootRef.current?.contains(el)) return; /* focus on the board itself */
      const scope = resolveScopeRef.current();
      if (!scope || !scope.contains(el)) return;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        const suppressed =
          suppressRef.current?.el === el && Date.now() < suppressRef.current.until;
        if (suppressed) {
          suppressRef.current = null;
          return;
        }
        if (summonable(el)) {
          setTarget(el);
          setEcho(el.value);
          return;
        }
      }
      /* Focus landed on a non-text control inside the World:
       * the board's moment is over. */
      if (targetRef.current) closeRef.current(false);
    };
    const onFocusOut = (e: FocusEvent) => {
      if (!targetRef.current || e.target !== targetRef.current) return;
      /* Focus is leaving the field. If it lands on the board
       * or back on the field, focusin settles it; if it lands
       * nowhere (a canvas click, a panel closing), close. */
      window.setTimeout(() => {
        const ae = document.activeElement;
        if (!targetRef.current) return;
        if (ae === targetRef.current) return;
        if (ae && rootRef.current?.contains(ae)) return;
        closeRef.current(false);
      }, 0);
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, [padConnected]);

  /* The summon conditions can vanish under an open board (pad
   * unplugged outside fullscreen): put the board away rather
   * than strand it over a walker who has a keyboard again. */
  useEffect(() => {
    const recheck = () => {
      if (
        targetRef.current &&
        !shouldSummonVirtualKeyboard({
          padConnected,
          fullscreen: Boolean(document.fullscreenElement),
        })
      ) {
        closeRef.current(false);
      }
    };
    recheck();
    document.addEventListener("fullscreenchange", recheck);
    return () => document.removeEventListener("fullscreenchange", recheck);
  }, [padConnected]);

  /* Keep the header's echo truthful while the walker types
   * physically into the field itself. */
  useEffect(() => {
    if (!target) return;
    const onInput = () => setEcho(target.value);
    target.addEventListener("input", onInput);
    return () => target.removeEventListener("input", onInput);
  }, [target]);

  const applyAction = (action: VirtualKeyEditAction) => {
    const el = targetRef.current;
    if (!el) return;
    const state: FieldEditState = {
      value: el.value,
      selectionStart: el.selectionStart ?? el.value.length,
      selectionEnd: el.selectionEnd ?? el.value.length,
    };
    const next = computeFieldEdit(state, action, el.maxLength);
    if (next === state) return;
    commitFieldEdit(el, next, () => new Event("input", { bubbles: true }));
    setEcho(next.value);
  };
  const applyActionRef = useRef(applyAction);
  applyActionRef.current = applyAction;

  const enterContext = (el: TextField): VirtualKeyboardEnterContext => {
    if (el instanceof HTMLTextAreaElement) return "multiline";
    if (el.type === "search") return "search";
    if (el.dataset.testid === "world-say-input") return "chat";
    return "text";
  };

  const pressEnter = () => {
    const el = targetRef.current;
    if (!el) return;
    if (enterKeyBehaviour(enterContext(el)) === "newline") {
      applyAction({ type: "insert", text: "\n" });
      return;
    }
    /* A single-line Enter is the form's submit: speak the
     * key the field's own handlers listen for, then take the
     * form's real submit road unless a handler claimed the
     * key (its preventDefault is its answer). */
    const init: KeyboardEventInit = {
      key: "Enter",
      code: "Enter",
      bubbles: true,
      cancelable: true,
    };
    const proceed = el.dispatchEvent(new KeyboardEvent("keydown", init));
    el.dispatchEvent(new KeyboardEvent("keypress", init));
    if (proceed) {
      try {
        el.form?.requestSubmit();
      } catch {
        /* no form road — the key events were the submit */
      }
    }
    el.dispatchEvent(new KeyboardEvent("keyup", init));
    closeRef.current(true);
  };
  const pressEnterRef = useRef(pressEnter);
  pressEnterRef.current = pressEnter;

  const pressKey = (key: VirtualKey) => {
    switch (key.kind) {
      case "char":
        applyAction({ type: "insert", text: key.char ?? key.label });
        if (shift) setShift(false);
        break;
      case "space":
        applyAction({ type: "insert", text: " " });
        if (shift) setShift(false);
        break;
      case "backspace":
        applyAction({ type: "backspace" });
        break;
      case "shift":
        setShift((s) => !s);
        break;
      case "layer":
        setLayer((l) => (l === "letters" ? "symbols" : "letters"));
        break;
      case "enter":
        pressEnter();
        break;
      case "close":
        closeKeyboard(true);
        break;
    }
  };

  /* Physical keys while the board is open. Esc always puts
   * the board away (and stops there — the panel underneath
   * keeps its own Esc for itself). When focus sits on a key,
   * a physical letter/backspace/Enter is applied to the field
   * directly; when focus sits in the field, nothing here
   * touches the event at all. */
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current(true);
        return;
      }
      const ae = document.activeElement;
      const root = rootRef.current;
      if (!root || !ae || ae === targetRef.current || !root.contains(ae)) return;
      if (e.key === "Enter") {
        pressEnterRef.current();
        e.preventDefault();
      } else if (e.key === "Backspace") {
        applyActionRef.current({ type: "backspace" });
        e.preventDefault();
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        applyActionRef.current({ type: "insert", text: e.key });
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open ]);

  /* The pad, while the board is open: this family is the
   * page's one active reader (world.tsx stands the others
   * down), and B is the way out. */
  usePanelPadNav({
    active: open,
    resolveContainer: () => rowsRef.current,
    onClose: () => closeRef.current(true),
  });

  if (!target) return null;

  const context = enterContext(target);
  const rows = virtualKeyboardRows({ layer, shift, enterLabel: enterKeyLabel(context) });
  const fieldLabel =
    target.getAttribute("aria-label") || target.placeholder || target.name || "Text field";
  const echoTail = echo.length > 60 ? `…${echo.slice(-60)}` : echo;

  const keyCls = (key: VirtualKey): string => {
    const base =
      "flex h-11 items-center justify-center rounded-lg border text-sm font-bold transition select-none touch-manipulation sm:h-12 sm:text-base";
    const width = key.wide ? "flex-[3]" : "flex-1";
    if (key.kind === "enter") {
      return `${base} ${width} border-[#d4af37] bg-[#d4af37] text-black hover:bg-[#e8c86a]`;
    }
    if (key.kind === "shift" && shift) {
      return `${base} ${width} border-[#d4af37] bg-[#d4af37]/30 ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`;
    }
    return `${base} ${width} ${
      isLight
        ? "border-[#C9A84C]/50 bg-white/70 text-[#2a1e07] hover:bg-white"
        : "border-white/15 bg-white/5 text-white hover:bg-white/15"
    }`;
  };

  return (
    <div
      ref={rootRef}
      data-testid="world-virtual-keyboard"
      className={`fixed inset-x-0 bottom-0 z-[80] border-t px-2 pb-2 pt-1.5 backdrop-blur sm:px-4 sm:pb-3 ${
        isLight ? "border-[#C9A84C]/60 bg-[#FBF6E9]/95" : "border-[#d4af37]/30 bg-[#070605]/95"
      }`}
      role="group"
      aria-label={`Virtual keyboard — typing in ${fieldLabel}`}
    >
      <div className="mx-auto flex max-w-3xl items-center gap-2 pb-1.5">
        <span
          className={`shrink-0 text-[11px] font-black uppercase tracking-[0.14em] ${
            isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"
          }`}
        >
          {fieldLabel}
        </span>
        <span
          className={`min-w-0 flex-1 truncate text-sm font-semibold ${
            isLight ? "text-[#2a1e07]" : "text-white"
          }`}
          data-testid="world-vkbd-echo"
        >
          {echoTail || <span className="opacity-40">…</span>}
        </span>
        <button
          type="button"
          data-testid="world-vkbd-close"
          aria-label="Close keyboard"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => closeKeyboard(true)}
          className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-black ${
            isLight
              ? "border-[#C9A84C]/50 text-[#7A5A12] hover:bg-white"
              : "border-white/15 text-white/70 hover:bg-white/10"
          }`}
        >
          ✕
        </button>
      </div>
      <div ref={rowsRef} className="mx-auto flex max-w-3xl flex-col gap-1.5">
        {rows.map((row, i) => (
          <div key={i} className="flex gap-1.5">
            {row.map((key) => (
              <button
                key={key.id}
                type="button"
                data-vkbd-key={key.id}
                aria-label={
                  key.kind === "char" || key.kind === "space"
                    ? undefined
                    : key.kind === "enter"
                      ? enterKeyLabel(context)
                      : key.label
                }
                aria-pressed={key.kind === "shift" ? shift : undefined}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pressKey(key)}
                className={keyCls(key)}
              >
                {key.label}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
