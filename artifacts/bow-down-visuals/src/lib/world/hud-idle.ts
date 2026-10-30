/**
 * hud-idle.ts — the World's chrome learns to step aside
 * (stack900, owner's directive 2026-10-29: "I'm still seeing a
 * bunch of selections around my full screen").
 *
 * The World in fullscreen wore its furniture permanently: the
 * header bar, the footer with its door chip, action pills and
 * say row, the radio chip, the compass — a ring of selections
 * around a screen the owner asked to be a place, not a panel.
 * This module is the pure half of the answer: how long the
 * walker must leave the controls alone before the furniture
 * fades (the hook, src/hooks/use-hud-idle.ts, owns the timers
 * and the pad poll; index.css owns the fade itself, keyed off
 * [data-hud-fade] under the page root's .hud-idle class).
 *
 * What fades is FURNITURE ONLY, and the line is deliberate:
 * announcements (the palace banner, the King's moment, a live
 * drop, a stage change), the walk-up prompts, the interact
 * note and the fullscreen re-enter chip never carry the fade
 * attribute — they are the World speaking, not selections
 * standing around, and several of them are money arriving.
 * Panels never fade either: an open panel holds the whole HUD
 * awake (the page's `enabled` bargain), because a walker
 * working a desk should never watch the floor vanish under it.
 */

/** How long the controls must sit untouched before the
 *  furniture fades. Long enough that reading a prompt or
 *  pausing on a view never costs the frame; short enough that
 *  a walker who has settled into the scene gets their clean
 *  screen without asking. */
export const HUD_IDLE_MS = 4000;

/** The whole idle rule, as one comparison: the furniture may
 *  fade when the last activity is at least HUD_IDLE_MS old.
 *  A lastActivity of 0 (nothing has happened yet — the walker
 *  just walked in) is measured against the walk-in time the
 *  hook stamps on mount, never against the epoch. */
export function hudIdleDue(lastActivityAt: number, now: number, idleMs: number = HUD_IDLE_MS): boolean {
  return lastActivityAt > 0 && now - lastActivityAt >= idleMs;
}

/** The structural shape hud text-entry detection reads — the
 *  hook and the page's menu watcher both hand it DOM elements;
 *  tests hand it plain objects. */
export interface TextEntryLike {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
}

/* Input types that are NOT text entry: their own controls
 * (a checkbox, a slider, a file picker) are already pad- and
 * pointer-reachable, and no keyboard — on-screen or physical —
 * types into them. The virtual keyboard's census exclusions,
 * with one deliberate difference: a number field counts as
 * text entry HERE, because digits are typed into it and a
 * walker mid-type should neither lose the furniture nor have
 * the menu button stolen — the keyboard's question is what
 * summons it, this module's question is what owns the input. */
const NON_TEXT_INPUT_TYPES: ReadonlySet<string> = new Set([
  "checkbox",
  "radio",
  "file",
  "range",
  "button",
  "submit",
  "reset",
  "image",
  "hidden",
  "date",
  "time",
  "datetime-local",
  "month",
  "week",
  "color",
]);

/** Is this element a place a person types text? The say box,
 *  a desk's search field, a name field — the elements that
 *  own the input while they hold focus: the HUD never fades
 *  from under a typing walker, and the pad's menu button
 *  belongs to the field's own rules while one is focused. */
export function isTextEntryElement(el: TextEntryLike | null | undefined): boolean {
  if (!el) return false;
  if (el.isContentEditable === true) return true;
  const tag = (el.tagName ?? "").toUpperCase();
  if (tag === "TEXTAREA") return true;
  if (tag === "INPUT") {
    const type = (el.type ?? "text").toLowerCase();
    return !NON_TEXT_INPUT_TYPES.has(type);
  }
  return false;
}
