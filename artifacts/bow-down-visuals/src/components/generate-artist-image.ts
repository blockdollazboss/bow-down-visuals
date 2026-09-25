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

/* ── Photo Shoot mode: identity-locked outfit/pose/backdrop variations ── */

export interface ShootPose { id: string; label: string; fragment: string }
export interface ShootPreset { label: string; text: string }

export const SHOOT_POSES: ShootPose[] = [
  { id: "portrait", label: "Portrait", fragment: "upper-body portrait, looking directly at camera" },
  { id: "fullbody", label: "Full body", fragment: "full-body shot, head to toe, confident stance" },
  { id: "throne", label: "Throne pose", fragment: "seated on a golden throne, powerful regal pose" },
  { id: "action", label: "Action", fragment: "dynamic action pose, mid-movement, dramatic energy" },
];

export const SHOOT_OUTFITS: ShootPreset[] = [
  { label: "Signature gold robe", text: "signature dark robe with gold trim, gold bead necklace with fish-skeleton pendant, gold crown" },
  { label: "Black streetwear", text: "black streetwear — oversized black hoodie, black cargo pants, chunky gold chain" },
  { label: "Gold-trimmed suit", text: "tailored black suit with gold trim, gold pocket square, luxury watch" },
  { label: "Stage performer", text: "stage performer outfit — black leather jacket with gold embroidery, dark jeans, boots" },
  { label: "Casual luxury", text: "casual luxury — cream knit sweater, gold bracelets, designer sunglasses" },
  { label: "Red-carpet", text: "red-carpet look — all-black tuxedo with gold lapel pin, polished shoes" },
];

export const SHOOT_BACKGROUNDS: ShootPreset[] = [
  { label: "Keep as reference", text: "same setting and background as the reference photo" },
  { label: "Studio", text: "in a professional photo studio with a dark backdrop and softbox lighting" },
  { label: "Stage", text: "on a concert stage with dramatic spotlights and crowd bokeh" },
  { label: "Throne room", text: "in a golden throne room, opulent palace interior" },
];

/** Composes the photo-shoot brief from the selected pose, outfit, and backdrop. */
export function composePhotoShootBrief(poseId: string, outfit: string, background: string): string {
  const pose = SHOOT_POSES.find((p) => p.id === poseId) ?? SHOOT_POSES[0];
  const parts = [
    `Professional photo shoot photograph, ${pose.fragment}`,
    outfit.trim() ? `wearing ${outfit.trim()}` : null,
    background.trim() || null,
  ].filter(Boolean);
  return `${parts.join(". ")}. Photorealistic, ultra detailed, sharp focus, cinematic lighting.`;
}
