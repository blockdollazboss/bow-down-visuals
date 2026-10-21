import type { HubAssetKind } from "@/lib/hub-project";

/* ─── Visual Vibes desk registry ─────────────────────────────────────────────
   Stack 4, item #1/#4 PLUMBING ONLY (design-gated shell + switcher UI are
   NOT built here). This module is the single source of truth for the suite's
   desks: their keys, house names, routes, and modules. The future unified
   workspace shell and desk switcher must render from this registry — a pure
   UI exercise on top of it — never from a second hand-kept list.

   Desks (one house, four workbenches + the hub):
   - hub      — the Creation Hub: the active project lives here.
   - video    — the Visual Vibes video editor and its timeline tools.
   - audio    — the audio studio: cleanup, stems, voice, mastering.
   - photo    — thumbnails and still-image tools.
   - generate — the /create surface: song / video / cover generation panels.

   ── Suite project-context contract ──────────────────────────────────────
   How a desk learns "the active project" (the plumbing item #2 wires):
   1. The active project is THE hub project — the `hub_projects` row for the
      signed-in creator, exposed client-side by `useHubProject()`
      (lib/hub-project.tsx). There is exactly one active project; desks do
      not keep their own project state.
   2. A desk READS the project through `useHubProject().project` and pulls
      usable inputs through <ProjectFlowBar kinds={desk.flowBarKinds} …>,
      reusing the house pattern — never a desk-local asset list.
   3. A desk WRITES results back with `useHubProject().addAsset({kind, url,
      label, detail})` the moment a generation/export finishes, so the asset
      is instantly available to every other desk and to the hub tray.
   4. Concept + attribution come from the same project object
      (`project.concept`, `project.attribution`) — a desk never asks again.
   5. Cross-desk movement of a specific asset goes through the typed
      handoff mechanism (lib/asset-handoff.ts), keyed by this registry:
      `handoffTargetFor(assetKind, fromDesk)` resolves the receiving desk.
   ──────────────────────────────────────────────────────────────────────── */

export const SUITE_NAME = "Visual Vibes";

export type DeskKey = "hub" | "video" | "audio" | "photo" | "generate";

export interface DeskModule {
  /** Stable module key — used in URLs/state, never rename casually. */
  key: string;
  desk: DeskKey;
  /** House label (our vocabulary only; modes follow Turbo ↔ Advanced). */
  label: string;
  /** Canonical route (tab/panel deep-links included). */
  route: string;
  /** Asset kinds this module can consume as input. */
  acceptsKinds: HubAssetKind[];
  /** Asset kinds this module produces as output. */
  producesKinds: HubAssetKind[];
}

export interface DeskDefinition {
  key: DeskKey;
  /** House name for the desk. */
  name: string;
  /** One-line house description of what the desk is for. */
  blurb: string;
  /** Canonical route for the desk itself. */
  route: string;
  /** Asset kinds the desk's ProjectFlowBar offers by default. */
  flowBarKinds: HubAssetKind[];
  modules: DeskModule[];
}

const m = (
  desk: DeskKey,
  key: string,
  label: string,
  route: string,
  acceptsKinds: HubAssetKind[],
  producesKinds: HubAssetKind[],
): DeskModule => ({ desk, key, label, route, acceptsKinds, producesKinds });

