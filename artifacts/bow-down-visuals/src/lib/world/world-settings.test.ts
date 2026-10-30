/**
 * World settings home (stack900, owner's directive 2026-10-29):
 * "We should have some type of settings inside the virtual
 * world, not outside on the web page or the little bars on top
 * of the screen. This should be full screen mode."
 *
 * Until this lane, the World's settings were scattered exactly
 * where the ruling forbids: a view toggle and a quality cycle in
 * the footer's control row, an announcements switch in the
 * header, a whole help paragraph riding the footer as a strip,
 * and the rest out on the web /settings page. This suite pins
 * the repair at the source level (the automation browser has no
 * WebGL2 and no gamepad — the owner's walk is the live verdict):
 *
 *   - ONE settings panel, mounted under the page root — the
 *     fullscreen element — so opening it can never drop the
 *     walker's fullscreen, and its open/close paths never touch
 *     an exit-fullscreen call;
 *   - the panel is the pad's fifth family, and the scene's hold
 *     folds it in like the other four;
 *   - every control writes through the store its scattered twin
 *     already used (view mode's shared state + storeViewMode
 *     effect, the header's own announce handler, the footer's
 *     own quality cycle, toggleFs itself) — a second door to the
 *     same rooms, never a second truth, and no invented store;
 *   - the help strip is retired to a single slim door chip in
 *     its exact footer place, its full content readable in the
 *     panel's Help section; the banner/pill/playlist corner
 *     seats above the page never moved;
 *   - the button-map row is a seam, not a fake door: it renders
 *     only when the page passes the map's opener, and this tree
 *     passes none (lane B6's panel is a sibling, joined later).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("../../pages/world.tsx");
const panel = read("../../components/world/WorldSettingsPanel.tsx");

const segment = (src: string, from: string, to: string) => {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a);
  expect(a, `segment start ${from}`).toBeGreaterThanOrEqual(0);
  expect(b, `segment end ${to}`).toBeGreaterThan(a);
  return src.slice(a, b);
};

describe("world settings — one panel inside the fullscreen root", () => {
  it("the fullscreen root is the page root, and the settings mount stands under it", () => {
    /* The stack600 law: toggleFs targets pageRef — the root the
       whole page (header, room, panels, footer) renders under. */
    expect(page).toContain("toggleFullscreen(document, pageRef.current)");
    expect(page).toContain('data-testid="world-page-root"');
    const rootAt = page.indexOf("ref={pageRef}");
    const mountAt = page.indexOf("<WorldSettingsPanel");
    const footerAt = page.indexOf("<footer");
    expect(rootAt).toBeGreaterThanOrEqual(0);
    /* Source order is the ancestry: the mount sits between the
       root's opening and the footer, in the same band as the
       other strip panels — inside the fullscreen element. */
    expect(mountAt).toBeGreaterThan(rootAt);
    expect(mountAt).toBeLessThan(footerAt);
    expect(panel).toContain('data-testid="world-settings-panel"');
  });

  it("opening and closing the panel never reaches an exit-fullscreen path", () => {
    const toggle = segment(page, "const toggleSettingsPanel = () => {", "};");
    expect(toggle).not.toContain("Fullscreen");
    expect(toggle).not.toContain("exit");
    /* The panel component itself holds no fullscreen machinery
       at all — the one road it is handed is the toggle prop. */
    expect(panel).not.toContain("exitFullscreen");
    expect(panel).not.toContain("requestFullscreen");
    expect(panel).toContain("onToggleFullscreen");
    /* And the page hands it the header button's own toggleFs. */
    expect(page).toContain("onToggleFullscreen={toggleFs}");
    /* The pad's way out is the panel's own close state. */
    expect(page).toContain("onClose: () => setSettingsPanelOpen(false)");
  });

  it("the settings panel is the pad's fifth family, folded into the scene hold", () => {
    const family = segment(
      page,
      "active: settingsPanelOpen && status === \"inside\"",
      "});",
    );
    expect(family).toContain('[data-testid="world-settings-panel"]');
    /* The families' derivation line stands as composed at the
       stack900 join (it grew the virtual keyboard's and the
       controller map's terms when those families landed); the
       settings fold stands verbatim on the next line. */
    expect(page).toContain(
      "scene.padPanelHold = Boolean(panelTarget) || charPanelOpen || screenPanelOpen || hostPanelOpen || vkbdOpen || padMapOpen;",
    );
    expect(page).toContain("scene.padPanelHold = scene.padPanelHold || settingsPanelOpen;");
  });

  it("one strip at a time, from both sides", () => {
    const toggle = segment(page, "const toggleSettingsPanel = () => {", "};");
    expect(toggle).toContain("setCharPanelOpen(false);");
    expect(toggle).toContain("setScreenPanelOpen(false);");
    expect(toggle).toContain("setHostPanelOpen(false);");
    expect(toggle).toContain("setPanelTarget(null);");
    /* And any of those opening retires the settings panel —
       at the stack900 join the controller map joined the list,
       so this pin carries its term too. */
    expect(page).toContain(
      "if (panelTarget || charPanelOpen || screenPanelOpen || hostPanelOpen || padMapOpen) setSettingsPanelOpen(false);",
    );
  });
});

