/**
 * scene-presets.ts — the Go Live scene preset registry.
 *
 * A scene preset is a REAL scene for the parity studio: a named stack
 * of sources built only from the source types and fields the stage
 * actually draws (see stage.ts drawScene / scenes.ts SceneSource).
 * There is no preset-only config key — every key on a preset source
 * is a SceneSource field, and fields a preset does not set inherit
 * the working defaults createSource() gives that type.
 *
 * Applying a preset writes through the studio's existing state path
 * — the same Stage methods the panels use (addScene → addSource →
 * updateSource → setPreview, the pattern StreamPackTray uses for a
 * single image). The new scene lands in Preview, never straight to
 * Program: the creator frames it, then takes it live like any scene.
 *
 * A preset never starts a camera or a screen share and never charges
 * anything. A screen source in a preset draws the stage's own
 * "not sharing yet" placeholder until the creator starts the share
 * from that source's panel, exactly like a hand-built screen source.
 * A widget source draws only when there is real stream data, exactly
 * like a hand-built widget source.
 *
 * Growing the list = adding an entry to SCENE_PRESETS below.
 */
import {
  createScene,
  createSource,
  type Scene,
  type SceneSource,
  type SourceType,
} from "./scenes";

/**
 * One source in a preset: its type and display name, plus any
 * SceneSource fields the preset sets explicitly. Every other field
 * comes from createSource(type) at build time.
 */
export type ScenePresetSource = { type: SourceType; name: string } & Partial<
  Omit<SceneSource, "id" | "type" | "name">
>;

export interface ScenePreset {
  id: string;
  name: string;
  /** One honest sentence: what the viewer sees, no invented features. */
  blurb: string;
  /** Render order: index 0 is drawn first (the back). */
  sources: ScenePresetSource[];
}

const GOLD_TEXT = {
  color: "#F7ECD2",
  bold: true,
  fontFamily: "Georgia, serif",
  outlineColor: "#000000",
} as const;

export const SCENE_PRESETS: ScenePreset[] = [
  {
    id: "just-you",
    name: "Just You",
    blurb: "Your camera, full frame — the simple talking-to-camera scene.",
    sources: [
      { type: "camera", name: "Camera", x: 0, y: 0, w: 1, h: 1, fit: "cover", cameraMode: "kit" },
    ],
  },
  {
    id: "camera-live-overlay",
    name: "Camera + Live Overlay",
    blurb: "Your camera full frame, a lower third, and your latest follower when there is one.",
    sources: [
      { type: "camera", name: "Camera", x: 0, y: 0, w: 1, h: 1, fit: "cover", cameraMode: "kit" },
      {
        type: "widget",
        name: "Latest follower",
        x: 0.04,
        y: 0.05,
        w: 0.46,
        h: 0.11,
        fit: "contain",
        widget: { kind: "latest-follower" },
      },
      {
        type: "text",
        name: "Lower third",
        x: 0.05,
        y: 0.82,
        w: 0.9,
        h: 0.13,
        fit: "contain",
        text: { content: "Live now — say hello in chat", fontSize: 44, ...GOLD_TEXT },
      },
    ],
  },
  {
    id: "screen-and-you",
    name: "Screen + You in the Corner",
    blurb: "Your screen full frame with your camera in the bottom-right corner.",
    sources: [
      { type: "screen", name: "Screen Share", x: 0, y: 0, w: 1, h: 1, fit: "cover" },
      { type: "camera", name: "Camera (corner)", x: 0.73, y: 0.66, w: 0.23, h: 0.29, fit: "cover", cameraMode: "kit" },
    ],
  },
  {
    id: "screen-only",
    name: "Screen Only",
    blurb: "Just your shared screen or window, full frame — no camera.",
    sources: [{ type: "screen", name: "Screen Share", x: 0, y: 0, w: 1, h: 1, fit: "cover" }],
  },
  {
    id: "starting-soon",
    name: "Starting Soon",
    blurb: "A gold-on-dark card that says the stream is about to start. No camera in this scene.",
    sources: [
      { type: "color", name: "Backdrop", x: 0, y: 0, w: 1, h: 1, fill: { from: "#1a1207", to: "#0d0a04" } },
      {
        type: "text",
        name: "Title",
        x: 0.05,
        y: 0.36,
        w: 0.9,
        h: 0.22,
        fit: "contain",
        text: { content: "Starting soon", fontSize: 72, ...GOLD_TEXT, outlineColor: null },
      },
      {
        type: "text",
        name: "Subtitle",
        x: 0.05,
        y: 0.6,
        w: 0.9,
        h: 0.12,
        fit: "contain",
        text: {
          content: "We'll be live in a moment",
          fontSize: 32,
          color: "#E8CF8A",
          bold: false,
          fontFamily: "Georgia, serif",
          outlineColor: null,
        },
      },
    ],
  },
  {
    id: "be-right-back",
    name: "Be Right Back",
    blurb: "A gold-on-dark break card for stepping away mid-stream. No camera in this scene.",
    sources: [
      { type: "color", name: "Backdrop", x: 0, y: 0, w: 1, h: 1, fill: { from: "#14100a", to: "#0d0a04" } },
      {
        type: "text",
        name: "Title",
        x: 0.05,
        y: 0.38,
        w: 0.9,
        h: 0.2,
        fit: "contain",
        text: { content: "Be right back", fontSize: 64, ...GOLD_TEXT, outlineColor: null },
      },
      {
        type: "text",
        name: "Subtitle",
        x: 0.05,
        y: 0.6,
        w: 0.9,
        h: 0.12,
        fit: "contain",
        text: {
          content: "Stay tuned — back in a moment",
          fontSize: 32,
          color: "#E8CF8A",
          bold: false,
          fontFamily: "Georgia, serif",
          outlineColor: null,
        },
      },
    ],
  },
  {
    id: "avatar-stage",
    name: "Live as Your Avatar",
    blurb: "Your avatar centred on a dark backdrop — your camera only moves the character, it is never shown.",
    sources: [
      { type: "color", name: "Backdrop", x: 0, y: 0, w: 1, h: 1, fill: { from: "#14100a", to: "#0d0a04" } },
      {
        type: "avatar",
        name: "Avatar",
        x: 0.3,
        y: 0.08,
        w: 0.4,
        h: 0.84,
        fit: "contain",
        avatar: { character: "shark", drive: "face", sensitivity: 1 },
      },
      {
        type: "text",
        name: "Lower third",
        x: 0.05,
        y: 0.86,
        w: 0.9,
        h: 0.1,
        fit: "contain",
        text: { content: "Live now", fontSize: 36, ...GOLD_TEXT },
      },
    ],
  },
];

