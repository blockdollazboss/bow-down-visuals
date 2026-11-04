import { useCallback, useEffect, useRef } from "react";

/**
 * Sidebar auto-collapse — the restraint contract (QC-200 fix #3).
 *
 * The desktop sidebar opens on arrival so the user can see where
 * everything is, then gives the content room by collapsing. The old
 * mechanism was a bare 3s mount timer in AuthedLayout: it fired no
 * matter what the user was doing — pointer hovering the menu, focus
 * in the sidebar search box, a click a moment earlier — and left the
 * nav links in the DOM off-canvas, visible to automation and the
 * keyboard but unclickable ("ghost links"; the ghost half of that
 * defect is closed in components/ui/sidebar.tsx via `inert`).
 *
 * This controller keeps the intended behaviour (open on arrival,
 * collapse for room, any manual toggle cancels the auto-close for
 * the session) and adds the restraints:
 *
 *   - NEVER collapses while the pointer is over the sidebar or
 *     focus is inside it.
 *   - NEVER collapses within the interaction grace window after the
 *     user last used the sidebar (pointer down / key / click inside).
 *   - After hover/focus leaves the sidebar, the full delay restarts —
 *     the user always gets a fresh, full countdown, never a leftover
 *     fraction of one.
 *   - A manual toggle (provider open-change, the expand button)
 *     cancels the auto-collapse outright, as before.
 */

/** How long the sidebar stays up, untouched, before auto-collapsing. */
export const SIDEBAR_AUTO_COLLAPSE_DELAY_MS = 3000;

/** After the user last interacts inside the sidebar, no auto-collapse
 *  for at least this long. */
export const SIDEBAR_INTERACTION_GRACE_MS = 10_000;

/** Re-check cadence while hover/focus is holding the sidebar open. */
export const SIDEBAR_AUTO_COLLAPSE_POLL_MS = 250;

/** Selector matching the sidebar roots (desktop rail + mobile sheet). */
export const SIDEBAR_ROOT_SELECTOR = '[data-slot="sidebar"]';

export interface SidebarAutoCollapseDeps {
  /** Called exactly once when the auto-collapse fires. */
  onCollapse: () => void;
  delayMs?: number;
  graceMs?: number;
  pollMs?: number;
  /** Injectable clock/scheduler for tests; defaults to the globals. */
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/**
 * Pure auto-collapse decision engine. Owns no DOM and no React — the
 * hook below feeds it engagement signals from document listeners.
 */
export class SidebarAutoCollapseController {
  private readonly onCollapse: () => void;
  private readonly delayMs: number;
  private readonly graceMs: number;
  private readonly pollMs: number;
  private readonly nowFn: () => number;
  private readonly setTimerFn: (fn: () => void, ms: number) => unknown;
  private readonly clearTimerFn: (handle: unknown) => void;

  private timer: unknown = null;
  private running = false;
  private cancelled = false;
  private fired = false;
  private startedAt = 0;
  private hovered = false;
  private focused = false;
  private engagementEndedAt = 0;
  private lastInteractionAt = 0;

