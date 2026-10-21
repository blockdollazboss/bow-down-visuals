/* ─── Director's Camera Deck (Wave 9D grown — Higgsfield G1) ────────────────
   The named-preset camera library behind the Camera Move Planner.

   Every preset is a NAMED, TESTED PROMPT CONSTRUCTION: a concrete camera-path
   instruction in video-model vocabulary that the text model weaves into the
   scene prompt (the planner stays pure prompt enrichment — no generation
   happens here, no new video model is added). A preset is never just a
   label: `direction` is the actual instruction the model receives.

   Stacking: up to MAX_STACK (3) presets combine into ONE continuous camera
   path, in the creator's chosen order. Conflict rules are physical, not
   aesthetic — a stack is refused only where the camera instructions
   genuinely contradict:
     • opposite directions on the same axis (in vs out, up vs down,
       left vs right, zoom in vs zoom out),
     • rigs that can't coexist (a body-locked Snorricam can't also orbit),
     • time treatments that fight (bullet time's frozen moment vs
       hyperlapse's streaming time; handheld shake breaks bullet time),
     • a LOCKED preset (static shots: "the camera never moves") stands
       alone — it conflicts with every other preset, including the other
       locked one.
   The rules are stated in the UI (GET /wave9d/camera/presets → stackRule)
   and enforced here server-side; the client also checks for instant
   feedback but the server is the authority.

   The original Wave 9D five (dolly-in, orbit, crane-up, handheld,
   static-wide) keep their direction text BYTE-IDENTICAL to the legacy
   route constants — a single legacy pick weaves the exact same model
   input as before this deck existed (pinned by tests). */

export const CAMERA_INTENSITIES = ["subtle", "natural", "dramatic"] as const;
export type CameraIntensity = (typeof CAMERA_INTENSITIES)[number];

export const INTENSITY_DIRECTION: Record<CameraIntensity, string> = {
  subtle: "SUBTLE — the camera movement is felt more than seen: gentle, restrained, tasteful.",
  natural: "NATURAL — confident, balanced camera motion that serves the scene without showboating.",
  dramatic: "DRAMATIC — bold, sweeping camera motion: maximum cinematic energy, make it a moment.",
};

export const MAX_STACK = 3;

export type CameraCategoryId =
  | "dolly"
  | "orbit"
  | "crane"
  | "pan-tilt"
  | "tracking"
  | "aerial"
  | "zoom"
  | "handheld"
  | "static"
  | "special";

export const CAMERA_CATEGORIES: { id: CameraCategoryId; label: string }[] = [
  { id: "dolly", label: "Dolly & Push" },
  { id: "orbit", label: "Orbit & Arc" },
  { id: "crane", label: "Crane & Vertical" },
  { id: "pan-tilt", label: "Pan & Tilt" },
  { id: "tracking", label: "Tracking & Follow" },
  { id: "aerial", label: "Aerial & FPV" },
  { id: "zoom", label: "Zoom & Focus" },
  { id: "handheld", label: "Handheld & Body" },
  { id: "static", label: "Static" },
  { id: "special", label: "Special" },
];

export interface CameraPreset {
  id: string;
  name: string;
  category: CameraCategoryId;
  blurb: string;
  /** The prompt construction the text model weaves. */
  direction: string;
  /** Locked-off shot: the camera never moves — stands alone in a stack. */
  locked?: boolean;
}

