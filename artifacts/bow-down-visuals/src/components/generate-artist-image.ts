/**
 * Pure helpers for AI artist-image generation (no JSX / no React deps),
 * so they can be unit-tested under the repo's node-environment vitest config.
 */

export type ArtistImageModel = "gen4_image" | "gen4_image_turbo" | "gpt-image-2.5-sunburst";
export type ArtistImageRatio = "1080:1920" | "1080:1080" | "1920:1080";

export interface ArtistProfileFormLike {
  visualStyle: string;
  artistType: string;
  hair: string;
  tattoos: string;
  jewelry: string;
  clothingStyle: string;
  brandColors: string;
  personality: string;
  genre: string;
  doNotChangeRules: string;
}

export const ARTIST_IMAGE_MODELS: { id: ArtistImageModel; label: string; credits: number; hint: string }[] = [
  { id: "gpt-image-2.5-sunburst", label: "GPT Image 2.5", credits: 2, hint: "Best quality · hyper-realistic" },
  { id: "gen4_image", label: "Gen4 Image", credits: 3, hint: "Alternative" },
  { id: "gen4_image_turbo", label: "Turbo", credits: 2, hint: "Fast · needs photo" },
];

export const ARTIST_IMAGE_RATIOS: { id: ArtistImageRatio; label: string }[] = [
  { id: "1080:1920", label: "Portrait" },
  { id: "1080:1080", label: "Square" },
  { id: "1920:1080", label: "Landscape" },
];

/** Pre-fills the image prompt from the artist profile's own fields. */
export function buildArtistImagePrompt(v: ArtistProfileFormLike): string {
  const parts: string[] = [
    "Professional artist portrait photograph, front-facing, looking at camera, upper body, studio lighting",
  ];
  if (v.visualStyle) parts.push(v.visualStyle);
  if (v.artistType) parts.push(v.artistType);
  if (v.genre) parts.push(`${v.genre} aesthetic`);
  if (v.hair) parts.push(`hair: ${v.hair}`);
  if (v.tattoos) parts.push(`tattoos: ${v.tattoos}`);
  if (v.jewelry) parts.push(`jewelry: ${v.jewelry}`);
  if (v.clothingStyle) parts.push(`wearing ${v.clothingStyle}`);
  if (v.brandColors) parts.push(`brand colors ${v.brandColors}`);
  if (v.personality) parts.push(`${v.personality} expression`);
  let p = `${parts.join(", ")}. Photorealistic, high detail, sharp focus.`;
  if (v.doNotChangeRules) p += ` Strict rules: ${v.doNotChangeRules}`;
  return p.slice(0, 900);
}
