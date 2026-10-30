/**
 * Menu-button settings + clean fullscreen (stack900, owner's
 * directive 2026-10-29): settings should open by "pushing your
 * menu button, your start button, like normal stuff" — and
 * fullscreen should NOT have "a bunch of selections around" it.
 *
 * This suite pins the repair at the source level (the
 * automation browser has no WebGL2 and no gamepad — the
 * owner's walk is the live verdict):
 *
 *   - Start, resolved through the controller profile's
 *     rightMenu role, toggles the World settings: its TAP is
 *     the settings verb, its 400 ms HOLD keeps the photo frame
 *     (the gesture share gamepad.test.ts proves in the poll;
 *     bindings.test.ts pins the table);
 *   - exactly ONE reader owns the tap per state: the scene's
 *     verb while no panel is open (the scene discards intent
 *     under padPanelHold), the page-side watcher while one is —
 *     so opening settings over a desk replaces it through the
 *     one toggle, and nothing can double-fire;
 *   - while photo mode is up the tap is photo's way out, and
 *     the scene's photo dispatch is enter-only, so a hold that
 *     began inside photo mode cannot re-enter on its crossing;
 *   - the keyboard verdict is stated, not faked: P stays the
 *     photo key, no keyboard verb opens settings — Esc is the
 *     browser's fullscreen exit and cannot be a page verb —
 *     so the keyboard/mouse road to settings is the door chip,
 *     which keeps working unchanged;
 *   - the World's furniture (header, footer, radio chip,
 *     compass, keyboard hint — five seats, no more) fades on
 *     idle under .hud-idle, opacity only: announcements,
 *     prompts, panels and the fullscreen re-enter chip never
 *     carry the mark, and every seat is byte-identical when
 *     the furniture is present.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { KEY_VERBS } from "./bindings";
import { HUD_IDLE_MS, hudIdleDue, isTextEntryElement } from "./hud-idle";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("../../pages/world.tsx");
const panel = read("../../components/world/WorldSettingsPanel.tsx");
const scene = read("../../lib/world/hall-scene.ts");
const css = read("../../index.css");
const hook = read("../../hooks/use-hud-idle.ts");

const segment = (src: string, from: string, to: string) => {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a);
  expect(a, `segment start ${from}`).toBeGreaterThanOrEqual(0);
  expect(b, `segment end ${to}`).toBeGreaterThan(a);
  return src.slice(a, b);
};

describe("hud-idle — the pure rule", () => {
  it("the furniture fades only once the controls have sat for the full idle", () => {
    expect(HUD_IDLE_MS).toBeGreaterThan(0);
    expect(hudIdleDue(1000, 1000 + HUD_IDLE_MS - 1)).toBe(false);
    expect(hudIdleDue(1000, 1000 + HUD_IDLE_MS)).toBe(true);
    expect(hudIdleDue(1000, 1000 + HUD_IDLE_MS * 10)).toBe(true);
    /* No activity stamped yet (0) is never "idle since the
     * epoch" — the hook stamps the walk-in moment on mount. */
    expect(hudIdleDue(0, Number.MAX_SAFE_INTEGER)).toBe(false);
  });

  it("text entry is what a person types into — and nothing else", () => {
    for (const type of ["text", "search", "email", "password", "number", "tel", "url"]) {
      expect(isTextEntryElement({ tagName: "INPUT", type })).toBe(true);
    }
    expect(isTextEntryElement({ tagName: "INPUT" })).toBe(true); // no type = text
    expect(isTextEntryElement({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTextEntryElement({ tagName: "DIV", isContentEditable: true })).toBe(true);
    for (const type of ["checkbox", "radio", "file", "range", "date", "hidden", "submit", "button"]) {
      expect(isTextEntryElement({ tagName: "INPUT", type })).toBe(false);
    }
    expect(isTextEntryElement({ tagName: "SELECT" })).toBe(false);
    expect(isTextEntryElement({ tagName: "BUTTON" })).toBe(false);
    expect(isTextEntryElement({ tagName: "DIV" })).toBe(false);
    expect(isTextEntryElement(null)).toBe(false);
    expect(isTextEntryElement(undefined)).toBe(false);
  });
});

