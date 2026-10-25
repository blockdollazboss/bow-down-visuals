/**
 * actions.ts — avatar actions: the pose math, pure.
 *
 * The owner's order: "the avatar should be able to do things." The
 * figures are portrait planes and full-body cut-outs — flat art, no
 * skeleton — so an action is an honest plane transform: the figure
 * tilts, lifts, drops and turns as one piece, the way a standee
 * emotes. Bow leans forward, Dance bounces and sways on a beat
 * until stopped, Sit lowers the figure to seat height, Spin turns
 * it clean around. Nothing here pretends to be limb animation.
 *
 * The id set is shared verbatim with the server (lib/world-room.ts
 * WORLD_ACTIONS): the server relays the id; every client derives
 * the pose from it locally, from the moment it started. "once"
 * actions play through and settle; "toggle" actions (dance, sit)
 * hold until toggled off, replaced — or the wearer walks, which
 * clears a held toggle on both the server and here.
 *
 * Pose frame (figure-local, matching hall-scene's rig space):
 * the figure's front is -Z, so tiltX NEGATIVE leans it forward;
 * y is a plain vertical offset in metres; spinY is extra yaw.
 */

export type WorldActionId =
  | "bow" | "wave" | "cheer" | "clap" | "dance" | "spin" | "sit"
  | "point" | "beckon" | "salute" | "laugh" | "shrug" | "highfive" | "kneel";
export type WorldActionKind = "once" | "toggle";

export interface WorldActionDef {
  id: WorldActionId;
  label: string;
  kind: WorldActionKind;
  /** Play length for one-shot actions (toggles run until stopped). */
  durationMs: number;
}

export const WORLD_ACTIONS: WorldActionDef[] = [
  { id: "bow", label: "Bow", kind: "once", durationMs: 1500 },
  { id: "wave", label: "Wave", kind: "once", durationMs: 1700 },
  { id: "cheer", label: "Cheer", kind: "once", durationMs: 1250 },
  { id: "clap", label: "Clap", kind: "once", durationMs: 1500 },
  { id: "spin", label: "Spin", kind: "once", durationMs: 950 },
  { id: "dance", label: "Dance", kind: "toggle", durationMs: 0 },
  { id: "sit", label: "Sit", kind: "toggle", durationMs: 0 },
  /* The social set (Stack-100 #3 follow-on, .lane/ACTIONS-DESIGN
   * §2.1): the same honest standee math, aimed at other people —
   * pointing things out, calling someone over, returning the
   * guards' salute, laughing, shrugging, trading a high-five, and
   * kneeling (the toggle of respect, next to sit). */
  { id: "point", label: "Point", kind: "once", durationMs: 1400 },
  { id: "beckon", label: "Beckon", kind: "once", durationMs: 1600 },
  { id: "salute", label: "Salute", kind: "once", durationMs: 1300 },
  { id: "laugh", label: "Laugh", kind: "once", durationMs: 1400 },
  { id: "shrug", label: "Shrug", kind: "once", durationMs: 1300 },
  { id: "highfive", label: "High-five", kind: "once", durationMs: 900 },
  { id: "kneel", label: "Kneel", kind: "toggle", durationMs: 0 },
];

export const ACTION_BY_ID: ReadonlyMap<WorldActionId, WorldActionDef> = new Map(
  WORLD_ACTIONS.map((a) => [a.id, a]),
);

export function isWorldActionId(value: unknown): value is WorldActionId {
  return typeof value === "string" && ACTION_BY_ID.has(value as WorldActionId);
}

/** A held toggle ends the moment its wearer walks — the server
 *  mirrors this exact rule on move frames. */
export function actionClearedByMove(id: WorldActionId | null): boolean {
  if (!id) return false;
  return ACTION_BY_ID.get(id)?.kind === "toggle";
}

export interface ActionPose {
  /** Forward lean (radians, figure-local rotation.x). */
  tiltX: number;
  /** Side sway (radians, figure-local rotation.z). */
  tiltZ: number;
  /** Extra yaw (radians) — a spin's full turn lives here. */
  spinY: number;
  /** Vertical offset in metres (hops up, sits down). */
  y: number;
}

export const NEUTRAL_POSE: ActionPose = { tiltX: 0, tiltZ: 0, spinY: 0, y: 0 };

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * The pose of an action `elapsedMs` after it started. One-shots
 * return null once they've played through (the figure settles);
 * toggles pose forever — stopping them is the toggle's own frame,
 * and the scene eases the figure back to neutral from wherever the
 * pose left it.
 */