  constructor(deps: SidebarAutoCollapseDeps) {
    this.onCollapse = deps.onCollapse;
    this.delayMs = deps.delayMs ?? SIDEBAR_AUTO_COLLAPSE_DELAY_MS;
    this.graceMs = deps.graceMs ?? SIDEBAR_INTERACTION_GRACE_MS;
    this.pollMs = deps.pollMs ?? SIDEBAR_AUTO_COLLAPSE_POLL_MS;
    this.nowFn = deps.now ?? (() => Date.now());
    this.setTimerFn =
      deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms) as unknown);
    this.clearTimerFn =
      deps.clearTimer ??
      ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.startedAt = this.nowFn();
    this.arm(this.delayMs);
  }

  stop(): void {
    this.running = false;
    this.clearPending();
  }

  /** Pointer is over the sidebar (or no longer is). */
  setHovered(hovered: boolean): void {
    this.setEngagement("hovered", hovered);
  }

  /** Focus is inside the sidebar (or no longer is). */
  setFocused(focused: boolean): void {
    this.setEngagement("focused", focused);
  }

  /** The user pressed / clicked / typed inside the sidebar just now. */
  noteInteraction(): void {
    this.lastInteractionAt = this.nowFn();
  }

  /** Any manual open/close by the user cancels the auto-collapse. */
  noteManualToggle(): void {
    this.cancelled = true;
    this.clearPending();
  }

  private setEngagement(kind: "hovered" | "focused", value: boolean): void {
    const wasEngaged = this.hovered || this.focused;
    if (kind === "hovered") this.hovered = value;
    else this.focused = value;
    const isEngaged = this.hovered || this.focused;
    if (wasEngaged && !isEngaged) {
      // The user just left the sidebar: the collapse countdown
      // restarts in full from here (see tick's earliest-fire math).
      this.engagementEndedAt = this.nowFn();
    }
  }

  private clearPending(): void {
    if (this.timer !== null) {
      this.clearTimerFn(this.timer);
      this.timer = null;
    }
  }

  private arm(ms: number): void {
    this.clearPending();
    if (!this.running || this.cancelled || this.fired) return;
    this.timer = this.setTimerFn(this.tick, ms);
  }

  private tick = (): void => {
    this.timer = null;
    if (!this.running || this.cancelled || this.fired) return;
    if (this.hovered || this.focused) {
      // Held open by the user's pointer/focus: keep checking, never fire.
      this.arm(this.pollMs);
      return;
    }
    const now = this.nowFn();
    const earliest = Math.max(
      this.startedAt + this.delayMs,
      this.lastInteractionAt > 0
        ? this.lastInteractionAt + this.graceMs
        : 0,
      this.engagementEndedAt > 0
        ? this.engagementEndedAt + this.delayMs
        : 0,
    );
    if (now < earliest) {
      this.arm(earliest - now);
      return;
    }
    this.fired = true;
    this.onCollapse();
  };
}

/** True when an event's target sits inside a sidebar root. */
export function eventInsideSidebar(event: Event): boolean {
  const target = event.target as Element | null;
  if (!target || typeof target.closest !== "function") return false;
  return target.closest(SIDEBAR_ROOT_SELECTOR) !== null;
}

function relatedTargetInsideSidebar(event: FocusEvent | PointerEvent): boolean {
  const related = event.relatedTarget as Element | null;
  if (!related || typeof related.closest !== "function") return false;
  return related.closest(SIDEBAR_ROOT_SELECTOR) !== null;
}

/**
 * React wiring: runs one controller per mount and feeds it pointer /
 * focus engagement from document listeners (capture not needed — the
 * signals are "is the event inside the sidebar", which bubbling
 * targets answer directly). Returns `noteManualToggle` for the
 * layout's manual open/close paths.
 */
export function useSidebarAutoCollapse(deps: {
  onCollapse: () => void;
}): { noteManualToggle: () => void } {
  const collapseRef = useRef(deps.onCollapse);
  collapseRef.current = deps.onCollapse;
  const controllerRef = useRef<SidebarAutoCollapseController | null>(null);

  useEffect(() => {
    const controller = new SidebarAutoCollapseController({
      onCollapse: () => collapseRef.current(),
    });
    controllerRef.current = controller;

    const onPointerOver = (e: PointerEvent) => {
      controller.setHovered(eventInsideSidebar(e));
    };
    const onPointerOut = (e: PointerEvent) => {
      if (eventInsideSidebar(e) && !relatedTargetInsideSidebar(e)) {
        controller.setHovered(false);
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      if (eventInsideSidebar(e)) {
        controller.setHovered(true);
        controller.noteInteraction();
      }
    };
    const onFocusIn = (e: FocusEvent) => {
      controller.setFocused(eventInsideSidebar(e));
    };
    const onFocusOut = (e: FocusEvent) => {
      if (eventInsideSidebar(e) && !relatedTargetInsideSidebar(e)) {
        controller.setFocused(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (eventInsideSidebar(e)) controller.noteInteraction();
    };
    const onWindowBlur = () => {
      controller.setHovered(false);
      controller.setFocused(false);
    };

    document.addEventListener("pointerover", onPointerOver);
    document.addEventListener("pointerout", onPointerOut);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", onWindowBlur);
    controller.start();
    return () => {
      document.removeEventListener("pointerover", onPointerOver);
      document.removeEventListener("pointerout", onPointerOut);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", onWindowBlur);
      controller.stop();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, []);

  const noteManualToggle = useCallback(() => {
    controllerRef.current?.noteManualToggle();
  }, []);

  return { noteManualToggle };
}
