/**
 * scene-end-frame-wiring.test.ts — source pins for end-frame keyframe
 * control in Scene Studio:
 *  (a) the EndFramePicker renders ONLY behind modelSupportsEndFrame —
 *      hidden for gen4.5, not disabled-with-a-lie;
 *  (b) the generation payload routes the scene's end frame through
 *      endFrameForPayload, so unsupported models never receive the field;
 *  (c) the picker draws from the same Locations library (and its upload
 *      endpoint) as the scene's start/location image;
 *  (d) the end frame lives on SceneData and on the locked pack's
 *      ingredients (checked in the schema source) — one structure, no
 *      parallel path.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const studio = readFileSync(new URL("./SceneStudio.tsx", import.meta.url), "utf8");
const sceneParser = readFileSync(new URL("../lib/scene-parser.ts", import.meta.url), "utf8");
const packSchema = readFileSync(
  new URL("../../../../lib/db/src/schema/preproduction-packs.ts", import.meta.url),
  "utf8",
);

describe("end-frame wiring — control visibility", () => {
  it("the picker is gated on the support check against the picked model", () => {
    expect(studio).toContain("modelSupportsEndFrame(clipModel)");
    expect(studio).toContain("<EndFramePicker scene={scene} onPick={onUpdate} />");
  });

  it("the picker offers library picking and upload through the locations rail", () => {
    expect(studio).toContain("function EndFramePicker");
    expect(studio).toContain("fetchLocationsLibrary(getAccessToken)");
    expect(studio).toContain('"/api/locations/upload"');
    expect(studio).toContain('data-testid="end-frame-open"');
    expect(studio).toContain('data-testid="end-frame-clear"');
  });
});

describe("end-frame wiring — payload + storage", () => {
  it("the generation payload goes through endFrameForPayload", () => {
    expect(studio).toContain(
      "endFrameImageUrl: endFrameForPayload(clipModel, scene.endFrameImageUrl)",
    );
  });

  it("SceneData carries the end frame next to the location image", () => {
    expect(sceneParser).toContain("endFrameImageUrl?: string | null;");
    expect(sceneParser).toContain("locationImageUrl?: string | null;");
  });

  it("the locked pack ingredients carry the end frame", () => {
    expect(packSchema).toContain("endFrameImageUrl?: string | null;");
  });
});