export const CAMERA_PRESETS: CameraPreset[] = [
  /* ── Dolly & Push ─────────────────────────────────────────── */
  {
    id: "dolly-in", name: "Dolly In", category: "dolly",
    blurb: "Glide toward the subject",
    direction: "DOLLY IN — the camera glides steadily toward the subject, closing distance with smooth, cinematic intent.",
  },
  {
    id: "dolly-out", name: "Dolly Out", category: "dolly",
    blurb: "Glide back, reveal the world",
    direction: "DOLLY OUT — the camera glides steadily away from the subject, widening the frame to reveal the world around them.",
  },
  {
    id: "push-in", name: "Push In", category: "dolly",
    blurb: "Fast, urgent push at the face",
    direction: "PUSH IN — the camera drives fast and urgent, straight at the subject's face, energy rising as the frame tightens; the move of a realization hitting.",
  },
  {
    id: "slow-creep", name: "Slow Creep", category: "dolly",
    blurb: "Barely-moving push, pure tension",
    direction: "SLOW CREEP — the camera pushes in almost imperceptibly across the whole shot, tension tightening frame by frame.",
  },
  {
    id: "dolly-left", name: "Dolly Left", category: "dolly",
    blurb: "Slide sideways, leftward",
    direction: "DOLLY LEFT — the camera tracks sideways to the left at the subject's pace, background sliding past with smooth parallax.",
  },
  {
    id: "dolly-right", name: "Dolly Right", category: "dolly",
    blurb: "Slide sideways, rightward",
    direction: "DOLLY RIGHT — the camera tracks sideways to the right at the subject's pace, background sliding past with smooth parallax.",
  },

  /* ── Orbit & Arc ──────────────────────────────────────────── */
  {
    id: "orbit", name: "Orbit", category: "orbit",
    blurb: "Circle around the subject",
    direction: "ORBIT — the camera arcs in a slow circle around the subject, revealing them in three dimensions.",
  },
  {
    id: "orbit-arc", name: "Orbit Arc", category: "orbit",
    blurb: "A bold 90° sweep to a new angle",
    direction: "ORBIT ARC — the camera sweeps a bold 90-degree arc around the subject, ending on a new angle that re-frames the scene.",
  },
  {
    id: "orbit-fast", name: "Fast Orbit", category: "orbit",
    blurb: "Full-speed circle, background streaks",
    direction: "FAST ORBIT — the camera whips a full energetic circle around the subject, background streaking with motion.",
  },
  {
    id: "reverse-orbit", name: "Reverse Orbit", category: "orbit",
    blurb: "Circle the other way — dreamlike",
    direction: "REVERSE ORBIT — the camera circles the subject counter to the expected direction, a slow full revolution that feels subtly off-kilter and dreamlike.",
  },

  /* ── Crane & Vertical ─────────────────────────────────────── */
  {
    id: "crane-up", name: "Crane Up", category: "crane",
    blurb: "Rise to an epic reveal",
    direction: "CRANE UP — the camera rises and tilts down, swelling from intimate framing to an epic wide reveal.",
  },
  {
    id: "crane-down", name: "Crane Down", category: "crane",
    blurb: "Descend from wide to intimate",
    direction: "CRANE DOWN — the camera descends from a high wide frame, tilting up as it settles into an intimate close view of the subject.",
  },
  {
    id: "jib-sweep", name: "Jib Sweep", category: "crane",
    blurb: "Broad swinging arc over the scene",
    direction: "JIB SWEEP — the camera swings in a broad horizontal arc on a jib arm, gliding over and across the scene in one fluid pass.",
  },
  {
    id: "pedestal-up", name: "Pedestal Up", category: "crane",
    blurb: "Rise straight up, no tilt",
    direction: "PEDESTAL UP — the camera rises straight up at the subject's position without tilting, the horizon sinking as the frame climbs.",
  },
  {
    id: "pedestal-down", name: "Pedestal Down", category: "crane",
    blurb: "Sink straight to ground level",
    direction: "PEDESTAL DOWN — the camera sinks straight down without tilting, the frame descending to ground level at the subject.",
  },
  {
    id: "tilt-up", name: "Tilt Up", category: "crane",
    blurb: "Tilt up the subject to the sky",
    direction: "TILT UP — from a locked position the camera tilts slowly upward, traveling up the subject to end on their face or the sky above.",
  },
  {
    id: "tilt-down", name: "Tilt Down", category: "crane",
    blurb: "Tilt down from heights to subject",
    direction: "TILT DOWN — from a locked position the camera tilts slowly downward, traveling from the heights down to the subject at ground level.",
  },

  /* ── Pan & Tilt ───────────────────────────────────────────── */
  {
    id: "pan-left", name: "Pan Left", category: "pan-tilt",
    blurb: "Smooth pan to the left",
    direction: "PAN LEFT — from a locked position the camera pans smoothly left, following the action or revealing what waits off-frame.",
  },
  {
    id: "pan-right", name: "Pan Right", category: "pan-tilt",
    blurb: "Smooth pan to the right",
    direction: "PAN RIGHT — from a locked position the camera pans smoothly right, following the action or revealing what waits off-frame.",
  },
  {
    id: "whip-pan", name: "Whip Pan", category: "pan-tilt",
    blurb: "Fast blur-whip onto a new subject",
    direction: "WHIP PAN — the camera whips sideways in a fast blur and lands locked on a new subject or detail; one sharp beat of energy.",
  },

  /* ── Tracking & Follow ────────────────────────────────────── */
  {
    id: "tracking-left", name: "Tracking Left", category: "tracking",
    blurb: "Travel left beside the subject",
    direction: "TRACKING LEFT — the camera travels left alongside the moving subject, holding them in profile at a constant distance.",
  },
  {
    id: "tracking-right", name: "Tracking Right", category: "tracking",
    blurb: "Travel right beside the subject",
    direction: "TRACKING RIGHT — the camera travels right alongside the moving subject, holding them in profile at a constant distance.",
  },
  {
    id: "follow-behind", name: "Follow Behind", category: "tracking",
    blurb: "Trail the subject, world ahead",
    direction: "FOLLOW BEHIND — the camera follows the subject from behind at walking pace, the world opening ahead of them as they move.",
  },
  {
    id: "follow-front", name: "Leading Shot", category: "tracking",
    blurb: "Glide backward, face held",
    direction: "LEADING SHOT — the camera glides backward ahead of the subject, holding their face as they advance toward it.",
  },
  {
    id: "chase", name: "Chase", category: "tracking",
    blurb: "Pursuit at speed, weaving close",
    direction: "CHASE — the camera pursues the subject at speed, weaving with urgency, close enough to feel the pursuit.",
  },

  /* ── Aerial & FPV ─────────────────────────────────────────── */
  {
    id: "drone-rise", name: "Drone Rise", category: "aerial",
    blurb: "Lift off and climb, scale unfolds",
    direction: "DRONE RISE — the camera lifts off like a drone, climbing steadily as the location unfolds below in growing scale.",
  },
  {
    id: "drone-reveal", name: "Drone Reveal", category: "aerial",
    blurb: "Crest the edge, unveil the scene",
    direction: "DRONE REVEAL — the camera flies forward low, then crests a rise or edge to unveil the scene beyond in one breathtaking reveal.",
  },
  {
    id: "aerial-pullback", name: "Aerial Pullback", category: "aerial",
    blurb: "Retreat skyward into the vast",
    direction: "AERIAL PULLBACK — the camera retreats high into the air, the subject shrinking into a vast landscape until they are a single figure in the world.",
  },
  {
    id: "fpv-chase", name: "FPV Chase", category: "aerial",
    blurb: "Racing drone pursuit, banking hard",
    direction: "FPV CHASE — the camera flies a racing FPV drone's line: banking, diving, and weaving close behind the moving subject at thrilling speed.",
  },
  {
    id: "fpv-dive", name: "FPV Dive", category: "aerial",
    blurb: "Plummet from height, level out low",
    direction: "FPV DIVE — the camera plummets from height in a steep FPV dive, leveling out just above the subject in one continuous rush.",
  },

  /* ── Zoom & Focus ─────────────────────────────────────────── */
  {
    id: "snap-zoom", name: "Snap Zoom", category: "zoom",
    blurb: "Crash zoom punch-in, instant emphasis",
    direction: "SNAP ZOOM — the camera punches in with a sudden crash zoom on the subject's face or a key detail; instant emphasis, zero hesitation.",
  },
  {
    id: "zoom-out", name: "Zoom Out", category: "zoom",
    blurb: "Burst outward to the full scene",
    direction: "ZOOM OUT — the camera bursts outward in a fast pull-zoom from a tight detail to the full scene, context flooding in.",
  },
  {
    id: "dolly-zoom", name: "Dolly Zoom", category: "zoom",
    blurb: "The vertigo move — background warps",
    direction: "DOLLY ZOOM (VERTIGO) — the camera dollies toward the subject while zooming out, so the subject holds size as the background warps and stretches behind them.",
  },
  {
    id: "slow-zoom", name: "Slow Zoom", category: "zoom",
    blurb: "Gradual telephoto compression push",
    direction: "SLOW ZOOM — the camera's lens pushes in gradually, compressing the space behind the subject; the world flattens as the frame tightens.",
  },
  {
    id: "rack-focus", name: "Rack Focus", category: "zoom",
    blurb: "Focus pulls between two subjects",
    direction: "RACK FOCUS — the camera holds position while focus pulls from a foreground detail to the subject beyond (or back), shifting the story's attention in one breath.",
  },

  /* ── Handheld & Body ──────────────────────────────────────── */
  {
    id: "handheld", name: "Handheld", category: "handheld",
    blurb: "Intimate, alive, imperfect",
    direction: "HANDHELD — intimate, imperfect, alive: subtle shake and drift like an operator's shoulder rig. Never nauseating.",
  },
  {
    id: "handheld-doc", name: "Documentary Handheld", category: "handheld",
    blurb: "Observational, truly present",
    direction: "DOCUMENTARY HANDHELD — observational handheld with longer drifts and small reframes, the feeling of a camera truly present in the room.",
  },
  {
    id: "shoulder-cam", name: "Shoulder Cam", category: "handheld",
    blurb: "Over-the-shoulder, traveling with them",
    direction: "SHOULDER CAM — the camera rides over the subject's shoulder as they travel, their shoulder anchoring the edge of frame while the world passes.",
  },
  {
    id: "snorricam", name: "Snorricam", category: "handheld",
    blurb: "Body-locked — the world lurches",
    direction: "SNORRICAM — the camera is locked to the subject's body: their face stays frozen center-frame while the world lurches and swings around them.",
  },
  {
    id: "pov-walk", name: "POV Walk", category: "handheld",
    blurb: "First-person walk through the scene",
    direction: "POV WALK — the camera becomes a first-person view, moving through the scene at a natural pace, glancing where the subject's attention goes.",
  },

  /* ── Static ───────────────────────────────────────────────── */
  {
    id: "static-wide", name: "Static Wide", category: "static", locked: true,
    blurb: "Locked-off master shot",
    direction: "STATIC WIDE — the camera never moves. Locked-off master shot; all motion comes from the subject and the world.",
  },
  {
    id: "static-close", name: "Static Close", category: "static", locked: true,
    blurb: "Locked-off intimate close frame",
    direction: "STATIC CLOSE — a locked-off intimate close frame; the camera never moves, and every micro-expression carries the shot.",
  },

  /* ── Special ──────────────────────────────────────────────── */
  {
    id: "bullet-time", name: "Bullet Time", category: "special",
    blurb: "Frozen moment, camera arcs time",
    direction: "BULLET TIME — action hangs nearly frozen in a suspended moment while the camera arcs swiftly around it, time itself bending around the subject.",
  },
  {
    id: "dutch-drift", name: "Dutch Drift", category: "special",
    blurb: "Canted angle, elegant unease",
    direction: "DUTCH DRIFT — the camera rides at a canted dutch angle, drifting slowly so the whole scene feels elegantly off-balance.",
  },
  {
    id: "parallax-slide", name: "Parallax Slide", category: "special",
    blurb: "Layers sliding against each other",
    direction: "PARALLAX SLIDE — the camera slides laterally, slow and smooth, while foreground elements sweep past far faster than the background — layers of the scene sliding against each other.",
  },
  {
    id: "hyperlapse", name: "Hyperlapse", category: "special",
    blurb: "Timelapse travel through the scene",
    direction: "HYPERLAPSE — the camera travels a long path through the location at timelapse speed, the world streaming past in a smooth high-energy rush.",
  },
  {
    id: "low-angle-hero", name: "Low Angle Hero", category: "special",
    blurb: "Towering hero framing from below",
    direction: "LOW ANGLE HERO — the camera sits low, looking up at the subject against the sky, pushing in slowly so they tower with iconic presence.",
  },
];

