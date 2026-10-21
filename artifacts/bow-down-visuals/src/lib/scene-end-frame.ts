/**
 * End-frame (last-frame) keyframe support for Scene Studio clip models.
 *
 * Mirrors the server record CLIP_END_FRAME_SUPPORT in
 * artifacts/api-server/src/routes/generate/clip-pricing.ts, grounded in the
 * provider request builders vendored in this repo (@runwayml/sdk
 * image-to-video param types + the Gemini Veo client):
 *  - gen4.5 ("Standard"): PromptImage position is 'first' ONLY — no last
 *    frame exists on this model, so the control is hidden and the field is
 *    never sent.
 *  - seedance2_5 ("Premium"): PromptImage position is 'first' | 'last'
 *    (keyframe mode).
 *  - veo3_1 ("Cinematic"): Veo 3.1 accepts a lastFrame next to the first
 *    frame (first/last-frame interpolation).
 *
 * House rule: unsupported models must neither show the control nor receive
 * the parameter — hiding is honest, a disabled-but-sent field is not.
 */
export type SceneClipModel = "gen4.5" | "seedance2_5" | "veo3_1";

export const SCENE_END_FRAME_SUPPORT: Record<SceneClipModel, boolean> = {
  "gen4.5": false,
  seedance2_5: true,
  veo3_1: true,
};

export function modelSupportsEndFrame(model: string): boolean {
  return (SCENE_END_FRAME_SUPPORT as Record<string, boolean>)[model] === true;
}

/**
 * The endFrameImageUrl value for a generation payload: the trimmed URL
 * only when the chosen model supports end frames and the scene has one
 * set. Otherwise undefined, so JSON.stringify omits the field entirely —
 * the parameter is absent, not null, for unsupported models.
 */
export function endFrameForPayload(
  model: string,
  url: string | null | undefined,
): string | undefined {
  if (!modelSupportsEndFrame(model)) return undefined;
  const trimmed = url?.trim();
  return trimmed ? trimmed : undefined;
}
