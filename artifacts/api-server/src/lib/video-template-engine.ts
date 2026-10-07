/**
 * Pure ffmpeg engine for video edit templates.
 *
 * Deliberately dependency-free (no express, no credits, no storage) so the
 * recipe → filtergraph logic can be smoke-tested standalone. The route
 * `routes/generate/video-template.ts` wires this engine to auth, billing,
 * jobs, and uploads.
 */
import { execFile } from "child_process";
import { promisify } from "util";
import { join } from "path";
import {
  TEMPLATE_TRANSITION_KEYS,
  type TemplateAspect,
  type VideoTemplateRecipe,
} from "../data/video-templates";

const execFileAsync = promisify(execFile);

export const SANS_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

export const ASPECT_DIMS: Record<TemplateAspect, { w: number; h: number }> = {
  "9:16": { w: 720, h: 1280 },
  "16:9": { w: 1280, h: 720 },
  "1:1": { w: 1080, h: 1080 },
};

export function escapeDrawtext(t: string): string {
  return (
    t
      // ffmpeg 8's filter parser does not honor \' inside single-quoted
      // values (the quote terminates early and breaks the graph) — use the
      // typographic apostrophe, which DejaVu renders identically.
      .replace(/'/g, "’")
      .replace(/\\/g, "\\\\")
      .replace(/:/g, "\\:")
      .replace(/%/g, "%%")
      .replace(/,/g, "\\,")
  );
}

export interface SlotPlan {
  inputIndex: number;
  isImage: boolean;
  duration: number; // seconds this slot occupies in the final cut
  srcDuration: number | null; // probed source length (videos only)
  hasAudio: boolean;
  label: string;
}

export interface FilterBuild {
  filter: string;
  maps: string[];
  totalSec: number;
}

/**
 * Build the full ffmpeg filtergraph for a recipe:
 *  - photo slots → Ken Burns zoompan (alternating in/out)
 *  - video slots → trimmed to slot length (short sources get clone-padded)
 *  - every slot normalized (cover-crop, 30fps, yuv420p, AVTB) then chained
 *    with the recipe's xfade transitions
 *  - gentle fade in/out, optional luxury-gold grade, recipe text overlays
 *  - audio legs → acrossfade chain, optional ducked music bed mix
 */
export function buildFiltergraph(
  recipe: VideoTemplateRecipe,
  plans: SlotPlan[],
  overlayTexts: string[],
  hasBed: boolean,
  /** when set, the final junction (e.g. into the branded end card) uses this duration */
  finalJunctionDurationSec?: number,
  /** ffmpeg input index of the music bed (it is not part of `plans`) */
  bedInputIndex?: number,
): FilterBuild {
  const { w: W, h: H } = ASPECT_DIMS[recipe.aspect];
  const n = plans.length;

  /* Per-junction transition durations, clamped to fit both neighbors.
     (Trimming a clip exactly to the transition length once hung xfade —
     keep every segment strictly longer than its junctions.) */
  const junctions: Array<{ transition: string; d: number }> = [];
  for (let j = 0; j < n - 1; j++) {
    const key = recipe.transitions[j] ?? recipe.transitions[recipe.transitions.length - 1] ?? "fade";
    const safe = TEMPLATE_TRANSITION_KEYS.includes(key as (typeof TEMPLATE_TRANSITION_KEYS)[number])
      ? key
      : "fade";
    const want = j === n - 2 && finalJunctionDurationSec != null ? finalJunctionDurationSec : recipe.transitionDurationSec;
    const d = Math.min(want, plans[j]!.duration / 2 - 0.05, plans[j + 1]!.duration / 2 - 0.05, 2);
    junctions.push({ transition: safe, d: Math.max(0.05, d) });
  }

  /* Video legs */
  const vParts: string[] = [];
  plans.forEach((p, i) => {
    const tag = `v${i}`;
    if (p.isImage) {
      const frames = Math.max(1, Math.round(p.duration * 30));
      const zoomIn = i % 2 === 0;
      const zExpr = zoomIn
        ? `min(1+0.18*on/${frames},1.18)`
        : `max(1.18-0.18*on/${frames},1)`;
      vParts.push(
        `[${p.inputIndex}:v]` +
          `scale=${Math.ceil(W * 1.3)}:${Math.ceil(H * 1.3)}:force_original_aspect_ratio=increase,` +
          `crop=${W}:${H},` +
          `zoompan=z='${zExpr}':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=30,` +
          `format=yuv420p,settb=AVTB[${tag}]`,
      );
    } else {
      const srcD = p.srcDuration ?? p.duration;
      let leg = `[${p.inputIndex}:v]trim=0:${Math.min(p.duration, srcD).toFixed(3)},setpts=PTS-STARTPTS`;
      if (srcD < p.duration) {
        leg += `,tpad=stop=-1:stop_mode=clone:stop_duration=${(p.duration - srcD).toFixed(3)}`;
      }
      leg +=
        `,scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},` +
        `fps=30,format=yuv420p,settb=AVTB[${tag}]`;
      vParts.push(leg);
    }
  });

  /* xfade chain */
  let filter = vParts.join(";");
  let vCur = n > 0 ? "v0" : "";
  let cumDur = n > 0 ? plans[0]!.duration : 0;
  for (let j = 0; j < junctions.length; j++) {
    const jn = junctions[j]!;
    const offset = Math.max(0.05, cumDur - jn.d);
    const out = `x${j + 1}`;
    filter += `;[${vCur}][v${j + 1}]xfade=transition=${jn.transition}:duration=${jn.d.toFixed(3)}:offset=${offset.toFixed(3)}[${out}]`;
    vCur = out;
    cumDur = cumDur + plans[j + 1]!.duration - jn.d;
  }
  const totalSec = cumDur;

  /* Gentle fade in/out */
  const fadeD = Math.min(0.4, totalSec / 4);
  filter += `;[${vCur}]fade=t=in:st=0:d=${fadeD.toFixed(3)},fade=t=out:st=${Math.max(0, totalSec - fadeD).toFixed(3)}:d=${fadeD.toFixed(3)}[vf]`;
  vCur = "vf";

  /* Optional luxury-gold grade */
  if (recipe.grade === "luxury-gold") {
    filter +=
      `;[${vCur}]eq=contrast=1.05:saturation=1.28:brightness=0.015,` +
      `colorbalance=rm=0.07:gm=0.03:bm=-0.07:rs=0.05:gs=0.02:bs=-0.05[vg]`;
    vCur = "vg";
  }

  /* Text overlays — slot start times account for the consumed transitions */
  const slotStart: number[] = [];
  let acc = 0;
  for (let i = 0; i < n; i++) {
    slotStart.push(acc);
    if (i < junctions.length) acc += plans[i]!.duration - junctions[i]!.d;
  }
  const fontSizes = W >= 1000 ? { sm: 44, md: 64, lg: 96 } : { sm: 34, md: 50, lg: 78 };
  recipe.overlays.forEach((ov, oi) => {
    const text = (overlayTexts[oi] ?? "").trim() || ov.text;
    const start = Math.max(0, (slotStart[ov.slotIndex] ?? 0) + ov.startSec);
    const end = Math.min(totalSec, start + ov.durationSec);
    if (end <= start + 0.05) return;
    const y =
      ov.position === "top" ? "110"
      : ov.position === "center" ? "(h-text_h)/2"
      : `h-230`;
    const color = ov.color === "gold" ? "0xFFD700" : "white";
    const out = `vo${oi}`;
    filter +=
      `;[${vCur}]drawtext=fontfile=${SANS_BOLD}:text='${escapeDrawtext(text)}':` +
      `fontcolor=${color}:fontsize=${fontSizes[ov.size]}:borderw=3:bordercolor=black:` +
      `x=(w-text_w)/2:y=${y}:enable='between(t,${start.toFixed(2)},${end.toFixed(2)})'[${out}]`;
    vCur = out;
  });

  /* Audio: per-slot legs → acrossfade chain → optional bed mix */
  const aParts: string[] = [];
  plans.forEach((p, i) => {
    const tag = `a${i}`;
    if (!p.isImage && p.hasAudio) {
      const take = Math.min(p.duration, p.srcDuration ?? p.duration);
      let leg = `[${p.inputIndex}:a]atrim=0:${take.toFixed(3)},asetpts=PTS-STARTPTS`;
      if (take < p.duration) {
        leg += `,apad=whole_dur=${p.duration.toFixed(3)}`;
      }
      leg += `,aresample=44100,aformat=channel_layouts=stereo[${tag}]`;
      aParts.push(leg);
    } else {
      aParts.push(`aevalsrc=0:d=${p.duration.toFixed(3)}:s=44100[${tag}]`);
    }
  });
  filter += `;${aParts.join(";")}`;
  let aCur = "a0";
  for (let j = 0; j < junctions.length; j++) {
    const out = `ax${j + 1}`;
    filter += `;[${aCur}][a${j + 1}]acrossfade=d=${junctions[j]!.d.toFixed(3)}:curve1=tri:curve2=tri[${out}]`;
    aCur = out;
  }

  const maps = ["-map", `[${vCur}]`];
  if (hasBed && bedInputIndex != null) {
    const bedIdx = bedInputIndex;
    filter +=
      `;[${bedIdx}:a]aloop=loop=-1:size=2147483647,aresample=44100,` +
      `aformat=channel_layouts=stereo,volume=0.28,atrim=0:${totalSec.toFixed(3)},` +
      `asetpts=PTS-STARTPTS[bedm]` +
      `;[${aCur}][bedm]amix=inputs=2:duration=shortest:dropout_transition=0:normalize=0[aout]`;
    maps.push("-map", "[aout]");
  } else {
    const anyAudio = plans.some((p) => !p.isImage && p.hasAudio);
    if (anyAudio) {
      maps.push("-map", `[${aCur}]`);
    } else {
      maps.push("-an");
    }
  }

  return { filter, maps, totalSec };
}

/**
 * Branded outro card: black + gold "Made with Bow Down Visuals".
 * Generated locally with ffmpeg (no provider spend), then appended
 * to the render as a final slot.
 */
export async function buildEndCard(workDir: string, w: number, h: number): Promise<string> {
  const cardPath = join(workDir, "endcard.mp4");
  const fs1 = w >= 1000 ? 64 : 40;
  const fs2 = w >= 1000 ? 36 : 26;
  const vf =
    `drawtext=fontfile=${SANS_BOLD}:text='${escapeDrawtext("BOW DOWN VISUALS")}':` +
    `fontcolor=0xFFD700:fontsize=${fs1}:x=(w-text_w)/2:y=(h-text_h)/2-24,` +
    `drawtext=fontfile=${SANS_BOLD}:text='${escapeDrawtext("Made with")}':` +
    `fontcolor=white:fontsize=${fs2}:x=(w-text_w)/2:y=(h-text_h)/2+${Math.round(fs1 * 0.7)},` +
    `fade=t=in:st=0:d=0.4,fade=t=out:st=1.7:d=0.5,format=yuv420p`;
  await execFileAsync(
    "ffmpeg",
    [
      "-y",
      "-f", "lavfi",
      "-i", `color=c=0x0a0a0a:s=${w}x${h}:r=30:d=2.2`,
      "-vf", vf,
      "-c:v", "libx264", "-preset", "fast", "-crf", "20",
      "-pix_fmt", "yuv420p",
      cardPath,
    ],
    { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 },
  );
  return cardPath;
}