/** The original Wave 9D five — kept as a named set for legacy checks. */
export const LEGACY_MOVE_IDS = ["dolly-in", "orbit", "crane-up", "handheld", "static-wide"] as const;
export type LegacyMoveId = (typeof LEGACY_MOVE_IDS)[number];

const PRESET_BY_ID = new Map(CAMERA_PRESETS.map((p) => [p.id, p]));

export function getCameraPreset(id: string): CameraPreset | undefined {
  return PRESET_BY_ID.get(id);
}

export function isLegacyMove(id: string): id is LegacyMoveId {
  return (LEGACY_MOVE_IDS as readonly string[]).includes(id);
}

/* ─── Conflict rules ────────────────────────────────────────────────────────
   Explicit opposite/rig pairs. `why` is written for the creator and is
   surfaced verbatim in the UI and in 400 responses — the rule is never a
   silent refusal. Pairs not listed compose freely. */
const OPPOSITE_WHY = "they move the camera in opposite directions — one shot can't do both";

const CONFLICT_PAIRS: { a: string; b: string; why: string }[] = [
  { a: "dolly-in", b: "dolly-out", why: OPPOSITE_WHY },
  { a: "push-in", b: "dolly-out", why: OPPOSITE_WHY },
  { a: "slow-creep", b: "dolly-out", why: OPPOSITE_WHY },
  { a: "dolly-left", b: "dolly-right", why: OPPOSITE_WHY },
  { a: "dolly-left", b: "tracking-right", why: OPPOSITE_WHY },
  { a: "dolly-right", b: "tracking-left", why: OPPOSITE_WHY },
  { a: "tracking-left", b: "tracking-right", why: OPPOSITE_WHY },
  { a: "crane-up", b: "crane-down", why: OPPOSITE_WHY },
  { a: "crane-up", b: "pedestal-down", why: OPPOSITE_WHY },
  { a: "crane-down", b: "pedestal-up", why: OPPOSITE_WHY },
  { a: "pedestal-up", b: "pedestal-down", why: OPPOSITE_WHY },
  { a: "crane-down", b: "drone-rise", why: OPPOSITE_WHY },
  { a: "pedestal-down", b: "drone-rise", why: OPPOSITE_WHY },
  { a: "drone-rise", b: "fpv-dive", why: "one climbs away from the ground while the other plummets toward it" },
  { a: "tilt-up", b: "tilt-down", why: OPPOSITE_WHY },
  { a: "pan-left", b: "pan-right", why: OPPOSITE_WHY },
  { a: "whip-pan", b: "pan-left", why: "a whip pan is a single snap — it can't also be a smooth pan" },
  { a: "whip-pan", b: "pan-right", why: "a whip pan is a single snap — it can't also be a smooth pan" },
  { a: "follow-behind", b: "follow-front", why: "the camera can't trail the subject and lead them at the same time" },
  { a: "chase", b: "follow-front", why: "a chase pursues from behind — it can't also lead from the front" },
  { a: "aerial-pullback", b: "dolly-in", why: "the pullback retreats into the sky while the dolly pushes in on the ground" },
  { a: "aerial-pullback", b: "push-in", why: "the pullback retreats into the sky while the push-in drives at the subject" },
  { a: "aerial-pullback", b: "slow-creep", why: "the pullback retreats into the sky while the creep closes in on the ground" },
  { a: "aerial-pullback", b: "chase", why: "the pullback retreats while the chase pursues — opposite journeys" },
  { a: "aerial-pullback", b: "fpv-chase", why: "the pullback retreats while the FPV chase pursues — opposite journeys" },
  { a: "aerial-pullback", b: "drone-reveal", why: "the pullback flies backward while the reveal flies forward" },
  { a: "snap-zoom", b: "zoom-out", why: "one zooms in and the other zooms out — the lens can't do both" },
  { a: "snap-zoom", b: "dolly-zoom", why: "the snap zoom punches in while the dolly zoom's lens pulls out — opposite zooms" },
  { a: "slow-zoom", b: "zoom-out", why: "one zooms in and the other zooms out — the lens can't do both" },
  { a: "slow-zoom", b: "dolly-zoom", why: "the slow zoom pushes in while the dolly zoom's lens pulls out — opposite zooms" },
  { a: "bullet-time", b: "hyperlapse", why: "bullet time freezes the moment while hyperlapse races through it — opposite treatments of time" },
  { a: "bullet-time", b: "handheld", why: "bullet time needs a mechanically smooth arc — handheld shake breaks the frozen moment" },
  { a: "bullet-time", b: "handheld-doc", why: "bullet time needs a mechanically smooth arc — handheld shake breaks the frozen moment" },
  { a: "snorricam", b: "orbit", why: "the camera can't be locked to the subject's body and circle around them at the same time" },
  { a: "snorricam", b: "orbit-arc", why: "the camera can't be locked to the subject's body and arc around them at the same time" },
  { a: "snorricam", b: "orbit-fast", why: "the camera can't be locked to the subject's body and circle around them at the same time" },
  { a: "snorricam", b: "reverse-orbit", why: "the camera can't be locked to the subject's body and circle around them at the same time" },
  { a: "snorricam", b: "bullet-time", why: "bullet time arcs around a frozen subject — a body-locked rig can't make that arc" },
];

