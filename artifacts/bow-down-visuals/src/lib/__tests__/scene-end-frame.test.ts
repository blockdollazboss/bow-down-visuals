/**
 * Scene Studio end-frame support seam — the client mirror of the
 * server's CLIP_END_FRAME_SUPPORT. Unsupported models (gen4.5, whose
 * PromptImage position is 'first' only) must get neither the control
 * nor the payload field.
 */
import { describe, it, expect } from "vitest";
import {
  SCENE_END_FRAME_SUPPORT,
  modelSupportsEndFrame,
  endFrameForPayload,
} from "../scene-end-frame";

const END = "https://cdn.test/end.jpg";

describe("modelSupportsEndFrame", () => {
  it("matches the provider evidence per model", () => {
    expect(SCENE_END_FRAME_SUPPORT).toEqual({ "gen4.5": false, seedance2_5: true, veo3_1: true });
    expect(modelSupportsEndFrame("gen4.5")).toBe(false);
    expect(modelSupportsEndFrame("seedance2_5")).toBe(true);
    expect(modelSupportsEndFrame("veo3_1")).toBe(true);
    expect(modelSupportsEndFrame("unknown_model")).toBe(false);
  });
});

describe("endFrameForPayload", () => {
  it("passes the URL through for supporting models", () => {
    expect(endFrameForPayload("seedance2_5", END)).toBe(END);
    expect(endFrameForPayload("veo3_1", END)).toBe(END);
    expect(endFrameForPayload("seedance2_5", `  ${END}  `)).toBe(END);
  });

  it("omits the field (undefined) for gen4.5 even when a frame is set", () => {
    expect(endFrameForPayload("gen4.5", END)).toBeUndefined();
    /* JSON.stringify drops undefined — the parameter is absent on the wire. */
    expect(JSON.stringify({ endFrameImageUrl: endFrameForPayload("gen4.5", END) })).toBe("{}");
  });

  it("omits the field when no frame is set or it is blank", () => {
    expect(endFrameForPayload("seedance2_5", null)).toBeUndefined();
    expect(endFrameForPayload("seedance2_5", undefined)).toBeUndefined();
    expect(endFrameForPayload("seedance2_5", "   ")).toBeUndefined();
  });
});