export const DESKS: DeskDefinition[] = [
  {
    key: "hub",
    name: "Creation Hub",
    blurb: "Your active project — every desk reads and writes here.",
    route: "/hub",
    flowBarKinds: [],
    modules: [
      m("hub", "hub-home", "Creation Hub", "/hub", [], []),
      m("hub", "my-projects", "My Projects", "/my-projects", [], []),
    ],
  },
  {
    key: "video",
    name: "Video Editor",
    blurb: "The Visual Vibes editor — timeline, scenes, captions, export.",
    route: "/video-editor",
    flowBarKinds: ["video", "clip", "image", "thumbnail", "song"],
    modules: [
      m("video", "editor", "Video Editor", "/video-editor", ["video", "clip", "image", "song", "beat", "stems"], ["video", "clip"]),
      m("video", "promo-clips", "Promo Clips", "/video-editor?tab=promo-clips", ["video", "clip", "song"], ["clip"]),
      m("video", "lyric-video", "Lyric Video", "/video-editor?tab=lyric-video", ["song", "image"], ["video"]),
      m("video", "translate", "Translate & Dub", "/video-editor?tab=translate", ["video", "clip"], ["video"]),
      m("video", "repurpose", "Repurpose", "/video-editor?tab=repurpose", ["video"], ["clip"]),
      m("video", "upscale", "Upscale", "/video-editor?tab=upscale", ["video", "clip", "image"], ["video", "image"]),
      m("video", "caption-styler", "Caption Styler", "/caption-styler", ["video", "clip"], ["video"]),
    ],
  },
  {
    key: "audio",
    name: "Audio Studio",
    blurb: "Cleanup, stems, voice, and mastering for your tracks.",
    route: "/audio-studio",
    flowBarKinds: ["beat", "song", "stems"],
    modules: [
      m("audio", "audio-home", "Audio Studio", "/audio-studio", ["song", "beat", "stems", "hum"], ["song"]),
      m("audio", "generate-audio", "Generate Audio", "/audio-studio?tab=aiaudio", [], ["beat", "song", "sfx"]),
      m("audio", "cleanup", "Audio Cleanup", "/audio-studio?tab=cleanup", ["song", "beat"], ["song"]),
      m("audio", "stems", "Stem Splitter", "/audio-studio?tab=stems&mode=vocals", ["song"], ["stems"]),
      m("audio", "voiceover", "Voiceover", "/audio-studio?tab=voiceover", ["script"], ["song"]),
      m("audio", "master", "Mix & Master", "/audio-studio?tab=master", ["song", "stems"], ["song"]),
      m("audio", "sounds", "Sound Library", "/audio-studio?tab=sounds", [], ["sfx"]),
    ],
  },
  {
    key: "photo",
    name: "Thumbnail Studio",
    blurb: "Thumbnails and stills that get the click.",
    route: "/thumbnail-studio",
    flowBarKinds: ["song", "video", "clip", "image"],
    modules: [
      m("photo", "thumbnail-generate", "Thumbnail Maker", "/thumbnail-studio?tab=generate", ["video", "clip", "image", "song"], ["thumbnail", "image"]),
      m("photo", "thumbnail-library", "Thumbnail Library", "/thumbnail-studio?tab=library", [], ["thumbnail"]),
      m("photo", "thumbnail-abtest", "Thumbnail A/B Test", "/thumbnail-studio?tab=abtest", ["thumbnail", "image"], ["image"]),
    ],
  },
  {
    key: "generate",
    name: "Create",
    blurb: "Generate the song, the video, and the cover — Turbo does the work.",
    route: "/create",
    flowBarKinds: ["beat", "song", "script", "image"],
    modules: [
      m("generate", "song-video", "Song + Video", "/create?panel=song-video", ["beat", "script"], ["song", "video"]),
      m("generate", "song", "Make a Song", "/create?panel=song", ["beat", "hum", "script"], ["song"]),
      m("generate", "video", "Make a Video", "/create?panel=video", ["song", "script", "image"], ["video"]),
      m("generate", "cover-art", "Cover Art", "/create?panel=coverart", ["song"], ["image"]),
      m("generate", "cartoon", "Cartoon Studio", "/create?panel=cartoon", ["script", "image"], ["video", "image"]),
      m("generate", "video-studio", "Video Studio", "/video-studio", ["song", "script", "thumbnail", "image"], ["video"]),
    ],
  },
];

export const DESK_KEYS: DeskKey[] = DESKS.map((d) => d.key);

export function deskByKey(key: DeskKey): DeskDefinition {
  return DESKS.find((d) => d.key === key)!;
}

export function allModules(): DeskModule[] {
  return DESKS.flatMap((d) => d.modules);
}

export function moduleByKey(key: string): DeskModule | undefined {
  return allModules().find((mod) => mod.key === key);
}

/** Resolve the desk that owns a route (exact match, then path-prefix match
    so tab/panel deep-links land on their desk). The hub matches only its
    exact routes so it never swallows other desks' paths. */
export function deskByRoute(route: string): DeskDefinition | undefined {
  const path = route.split("?")[0];
  for (const desk of DESKS) {
    if (desk.modules.some((mod) => mod.route === route)) return desk;
  }
  for (const desk of DESKS) {
    if (desk.key === "hub") continue;
    if (path === desk.route || desk.modules.some((mod) => mod.route.split("?")[0] === path)) {
      return desk;
    }
  }
  return DESKS.find((d) => d.key === "hub" && d.modules.some((mod) => mod.route.split("?")[0] === path));
}

/** Modules (across all desks) that can consume an asset kind — the receiving
    end of a generalized handoff. */
export function modulesAccepting(kind: HubAssetKind): DeskModule[] {
  return allModules().filter((mod) => mod.acceptsKinds.includes(kind));
}
