import { useEffect, useRef } from "react";
import { firstGamepad } from "@/lib/world/gamepad";
import {
  IDLE_PANEL_PAD_EDGES,
  PANEL_FOCUSABLE_SELECTOR,
  nextPanelFocusIndex,
  pollPanelPad,
  type PanelPadEdges,
} from "@/lib/world/panel-nav";

/**
 * Gamepad navigation for one DOM panel (stack700) — the layer
 * the owner's controller-first walk proved missing: panels are
 * DOM, the scene's pad poll speaks only avatar, and nothing
 * translated the pad into selection. While `active`, this hook
 * owns the pad for its panel:
 *
 *   D-pad / left stick — move DOM focus among the panel's
 *     focusable controls (the live DOM list, re-read every
 *     move, so a re-rendered desk never strands the selection);
 *   A — activate the focused control (buttons and links click;
 *     checkboxes and radios toggle; text inputs, selects and
 *     textareas keep the focus — typing and choosing stay
 *     theirs, now reachable instead of stranded);
 *   B — close the panel through the page's own close path.
 *
 * Opening a panel focuses its first control — a panel the pad
 * opened is a panel the pad is already standing in. The
 * selection wears the .world-pad-focus gold outline (index.css)
 * wherever focus sits, however it got there (a focusin listener
 * keeps the ring honest for mouse/keyboard focus too).
 *
 * The scene stands its pad verbs down for the same panels
 * (hall-scene's padPanelHold — the page derives it from the
 * same open states), so this reader and the scene's never
 * fight over one press: while a panel is open the pad belongs
 * to the panel, entirely.
 *
 * Keyboard and mouse are untouched: the hook only ADDS a pad
 * reader and moves real DOM focus — Tab, click and Escape
 * (StationPanel's own) behave exactly as before.
 */
export function usePanelPadNav(opts: {
  active: boolean;
  resolveContainer: () => HTMLElement | null;
  onClose: () => void;
}): void {
  const { active } = opts;
  const resolveRef = useRef(opts.resolveContainer);
  resolveRef.current = opts.resolveContainer;
  const onCloseRef = useRef(opts.onClose);
  onCloseRef.current = opts.onClose;

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let edges: PanelPadEdges = IDLE_PANEL_PAD_EDGES;
    let disposed = false;

    const focusables = (): HTMLElement[] => {
      const root = resolveRef.current();
      if (!root) return [];
      return [...root.querySelectorAll<HTMLElement>(PANEL_FOCUSABLE_SELECTOR)].filter(
        (el) => el.getClientRects().length > 0,
      );
    };
    const mark = (el: HTMLElement | null) => {
      const root = resolveRef.current();
      root?.querySelectorAll(".world-pad-focus").forEach((n) => n.classList.remove("world-pad-focus"));
      el?.classList.add("world-pad-focus");
    };
    const focusEl = (el: HTMLElement) => {
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: "nearest" });
      mark(el);
    };

    /* Standing in the panel from the first frame: if focus is
     * not already inside (a mouse click may have put it there),
     * the first control takes it. */
    const root0 = resolveRef.current();
    if (root0 && !root0.contains(document.activeElement)) {
      const first = focusables()[0];
      if (first) focusEl(first);
    }

    const onFocusIn = (e: FocusEvent) => {
      if (e.target instanceof HTMLElement) mark(e.target);
    };
    const rootForListen = resolveRef.current();
    rootForListen?.addEventListener("focusin", onFocusIn);

    const loop = () => {
      if (disposed) return;
      try {
        const pad = firstGamepad([...(navigator.getGamepads?.() ?? [])]);
        const polled = pollPanelPad(pad, edges);
        edges = polled.edges;
        const { intent } = polled;
        if (intent.back) {
          onCloseRef.current();
          return;
        }
        if (intent.move !== 0) {
          const list = focusables();
          const current = list.indexOf(document.activeElement as HTMLElement);
          const next = nextPanelFocusIndex(current, list.length, intent.move);
          if (next >= 0 && list[next]) focusEl(list[next]);
        } else if (intent.confirm) {
          const el = document.activeElement as HTMLElement | null;
          const root = resolveRef.current();
          if (el && root && root.contains(el)) {
            const tag = el.tagName;
            const type = (el as HTMLInputElement).type;
            if (tag === "BUTTON" || tag === "A" || type === "checkbox" || type === "radio") {
              el.click();
            }
          }
        }
      } catch {
        /* no gamepad API — the panel keeps its mouse/keyboard */
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      rootForListen?.removeEventListener("focusin", onFocusIn);
      resolveRef.current()
        ?.querySelectorAll(".world-pad-focus")
        .forEach((n) => n.classList.remove("world-pad-focus"));
    };
  }, [active]);
}