describe("the menu button — one tap, one owner per state", () => {
  it("the scene carries a settings callback beside the photo one, and dispatches the tap intent to it", () => {
    expect(scene).toContain("onPadSettingsToggle: (() => void) | null = null;");
    expect(scene).toContain("if (intent.settingsToggle) this.onPadSettingsToggle?.();");
    expect(scene).toContain("if (intent.photoMode) this.onPadPhotoMode?.();");
  });

  it("the page wires the scene's tap to the settings ref — and the photo dispatch is enter-only", () => {
    const wiring = segment(page, "scene.onPadSettingsToggle = () => {", "scene.onPadFullscreenToggle");
    expect(wiring).toContain("settingsToggleRef.current()");
    expect(wiring).toContain("scene.onPadPhotoMode = () => {");
    /* Enter-only: a hold that began inside photo mode must not
     * re-enter when its crossing lands — the tap already left. */
    expect(wiring).toContain("if (!cancelled && !photoModeRef.current) togglePhotoModeRef.current();");
  });

  it("the settings ref is the one road: photo first, the verb gate, then the one toggle", () => {
    const road = segment(page, "settingsToggleRef.current = () => {", "/* The voice connection truth");
    expect(road).toContain("if (photoModeRef.current) {");
    expect(road).toContain("togglePhotoModeRef.current();");
    expect(road).toContain('if (!verbRoleOk("settingsToggle", myRole())) return;');
    expect(road).toContain("toggleSettingsPanel();");
  });

  it("entering photo mode retires the settings panel with every other panel", () => {
    const enter = segment(page, "togglePhotoModeRef.current = () => {", "/* R3 on the pad");
    expect(enter).toContain("setPanelTarget(null);");
    expect(enter).toContain("setSettingsPanelOpen(false);");
  });

  it("while a panel owns the pad, the page-side watcher owns the tap — seeded, text-aware, same toggle", () => {
    const watch = segment(page, "const menuWatchActive =", "/* The furniture idle (stack900)");
    /* Active exactly over the padPanelHold set, settings
     * itself included (its own tap must close it). */
    expect(watch).toContain("settingsPanelOpen");
    expect(watch).toContain("Boolean(panelTarget) || charPanelOpen || screenPanelOpen || hostPanelOpen");
    /* The button resolves through the profile's rightMenu
     * role — the same index the poll reads. */
    expect(watch).toContain('padButtonIndex(getControllerProfile(), "rightMenu")');
    /* The edge seeds from the pad's live state, so the press
     * that opened the panel can't re-fire as a phantom close. */
    expect(watch).toContain("if (prevDown === null) {");
    /* A focused text field stands the watcher down — the
     * panel's own rules win while a field owns the input. */
    expect(watch).toContain("isTextEntryElement(document.activeElement as Element | null)");
    /* And it lands on the same one road as the scene's tap. */
    expect(watch).toContain("settingsToggleRef.current();");
  });

  it("no panel family reads the menu button — the panel poll can never double-fire the tap", () => {
    const panelNav = read("../../lib/world/panel-nav.ts");
    expect(panelNav).not.toContain("rightMenu");
    expect(panelNav).not.toContain("settingsToggle");
  });

  it("the keyboard verdict: no keyboard verb opens settings — P stays photo, Esc stays the browser's", () => {
    expect(Object.values(KEY_VERBS)).not.toContain("settingsToggle");
    expect(KEY_VERBS["KeyP"]).toBe("photoMode");
    /* The door chip — the keyboard/mouse road — is untouched. */
    expect(page).toContain('data-testid="world-settings-door"');
    expect(page).toContain("onClick={toggleSettingsPanel}");
  });
});

