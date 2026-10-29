import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/* The in-World virtual keyboard (stack900) — wiring pins.
 * The behaviour lives in lib/world/virtual-keyboard.test.ts;
 * these pins hold the composition the behaviour depends on:
 * the board is a pad family inside the page's one arbitration
 * derivation (never a second pad reader fighting the panels),
 * the scene stands down while it is open, and every edit
 * travels the field's real onChange road. */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("../../pages/world.tsx");
const board = read("../../components/world/VirtualKeyboard.tsx");
const lib = read("./virtual-keyboard.ts");

describe("virtual keyboard wiring — pad arbitration", () => {
  it("the board rides the existing panel pad hook, B is its way out", () => {
    expect(board).toContain("usePanelPadNav({");
    expect(board).toContain("active: open,");
    expect(board).toContain("onClose: () => closeRef.current(true),");
  });

  it("while the board is open, every other panel family stands its pad reader down", () => {
    expect(page).toContain('active: panelTarget !== null && status === "inside" && !vkbdOpen,');
    expect(page).toContain('active: charPanelOpen && status === "inside" && !vkbdOpen,');
    expect(page).toContain('active: screenPanelOpen && status === "inside" && !vkbdOpen,');
    expect(page).toContain('active: hostPanelOpen && status === "inside" && !vkbdOpen,');
  });

  it("the scene stands down for the board through the same derivation", () => {
    expect(page).toContain("hostPanelOpen || vkbdOpen;");
    expect(page).toContain("const [vkbdOpen, setVkbdOpen] = useState(false);");
  });

  it("the board is mounted once, scoped to the World page root", () => {
    expect(page).toContain("<WorldVirtualKeyboard");
    expect(page).toContain("resolveScope={() => pageRef.current}");
    expect(page).toContain("onOpenChange={setVkbdOpen}");
    expect(page).toContain("padConnected={padConnected}");
  });
});

describe("virtual keyboard wiring — the summon and the roads in", () => {
  it("a focus census of the page root summons it — no per-field wiring", () => {
    expect(board).toContain('document.addEventListener("focusin", onFocusIn)');
    expect(board).toContain("isVirtualKeyboardFieldShape({");
    expect(board).toContain("shouldSummonVirtualKeyboard({");
    expect(board).toContain("document.fullscreenElement");
  });

  it("edits travel the native setter + real input event road, never a plain assignment", () => {
    expect(board).toContain("commitFieldEdit(el, next, () => new Event(\"input\", { bubbles: true }))");
    expect(lib).toContain("Object.getOwnPropertyDescriptor(proto, \"value\")");
    expect(lib).toContain("desc.set.call(el, value)");
  });

  it("mouse clicks never blur the field mid-word; Esc closes the board only", () => {
    expect(board).toContain("onMouseDown={(e) => e.preventDefault()}");
    expect(board).toContain('if (e.key === "Escape")');
    expect(board).toContain('data-testid="world-virtual-keyboard"');
    expect(board).toContain('data-testid="world-vkbd-close"');
  });

  it("a single-line Enter speaks the key, then takes the form's real submit road", () => {
    expect(board).toContain('new KeyboardEvent("keydown", init)');
    expect(board).toContain("el.form?.requestSubmit()");
    expect(board).toContain('el.dataset.testid === "world-say-input"');
  });

  it("the seam with the controller-identity lane is respected: no controller-profile module, glyphs not button names", () => {
    expect(board).not.toContain("controller-profile");
    expect(lib).not.toContain("controller-profile");
    expect(lib).toContain('"⌫"');
    expect(lib).toContain('"⇧"');
  });
});