const LOCKED_WHY = "a locked-off shot means the camera never moves — it always stands alone";

const CONFLICT_MAP = new Map<string, Map<string, string>>();
for (const { a, b, why } of CONFLICT_PAIRS) {
  if (!CONFLICT_MAP.has(a)) CONFLICT_MAP.set(a, new Map());
  if (!CONFLICT_MAP.has(b)) CONFLICT_MAP.set(b, new Map());
  CONFLICT_MAP.get(a)!.set(b, why);
  CONFLICT_MAP.get(b)!.set(a, why);
}

/** Why two presets can't stack, or null when they compose freely. */
export function cameraConflictWhy(aId: string, bId: string): string | null {
  if (aId === bId) return null; // duplicates are their own validation, not a conflict
  const a = PRESET_BY_ID.get(aId);
  const b = PRESET_BY_ID.get(bId);
  if (!a || !b) return null;
  if (a.locked || b.locked) return LOCKED_WHY;
  return CONFLICT_MAP.get(aId)?.get(bId) ?? null;
}

/** Preset ids that conflict with the given preset (for UI instant checks). */
export function conflictsWith(id: string): string[] {
  const preset = PRESET_BY_ID.get(id);
  if (!preset) return [];
  if (preset.locked) return CAMERA_PRESETS.filter((p) => p.id !== id).map((p) => p.id);
  const out = new Set<string>(CONFLICT_MAP.get(id)?.keys() ?? []);
  for (const p of CAMERA_PRESETS) if (p.locked) out.add(p.id);
  return [...out];
}