describe("world settings — every control writes through its existing store", () => {
  it("view: the panel drives the page's viewMode state, the one storeViewMode persists", () => {
    /* The shared persistence effect is untouched. */
    expect(page).toContain("storeViewMode(viewMode);");
    expect(page).toContain("sceneRef.current?.setViewMode(viewMode);");
    /* The panel receives that very state and its setter. */
    expect(page).toContain("viewMode={viewMode}");
    expect(page).toContain("onViewModeChange={setViewMode}");
    /* Both directions stand as real buttons in the panel. */
    expect(panel).toContain('testId: "world-settings-view-third"');
    expect(panel).toContain('testId: "world-settings-view-first"');
    expect(panel).toContain("data-testid={testId}");
    expect(panel).toContain("onViewModeChange(mode)");
  });

  it("sound: the announcements switch is the header toggle's own handler", () => {
    /* Header button, panel prop — one handler, one device store. */
    expect(page).toContain("onToggleAnnounceMuted={toggleAnnounceMuted}");
    expect(page.split("toggleAnnounceMuted").length - 1).toBeGreaterThanOrEqual(3);
    expect(panel).toContain('data-testid="world-settings-announce"');
    expect(panel).toContain("onClick={onToggleAnnounceMuted}");
    expect(panel).toContain('role="switch"');
  });

  it("sound: the master volume row (lane G3, joined) writes through the passed handler", () => {
    /* B7's census found no master store, so this row did not
       exist on its base; lane G3 built the real store, and at
       the stack900 join the Sound section gained the row as a
       second door to it — props in, handler out, the panel
       itself still persists nothing (see the no-store pin). */
    expect(page).toContain("worldVolume={worldVolume}");
    expect(page).toContain(
      "onWorldVolumeChange={(next: WorldVolume) => setWorldVolume(next)}",
    );
    expect(panel).toContain('data-testid="world-settings-volume-mute"');
    expect(panel).toContain('data-testid="world-settings-volume-slider"');
    expect(panel).toContain("withWorldVolumeMuted(worldVolume, !worldVolume.muted)");
    expect(panel).toContain("withWorldVolumeLevel(worldVolume, Number(e.currentTarget.value))");
    expect(panel).toContain("onWorldVolumeChange");
  });

  it("display: quality cycles through the footer's own next-preference step", () => {
    expect(page).toContain(
      "onCycleQuality={() => setQualityPref((q) => nextQualityPreference(q))}",
    );
    expect(panel).toContain('data-testid="world-settings-quality"');
    expect(panel).toContain("qualityPreferenceLabel(qualityPref)");
    expect(panel).toContain('data-testid="world-settings-fullscreen"');
    expect(panel).toContain("onClick={onToggleFullscreen}");
  });

  it("controller: the section renders B1's reactive profile, passed from the page's one hook", () => {
    expect(page).toContain("const padProfile = useControllerProfile();");
    expect(page).toContain("padProfile={padProfile}");
    expect(panel).toContain("padProfile.displayName");
    expect(panel).toContain("FAMILY_WORDS[padProfile.family]");
  });

  it("no invented store: the panel persists nothing itself", () => {
    expect(panel).not.toContain("localStorage");
    expect(panel).not.toContain("Storage");
    /* The page's settings state is plain session state, like
       every other strip's. */
    expect(page).toContain("const [settingsPanelOpen, setSettingsPanelOpen] = useState(false);");
  });
});

describe("world settings — the strip retires to a door; the corner seats never moved", () => {
  it("the footer carries one slim door chip where the help strip stood", () => {
    expect(page).toContain('data-testid="world-settings-door"');
    expect(page).toContain("onClick={toggleSettingsPanel}");
    expect(page).toContain("aria-expanded={settingsPanelOpen}");
    /* The door stands in the footer's first row — before the
       action bar, where the strip stood. */
    expect(page.indexOf('data-testid="world-settings-door"')).toBeLessThan(
      page.indexOf('data-testid="world-action-bar"'),
    );
    /* The strip itself is gone from the page… */
    expect(page).not.toContain('data-testid="world-pad-line"');
    /* …and stands readable in the panel's Help section. */
    expect(panel).toContain('data-testid="world-pad-line"');
    expect(panel).toContain('data-testid="world-keys-line"');
  });

  it("banner, stage plate, guide, radio and footer corner reservations keep their seats", () => {
    expect(page).toContain('data-testid="world-stage-plate"');
    expect(page).toContain("left-1/2 top-3 z-10");
    expect(page).toContain('data-testid="world-guide"');
    expect(page).toContain("left-1/2 top-14 z-10");
    expect(page).toContain("fixed bottom-24 left-3 z-30");
    expect(page).toContain("py-3 pl-24 pr-24");
  });

  it("the button-map row is a seam: rendered only when an opener is passed — and the joined tree passes B6's", () => {
    expect(panel).toContain("{buttonMap && (");
    expect(panel).toContain('data-testid="world-settings-button-map"');
    expect(panel).toContain("buttonMap?: { onOpen: () => void }");
    /* On B7's own base the page passed no opener and the row
       was omitted; at the stack900 join lane B6's map landed,
       so the mount now wires the seam — opening the map
       retires this panel first (one panel at a time). */
    const mount = segment(page, "<WorldSettingsPanel", "/>");
    expect(mount).toContain(
      "buttonMap={{ onOpen: () => { setSettingsPanelOpen(false); setPadMapOpen(true); } }}",
    );
  });
});
