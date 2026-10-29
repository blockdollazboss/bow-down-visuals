/**
 * World controller survival (owner's live walk, 2026-10-29,
 * controller as primary input, stack600 build):
 *
 *   1. "The screen isn't full screen anymore" — and his frame
 *      caught the gold recovery chip mid-session: fullscreen
 *      had dropped involuntarily and the only road back the
 *      build offered was a tap.
 *   2. "Once I click to do something in the VR world, my
 *      controller just stops. I can't select anything on that
 *      screen." — at the Creator Rooms door he could not enter:
 *      the panel's enter controls are DOM, and nothing wired
 *      the pad to the DOM.
 *   3. "Way too many menus in the frame" — page-state and
 *      in-scene defaults stacked panels nobody opened.
 *
 * These pins hold the repairs at the source level (the
 * automation browser has no gamepad and no WebGL2 — the owner's
 * retest is the live verdict; the mechanism pins live here and
 * in gamepad.test.ts / panel-nav.test.ts):
 *
 *   A. the pad can toggle fullscreen (Back hold, scene
 *      dispatch, the page's own toggleFs behind the verb gate);
 *      while the involuntary-drop recovery is armed, ANY pad
 *      press spends the same arm the pointer click spends;
 *      the chip's words name the controller road too;
 *   B. every panel family carries the pad-navigation hook; the
 *      scene is told to stand its pad verbs down for exactly
 *      the same open panels; the station close is one shared
 *      path for button, Escape and B;
 *   C. the spawn frame's defaults: the door picker stays at the
 *      door, the radio starts as a chip, the WASD pill steps
 *      aside for pad walkers, one panel opens at a time, and
 *      room-entry lines replace instead of stacking.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("world controller survival — fullscreen by pad", () => {
  const page = read("../../pages/world.tsx");
  const scene = read("./hall-scene.ts");

  it("the scene dispatches the pad's fullscreen toggle and the page answers through toggleFs", () => {
    expect(scene).toContain("onPadFullscreenToggle");
    expect(scene).toContain("if (intent.fullscreenToggle) this.onPadFullscreenToggle?.();");
    expect(page).toContain("scene.onPadFullscreenToggle = () => {");
    expect(page).toContain('verbRoleOk("fullscreen", myRole())');
  });

  it("while the drop recovery is armed, a pad press spends the same arm a click spends", () => {
    expect(page).toContain("fsRecoveryOnReenterClick(fsRecoveryRef.current)");
    /* Both spenders exist: the pointer road (stack600) and the
       pad poll (stack700) — and the pad road reads the pad
       through the shared firstGamepad, not a private probe. */
    expect(page).toContain('document.addEventListener("pointerdown", onPointer, true)');
    expect(page).toContain("firstGamepad([...(navigator.getGamepads?.() ?? [])])");
  });

  it("the recovery chip names the controller road back in", () => {
    expect(page).toContain("Full screen dropped — tap or press any controller button to go back in");
  });

  it("the footer pad line teaches the panel keys and the fullscreen hold", () => {
    expect(page).toContain("In a panel, the D-pad moves, A chooses and B goes back; hold Back for full");
  });
});

describe("world controller survival — panels answer the pad", () => {
  const page = read("../../pages/world.tsx");
  const scene = read("./hall-scene.ts");

  it("every panel family carries the pad-navigation hook", () => {
    expect(page).toContain("usePanelPadNav({");
    expect(page).toContain('data-testid="world-station-panel"], [data-testid="world-station-stepthrough"], [data-testid="world-studio-stepthrough"]');
    expect(page).toContain("'[data-testid=\"world-char-panel\"]'");
    expect(page).toContain("'[data-testid=\"world-screen-panel\"]'");
    expect(page).toContain("'[data-testid=\"world-host-panel\"]'");
    expect(page).toContain('data-testid="world-char-panel"');
  });

  it("the scene stands its pad verbs down for exactly the panels the hooks serve", () => {
    expect(scene).toContain("padPanelHold = false");
    expect(scene).toContain("if (pad && !this.padPanelHold)");
    /* stack900: the virtual keyboard joined the holders — the
       scene stands down while the walker types on the board
       exactly as it does under a panel, so this pin grew the
       vkbdOpen term with the derivation. */
    expect(page).toContain(
      "scene.padPanelHold = Boolean(panelTarget) || charPanelOpen || screenPanelOpen || hostPanelOpen || vkbdOpen;",
    );
  });

  it("the station close is one shared path — button, Escape and the pad's B", () => {
    expect(page).toContain("const closeStation = () => {");
    expect(page).toContain("onClose={closeStation}");
    expect(page).toContain("onClose: closeStation,");
  });
});

describe("world controller survival — the spawn frame's defaults", () => {
  const page = read("../../pages/world.tsx");
  const radio = read("../../components/discovery/ChartsRadio.tsx");
  const picker = read("../../components/world/WalkInAsPicker.tsx");

  it("the walk-in picker stands at the door only; inside, the character panel carries it", () => {
    expect(page).toContain('user && status !== "inside" ? (');
    expect(page).toContain('data-testid="world-char-panel"');
  });

  it("the picker clears the shell's sticky banner when scrolled into view", () => {
    expect(picker).toContain("scroll-mt-32");
    expect(picker).toContain("md:scroll-mt-40");
  });

  it("the radio dock starts closed behind its chip, with a way to close it again", () => {
    expect(page).toContain("const [radioOpen, setRadioOpen] = useState(false);");
    expect(page).toContain('data-testid="world-plaza-radio-open"');
    expect(page).toContain('data-testid="world-plaza-radio-close"');
  });

  it("the compact radio header gives the buttons their own row — the title is never squeezed beside them", () => {
    expect(radio).toContain('compact ? "w-full" : ""');
  });

  it("the WASD pill steps aside when a controller is connected", () => {
    expect(page).toContain('status === "inside" && !photoMode && !padConnected && (');
  });

  it("one panel at a time: a desk opening retires the strips, and strip toggles retire each other", () => {
    expect(page).toContain("const toggleStripPanel = (which: \"char\" | \"screen\" | \"host\") => {");
    expect(page).toContain('onClick={() => toggleStripPanel("char")}');
    expect(page).toContain('onClick={() => toggleStripPanel("screen")}');
    expect(page).toContain('onClick={() => toggleStripPanel("host")}');
    /* The desk-open choke point closes all three strips. */
    const deskEffect = page.slice(page.indexOf("openedDeskRef.current = true;"));
    expect(deskEffect.slice(0, 900)).toContain("setCharPanelOpen(false);");
    expect(deskEffect.slice(0, 900)).toContain("setScreenPanelOpen(false);");
    expect(deskEffect.slice(0, 900)).toContain("setHostPanelOpen(false);");
  });

  it("room-entry lines replace instead of stacking", () => {
    expect(page).toContain('e.body.startsWith("You walked into")');
  });

  it("the footer clears the guide's parked box on the left as it already did on the right", () => {
    expect(page).toContain("py-3 pl-24 pr-24");
  });

  it("the pad help line is one flowing paragraph, not a row of flex items", () => {
    const padLine = page.slice(page.indexOf('data-testid="world-pad-line"') - 200);
    expect(padLine.slice(0, 200)).toContain("flex items-start gap-2");
    expect(padLine.slice(0, 400)).not.toContain("inline-flex items-center gap-2 text-xs font-semibold");
  });
});