/* ─── Stack resolution / composition ─────────────────────────────────────── */

export interface CameraStackEntryInput {
  preset: string;
  intensity?: CameraIntensity | null;
}

export interface ResolvedCameraEntry {
  preset: CameraPreset;
  /** Per-move intensity override; null = ride the stack intensity. */
  intensity: CameraIntensity | null;
}

export type StackResolution =
  | { ok: true; entries: ResolvedCameraEntry[] }
  | { ok: false; error: string };

/** Validate a proposed stack: known ids, no duplicates, ≤ MAX_STACK, no
    conflicts. Order is preserved — it is the order the moves perform in. */
export function resolveCameraStack(input: CameraStackEntryInput[]): StackResolution {
  if (input.length === 0) return { ok: false, error: "Pick at least one camera move." };
  if (input.length > MAX_STACK) {
    return { ok: false, error: `A stack holds at most ${MAX_STACK} moves — remove one to swap.` };
  }
  const seen = new Set<string>();
  const entries: ResolvedCameraEntry[] = [];
  for (const item of input) {
    const preset = PRESET_BY_ID.get(item.preset);
    if (!preset) return { ok: false, error: `Unknown camera move: "${item.preset}".` };
    if (seen.has(preset.id)) {
      return { ok: false, error: `"${preset.name}" is already in the stack — a move can't stack with itself.` };
    }
    seen.add(preset.id);
    entries.push({ preset, intensity: item.intensity ?? null });
  }
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const why = cameraConflictWhy(entries[i].preset.id, entries[j].preset.id);
      if (why) {
        return {
          ok: false,
          error: `Can't stack "${entries[i].preset.name}" with "${entries[j].preset.name}" — ${why}.`,
        };
      }
    }
  }
  return { ok: true, entries };
}