export function scenePresetById(id: string): ScenePreset | null {
  return SCENE_PRESETS.find((p) => p.id === id) ?? null;
}

/** Deep-copy one preset source spec into a full, fresh SceneSource. */
function buildSource(spec: ScenePresetSource): SceneSource {
  const base = createSource(spec.type, spec.name);
  const { type: _type, name: _name, ...patch } = spec;
  return {
    ...base,
    ...patch,
    id: base.id,
    type: spec.type,
    name: spec.name,
    // Nested settings the preset sets are copied, never shared with
    // the registry — editing the built scene cannot rewrite a preset.
    chroma: patch.chroma ? { ...patch.chroma } : base.chroma,
    text: patch.text ? { ...patch.text } : base.text,
    fill: patch.fill ? { ...patch.fill } : base.fill,
    widget: patch.widget ? { ...patch.widget } : base.widget,
    avatar: patch.avatar ? { ...patch.avatar } : base.avatar,
    guest: patch.guest ? { ...patch.guest } : base.guest,
  };
}

/** A fresh Scene from a preset — fresh ids, registry never mutated. */
export function buildSceneFromPreset(preset: ScenePreset): Scene {
  return createScene(preset.name, preset.sources.map(buildSource));
}

/**
 * The slice of Stage a preset apply needs — exactly the existing
 * scene/source state path the studio panels already use. The real
 * Stage satisfies this structurally.
 */
export interface ScenePresetStage {
  addScene: (name?: string) => Scene;
  addSource: (sceneId: string, type: SourceType) => SceneSource | null;
  updateSource: (sceneId: string, sourceId: string, patch: Partial<SceneSource>) => void;
  setPreview: (id: string) => void;
  sceneById: (id: string) => Scene | null;
}

/**
 * Apply a preset through the existing Stage state path: addScene,
 * then for each preset source (in render order) addSource +
 * updateSource with the preset's real fields, then frame the new
 * scene in Preview. Program is left untouched. Returns the applied
 * scene as the stage now holds it, or null for an unknown preset /
 * a stage that refused a source.
 */
export function applyScenePreset(
  stage: ScenePresetStage,
  presetId: string,
): Scene | null {
  const preset = scenePresetById(presetId);
  if (!preset) return null;
  const built = buildSceneFromPreset(preset);
  const scene = stage.addScene(preset.name);
  for (const source of built.sources) {
    const created = stage.addSource(scene.id, source.type);
    if (!created) return null;
    const { id: _id, ...patch } = source;
    stage.updateSource(scene.id, created.id, patch);
  }
  stage.setPreview(scene.id);
  return stage.sceneById(scene.id) ?? built;
}

/** True when a preset contains a source of the given type. */
export function scenePresetHasSourceType(preset: ScenePreset, type: SourceType): boolean {
  return preset.sources.some((s) => s.type === type);
}
