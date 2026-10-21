import { describe, it, expect } from "vitest";
import {
  defaultEditorSettings, defaultClipEdit, defaultProTools,
  getClipEdit, normalizeEditorSettings, proToolsActive,
  type ProToolsSettings,
} from "./editor-settings";
import { segmentsFromCustomCurve } from "./motion-pro";

/* Persistence for drawn speed curves (Wave 3 #18): the points live on
 * ProToolsSettings.customSpeedCurve inside the per-clip edit record, which
 * the project state stores wholesale (clips pass through
 * normalizeEditorSettings untouched) — no migration, no schema change. */
describe("drawn speed curve persistence (Wave 3 #18)", () => {
  const points = [
    { t: 0, speed: 0.5 }, { t: 0.5, speed: 1 }, { t: 1, speed: 2 },
  ];

  it("defaults to no drawn curve", () => {
    expect(defaultProTools().customSpeedCurve).toBeNull();
  });

  it("round-trips points + derived segments through a project save/load", () => {
    const segs = segmentsFromCustomCurve(points);
    const settings = defaultEditorSettings();
    settings.clips["scene-1"] = {
      ...defaultClipEdit(),
      proTools: { ...defaultProTools(), customSpeedCurve: points, speedSegments: segs },
    };
    // Save = JSON serialize; load = normalize + getClipEdit, as in the app.
    const revived = JSON.parse(JSON.stringify(settings)) as typeof settings;
    const loaded = getClipEdit(normalizeEditorSettings(revived), "scene-1");
    expect(loaded.proTools.customSpeedCurve).toEqual(points);
    expect(loaded.proTools.speedSegments?.map((s) => [s.startT, s.endT, s.speed]))
      .toEqual(segs.map((s) => [s.startT, s.endT, s.speed]));
  });

  it("a clip carrying a drawn curve counts as pro-tools active (export sends it)", () => {
    const pt: ProToolsSettings = {
      ...defaultProTools(),
      customSpeedCurve: points,
      speedSegments: segmentsFromCustomCurve(points),
    };
    expect(proToolsActive(pt)).toBe(true);
  });

  it("legacy projects without the field load as no drawn curve", () => {
    const legacy = defaultProTools() as Partial<ProToolsSettings>;
    delete legacy.customSpeedCurve;
    const settings = defaultEditorSettings();
    settings.clips["scene-1"] = {
      ...defaultClipEdit(),
      proTools: legacy as ProToolsSettings,
    };
    const loaded = getClipEdit(normalizeEditorSettings(settings), "scene-1");
    expect(loaded.proTools.customSpeedCurve ?? null).toBeNull();
  });
});