/** The camera block for a ≥2 stack: the moves numbered in performance
    order under one instruction to weave them as a single continuous path. */
export function buildStackBlock(entries: ResolvedCameraEntry[], stackIntensity: CameraIntensity): string {
  const lines = entries.map((e, i) => {
    const override =
      e.intensity && e.intensity !== stackIntensity
        ? ` (This move's intensity: ${INTENSITY_DIRECTION[e.intensity]})`
        : "";
    return `${i + 1}. ${e.preset.direction}${override}`;
  });
  return (
    `Camera stack — ${entries.length} moves combined into ONE continuous camera path, performed in this order, ` +
    `blending smoothly from one move into the next without cuts:\n${lines.join("\n")}\n` +
    `Stack intensity: ${INTENSITY_DIRECTION[stackIntensity]}`
  );
}

/** Sanitize an AI-proposed stack (Turbo Shot Designer): unknown ids,
    duplicates, conflicts, and over-length are dropped IN ORDER, each with
    a plain-language note — the proposal is adjusted openly, never silently.
    Returns the surviving ordered entries (possibly empty). */
export function sanitizeDesignerStack(
  raw: { preset: string; intensity?: CameraIntensity | null }[],
): { entries: ResolvedCameraEntry[]; notes: string[] } {
  const notes: string[] = [];
  const entries: ResolvedCameraEntry[] = [];
  for (const item of raw) {
    const preset = PRESET_BY_ID.get(item.preset);
    if (!preset) {
      notes.push(`Dropped an unknown move ("${item.preset}").`);
      continue;
    }
    if (entries.some((e) => e.preset.id === preset.id)) {
      notes.push(`Dropped a repeated "${preset.name}".`);
      continue;
    }
    const clash = entries.find((e) => cameraConflictWhy(e.preset.id, preset.id));
    if (clash) {
      notes.push(
        `Dropped "${preset.name}" — it conflicts with "${clash.preset.name}" (${cameraConflictWhy(clash.preset.id, preset.id)}).`,
      );
      continue;
    }
    if (entries.length >= MAX_STACK) {
      notes.push(`Dropped "${preset.name}" — a stack holds at most ${MAX_STACK} moves.`);
      continue;
    }
    entries.push({ preset, intensity: item.intensity ?? null });
  }
  return { entries, notes };
}

/** The rule text stated in the UI, served with the deck. */
export const STACK_RULE_TEXT =
  `Stack up to ${MAX_STACK} moves — they weave into one continuous camera path, in the order you pick them. ` +
  "Opposite moves can't combine (in vs out, up vs down, left vs right), and a locked-off static shot always stands alone.";