describe("clean fullscreen — the furniture fades, the World speaking never does", () => {
  it("the page root wears the hud classes, and the idle hook's bargain excludes every open surface", () => {
    expect(page).toContain('className={`world-hud flex min-h-screen flex-col ${hudIdle ? "hud-idle" : ""}');
    const bargain = segment(page, "const hudIdle = useHudIdle({", "});");
    for (const closed of [
      "status === \"inside\"",
      "!photoMode",
      "worldOverlay(status) === null",
      "!panelTarget",
      "!charPanelOpen",
      "!screenPanelOpen",
      "!hostPanelOpen",
      "!settingsPanelOpen",
      "!radioOpen",
    ]) {
      expect(bargain).toContain(closed);
    }
  });

  it("exactly five seats carry the fade mark — header, footer, compass, keyboard hint, radio chip", () => {
    /* Attribute usages only (a comment naming the mark in
     * brackets is not a seat). */
    expect(page.match(/[\s"]data-hud-fade[\s>]/g)).toHaveLength(5);
    expect(page).toContain("<header data-hud-fade");
    expect(page).toContain("<footer data-hud-fade");
    expect(page).toContain('data-testid="world-guide" data-hud-fade');
    expect(page).toContain('data-testid="world-plaza-radio-open"');
    const radioChip = segment(page, 'data-testid="world-plaza-radio-open"', 'onClick={() => setRadioOpen(true)}');
    expect(radioChip).toContain("data-hud-fade");
  });

  it("the never-fade seats carry no mark: announcements, the re-enter chip, panels, prompts", () => {
    /* The fullscreen re-enter chip's whole job is being seen. */
    const reenter = segment(page, 'data-testid="world-fs-reenter"', "{/* Wayfinding");
    expect(reenter).not.toContain("data-hud-fade");
    /* The witnessed-moment banner — the World speaking. */
    const moment = segment(page, 'data-testid="world-moment-banner"', "{/* Controls hint");
    expect(moment).not.toContain("data-hud-fade");
    /* The open radio panel is a panel, not furniture. */
    const radioPanel = segment(page, 'data-testid="world-plaza-radio"', 'data-testid="world-plaza-radio-close"');
    expect(radioPanel).not.toContain("data-hud-fade");
    /* The settings panel itself never fades. */
    expect(panel).not.toContain("data-hud-fade");
  });

  it("the fade is opacity only — no seat moves, shrinks or vanishes from layout", () => {
    const rules = segment(css, ".world-hud [data-hud-fade]", "/* ── 17.");
    expect(rules).toContain("transition: opacity 0.6s ease;");
    expect(rules).toContain(".world-hud.hud-idle [data-hud-fade]");
    expect(rules).toContain("opacity: 0;");
    expect(rules).toContain("pointer-events: none;");
    expect(rules).not.toContain("display:");
    expect(rules).not.toContain("visibility:");
    expect(rules).not.toContain("transform:");
    /* The seats keep their exact geometry classes when present. */
    expect(page).toContain("relative z-20 border-t py-3 pl-24 pr-24");
    expect(page).toContain("relative z-20 flex flex-wrap items-center gap-3 border-b px-4 py-3");
  });

  it("the hook wakes on pointer, keys and pad — and never sleeps under a focused text field", () => {
    expect(hook).toContain('window.addEventListener("pointermove", onPointer, { passive: true });');
    expect(hook).toContain('window.addEventListener("pointerdown", onPointer);');
    expect(hook).toContain('window.addEventListener("keydown", onKey);');
    expect(hook).toContain("pad.buttons.some((b) => b.pressed)");
    expect(hook).toContain("pad.axes.some((a) => Math.abs(a) > 0.3)");
    expect(hook).toContain("!textFocused && hudIdleDue(lastActivity, performance.now())");
    /* Disabled means awake: a panel opening restores the
     * furniture in the same state change that opened it. */
    expect(hook).toContain("if (!enabled) {");
    expect(hook).toContain("setIdle(false);");
  });
});

describe("the Help section names both halves of the directive", () => {
  it("the pad line leads with the menu button's new primary job", () => {
    expect(panel).toContain(
      '{padWord(padProfile, "rightMenu")} opens these settings (hold it to frame a photo)',
    );
  });

  it("one line names the menu button and the fading furniture, in the pad's own word", () => {
    const line = segment(panel, 'data-testid="world-menu-line"', "</Section>");
    expect(line).toContain("opens these settings from");
    expect(line).toContain("anywhere in the World — press it again to put them away.");
    expect(line).toContain("the bars");
    expect(line).toContain("around the screen fade away while you play");
    expect(line).toContain('{padWord(padProfile, "rightMenu")}');
    /* Without a pad, the honest road is the door chip. */
    expect(line).toContain("The Settings &amp; help chip below opens this panel from");
  });
});