export function actionPoseAt(id: WorldActionId, elapsedMs: number): ActionPose | null {
  const def = ACTION_BY_ID.get(id);
  if (!def) return null;
  const elapsed = Math.max(0, elapsedMs);
  if (def.kind === "once" && elapsed >= def.durationMs) return null;
  const p = def.kind === "once" ? clamp01(elapsed / def.durationMs) : 0;
  const t = elapsed / 1000;

  switch (id) {
    case "bow": {
      // Down by a third, held a breath, back up — one smooth arc.
      const env =
        p < 0.34 ? easeOutCubic(p / 0.34) : p < 0.62 ? 1 : 1 - easeInOutCubic((p - 0.62) / 0.38);
      return { tiltX: -0.58 * env, tiltZ: 0, spinY: 0, y: -0.05 * env };
    }
    case "wave": {
      // A raised-arm sway reads on a plane as a rhythmic rock,
      // swelling in and out with the gesture.
      const env = Math.sin(Math.PI * clamp01(p * 1.08));
      return { tiltX: 0, tiltZ: 0.16 * Math.sin(t * Math.PI * 4.4) * env, spinY: 0, y: 0.02 * env };
    }
    case "cheer": {
      // Two hops, arms-up lean on the rise.
      const hops = Math.abs(Math.sin(Math.PI * 2 * p));
      return { tiltX: -0.06 * hops, tiltZ: 0, spinY: 0, y: 0.16 * hops };
    }
    case "clap": {
      // Rapid small bows on the clap beat (~3/s), a hop every other.
      const env = Math.pow(Math.sin(Math.PI * clamp01(p * 1.05)), 0.6);
      const pulse = Math.pow(0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 3.1 - Math.PI / 2), 2);
      return { tiltX: -0.13 * pulse * env, tiltZ: 0, spinY: 0, y: 0.028 * pulse * env };
    }
    case "spin": {
      return { tiltX: 0, tiltZ: 0, spinY: Math.PI * 2 * easeInOutCubic(p), y: 0.09 * Math.sin(Math.PI * p) };
    }
    case "dance": {
      // A two-beat loop: bounce on the beat, sway across it, a slow
      // quarter-turn wiggle over the top. Loops until stopped.
      const bounce = Math.abs(Math.sin(Math.PI * 1.9 * t));
      return {
        tiltX: 0.05 * Math.sin(Math.PI * 2 * 1.9 * t + 1.2),
        tiltZ: 0.085 * Math.sin(Math.PI * 2 * 0.95 * t),
        spinY: 0.18 * Math.sin(Math.PI * 2 * 0.475 * t),
        y: 0.055 * bounce + 0.012,
      };
    }
    case "sit": {
      // Lowers to seat height over a beat and stays there.
      const settle = easeOutCubic(clamp01(elapsed / 280));
      return { tiltX: -0.05 * settle, tiltZ: 0, spinY: 0, y: -0.52 * settle };
    }
    case "point": {
      // Two quick forward nods — "there, that one." The lean does
      // the pointing a standee can honestly do.
      const pulse = Math.abs(Math.sin(Math.PI * 2 * p));
      return { tiltX: -0.2 * pulse, tiltZ: 0, spinY: 0, y: 0.012 * pulse };
    }
    case "beckon": {
      // Come-here leans: three swells of a forward rock inside a
      // swelling envelope, the way you'd wave someone over.
      const env = Math.pow(Math.sin(Math.PI * clamp01(p * 1.04)), 0.7);
      const rock = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 2.6 - Math.PI / 2);
      return { tiltX: -0.28 * rock * env, tiltZ: 0, spinY: 0, y: 0.015 * env };
    }
    case "salute": {
      // A snap to attention: rise a touch, stand tall, hold a
      // breath, release. No sway — a salute is crisp.
      const env =
        p < 0.15 ? easeOutCubic(p / 0.15) : p < 0.72 ? 1 : 1 - easeInOutCubic((p - 0.72) / 0.28);
      return { tiltX: 0.07 * env, tiltZ: 0, spinY: 0, y: 0.02 * env };
    }
    case "laugh": {
      // Fast small bounces with a side shake, decaying the way a
      // laugh runs out.
      const env = Math.pow(Math.sin(Math.PI * clamp01(p * 1.03)), 0.5);
      const shake = Math.sin(t * Math.PI * 2 * 4.6);
      return {
        tiltX: -0.05 * env,
        tiltZ: 0.1 * shake * env,
        spinY: 0,
        y: 0.03 * Math.abs(shake) * env,
      };
    }
    case "shrug": {
      // Shoulders up and a slow tilt each way: the universal
      // "dunno" — a rise, a rock, a settle.
      const lift = Math.sin(Math.PI * p);
      return { tiltX: 0, tiltZ: 0.09 * Math.sin(Math.PI * 2 * p) * lift, spinY: 0, y: 0.045 * lift };
    }
    case "highfive": {
      // One big hop with a lean in at the peak — meeting a hand
      // that (on a standee) is the whole body's reach.
      const arc = Math.sin(Math.PI * p);
      return { tiltX: -0.15 * arc, tiltZ: 0, spinY: 0, y: 0.24 * arc };
    }
    case "kneel": {
      // Deeper than sit and bowed with it — knelt respect, held
      // until toggled off or the wearer walks.
      const settle = easeOutCubic(clamp01(elapsed / 320));
      return { tiltX: -0.22 * settle, tiltZ: 0, spinY: 0, y: -0.78 * settle };
    }
    default:
      return null;
  }
}
