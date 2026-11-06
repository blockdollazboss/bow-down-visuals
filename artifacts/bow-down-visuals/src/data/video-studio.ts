/**
 * video-studio — the Video Studio surface's shared data:
 * the camera-movement catalog, the duration and aspect
 * pickers, and the one-click presets.
 *
 * This data used to live as module constants inside
 * pages/video-studio.tsx. That page is unrouted — App.tsx
 * redirects /video-studio to /video-editor — so the World's
 * Video Studio desk (stack200 world parity lane B1, census
 * item 5) cannot import from it without chaining the desk to
 * a file another lane is set to delete. The data moved here
 * VERBATIM; the page keeps its own copies until its cleanup
 * lands, and this module is the desk's source. Camera labels
 * and prompts are DATA (the TREND_NICHES precedent), not
 * extracted copy.
 */

/* ─── Higgsfield-style camera movements ─── */

export const CAMERA_MOVEMENTS = [
  { id: "static", label: "Static", icon: "🎯", prompt: "static camera, no movement" },
  { id: "push-in", label: "Push In", icon: "🔍", prompt: "slow push in, dolly forward" },
  { id: "pull-out", label: "Pull Out", icon: "🔭", prompt: "slow pull out, reveal wider scene" },
  { id: "pan-left", label: "Pan Left", icon: "⬅️", prompt: "smooth pan left" },
  { id: "pan-right", label: "Pan Right", icon: "➡️", prompt: "smooth pan right" },
  { id: "tilt-up", label: "Tilt Up", icon: "⬆️", prompt: "tilt up, reveal sky" },
  { id: "tilt-down", label: "Tilt Down", icon: "⬇️", prompt: "tilt down, reveal ground" },
  { id: "orbit-left", label: "Orbit Left", icon: "🔄", prompt: "orbit around subject to the left" },
  { id: "orbit-right", label: "Orbit Right", icon: "🔃", prompt: "orbit around subject to the right" },
  { id: "zoom-in", label: "Zoom In", icon: "➕", prompt: "slow zoom in on subject" },
  { id: "zoom-out", label: "Zoom Out", icon: "➖", prompt: "slow zoom out" },
  { id: "tracking", label: "Tracking", icon: "🎥", prompt: "tracking shot following subject" },
] as const;

export type CameraMovement = (typeof CAMERA_MOVEMENTS)[number];

export const VIDEO_STUDIO_DURATIONS = [5, 10, 15, 30];

export const VIDEO_STUDIO_ASPECTS = [
  { id: "16:9", label: "16:9", icon: "🖥️" },
  { id: "9:16", label: "9:16", icon: "📱" },
  { id: "1:1", label: "1:1", icon: "⬛" },
] as const;

/* ─── One-click presets — full workflow in one tap ─── */

export const ONE_CLICK_PRESETS = [
  {
    id: "cinematic-intro",
    label: "Cinematic Intro",
    icon: "🎬",
    blurb: "5s dramatic opener",
    prompt: "cinematic opening shot, dramatic lighting, epic scale",
    camera: "push-in",
    duration: 5,
    aspect: "16:9",
  },
  {
    id: "product-showcase",
    label: "Product Showcase",
    icon: "📦",
    blurb: "10s rotating product",
    prompt: "luxury product on pedestal, studio lighting, rotating showcase",
    camera: "orbit-right",
    duration: 10,
    aspect: "1:1",
  },
  {
    id: "social-teaser",
    label: "Social Teaser",
    icon: "📱",
    blurb: "15s vertical hook",
    prompt: "eye-catching vertical video, bold visuals, high energy",
    camera: "zoom-in",
    duration: 15,
    aspect: "9:16",
  },
  {
    id: "music-clip",
    label: "Music Video Clip",
    icon: "🎵",
    blurb: "10s performance shot",
    prompt: "artist performing on stage, concert lighting, crowd energy",
    camera: "tracking",
    duration: 10,
    aspect: "16:9",
  },
] as const;

export type OneClickPreset = (typeof ONE_CLICK_PRESETS)[number];
