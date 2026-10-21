/* ─── FCPXML timeline export (Pro Finishing Door) ────────────────────────
 * Builds a real Final Cut Pro XML (FCPXML 1.10) from the video editor's own
 * timeline model — the same scenes, playback order, trims, and placements
 * the export render consumes — so a creator can finish a Bow Down Visuals
 * cut in Final Cut Pro without rebuilding the edit by hand.
 *
 * Honesty rules (this file carries only what the editor model holds):
 *  - Clip order, timeline start, and duration come from the editor's scene
 *    timings (computeSceneTimings / computeManualTimings upstream).
 *  - Source in-point = the clip's ClipEdit.trimStart; the source span is
 *    the timeline duration plus both trims — nothing is probed or guessed.
 *  - A flat Pro Tools speed (no ramps) becomes a real <timeMap> retime.
 *    Clips with speed RAMPS (curve/segments) are flagged with an XML
 *    comment: FCPXML carries them at flat timing because a sampled ramp
 *    has no exact constant-rate equivalent — the file says so itself.
 *  - Assets reference the clip URLs the editor already holds; no media is
 *    embedded. In Final Cut the clips arrive as references to relink to
 *    the downloaded files — the standard XML-only handoff.
 *  - Manual-layout gaps stay gaps (<gap> elements); nothing is compacted.
 */

export interface FcpxmlClipInput {
  /** Display name (scene label) as shown in the editor. */
  name: string;
  /** The clip URL the editor holds for this scene. */
  src: string;
  /** Timeline position (seconds) where the clip starts in the sequence. */
  startSec: number;
  /** Timeline duration (seconds) the clip occupies. */
  durationSec: number;
  /** In-point into the source clip (seconds) — ClipEdit.trimStart. */
  sourceStartSec: number;
  /** Full source span the editor models for this clip (seconds):
   *  timeline duration + trimStart + trimEnd. */
  sourceDurationSec: number;
  /** Flat playback speed (1 = normal). Ignored when hasSpeedRamp is set. */
  speed: number;
  /** True when the clip uses speed ramps/curves — carried flat, with a
   *  comment in the XML saying so. */
  hasSpeedRamp: boolean;
}

export interface FcpxmlAudioInput {
  name: string;
  src: string;
  /** Known song duration (seconds), or null when the editor doesn't know. */
  durationSec: number | null;
}

export interface FcpxmlTimelineInput {
  projectName: string;
  /** Sequence frame rate (the export pipeline's timeline rate). */
  fps: number;
  width: number;
  height: number;
  clips: FcpxmlClipInput[];
  audio?: FcpxmlAudioInput | null;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x === 0 ? 1 : x;
}

/** Seconds → FCPXML rational time, frame-aligned at the given fps
 *  (e.g. 2.5s @30fps → "5/2s", 4s → "4s"). */
export function fcpxmlTime(seconds: number, fps: number): string {
  const frames = Math.max(0, Math.round(seconds * fps));
  if (frames === 0) return "0s";
  const g = gcd(frames, fps);
  const n = frames / g;
  const d = fps / g;
  return d === 1 ? `${n}s` : `${n}/${d}s`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** File name for the downloaded timeline, from the project name. */
export function fcpxmlFileName(projectName: string): string {
  const slug = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "bow-down-visuals-timeline"}.fcpxml`;
}

export function buildFcpxml(input: FcpxmlTimelineInput): string {
  const { fps, width, height } = input;
  const clips = input.clips;
  const sequenceDuration = clips.reduce(
    (max, c) => Math.max(max, c.startSec + c.durationSec),
    0,
  );

  const lines: string[] = [];
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(`<!DOCTYPE fcpxml>`);
  lines.push(`<fcpxml version="1.10">`);
  lines.push(`  <resources>`);
  lines.push(
    `    <format id="r1" name="FFVideoFormat${width}x${height}p${fps}" frameDuration="1/${fps}s" width="${width}" height="${height}"/>`,
  );

  // One asset per distinct source URL — a reused clip is one asset with
  // several spine references, exactly like the editor model treats it.
  const assetIdBySrc = new Map<string, string>();
  let assetSeq = 1;
  const assetIdFor = (src: string): string => {
    const existing = assetIdBySrc.get(src);
    if (existing) return existing;
    assetSeq += 1;
    const id = `r${assetSeq}`;
    assetIdBySrc.set(src, id);
    return id;
  };

  for (const clip of clips) {
    const id = assetIdFor(clip.src);
    const consumed = clip.sourceStartSec + clip.durationSec * (clip.hasSpeedRamp ? 1 : clip.speed);
    const assetDuration = Math.max(clip.sourceDurationSec, consumed);
    lines.push(
      `    <asset id="${id}" name="${escapeXml(clip.name)}" src="${escapeXml(clip.src)}" start="0s" duration="${fcpxmlTime(assetDuration, fps)}" hasVideo="1" hasAudio="0" format="r1"/>`,
    );
  }

  let audioAssetId: string | null = null;
  if (input.audio) {
    audioAssetId = assetIdFor(input.audio.src);
    const audioDuration = input.audio.durationSec ?? sequenceDuration;
    lines.push(
      `    <asset id="${audioAssetId}" name="${escapeXml(input.audio.name)}" src="${escapeXml(input.audio.src)}" start="0s" duration="${fcpxmlTime(audioDuration, fps)}" hasVideo="0" hasAudio="1" format="r1" audioSources="1" audioChannels="2" audioRate="48000"/>`,
    );
  }

  lines.push(`  </resources>`);
  lines.push(`  <library>`);
  lines.push(`    <event name="Bow Down Visuals Export">`);
  lines.push(`      <project name="${escapeXml(input.projectName)}">`);
  lines.push(
    `        <sequence format="r1" duration="${fcpxmlTime(sequenceDuration, fps)}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">`,
  );
  lines.push(`          <spine>`);

  let cursor = 0;
  const frameSec = 1 / fps;
  for (const clip of clips) {
    if (clip.startSec - cursor > frameSec / 2) {
      lines.push(
        `            <gap name="Gap" offset="${fcpxmlTime(cursor, fps)}" start="0s" duration="${fcpxmlTime(clip.startSec - cursor, fps)}"/>`,
      );
    }
    const id = assetIdFor(clip.src);
    const retimed = !clip.hasSpeedRamp && clip.speed !== 1;
    if (clip.hasSpeedRamp) {
      lines.push(
        `            <!-- "${escapeXml(clip.name)}" uses speed ramps in Bow Down Visuals; FCPXML carries it at flat timing. -->`,
      );
    }
    const attrs =
      `name="${escapeXml(clip.name)}" ref="${id}" offset="${fcpxmlTime(clip.startSec, fps)}" ` +
      `start="${fcpxmlTime(clip.sourceStartSec, fps)}" duration="${fcpxmlTime(clip.durationSec, fps)}" tcFormat="NDF"`;
    if (retimed) {
      const sourceEnd = clip.sourceStartSec + clip.durationSec * clip.speed;
      lines.push(`            <asset-clip ${attrs}>`);
      lines.push(`              <timeMap>`);
      lines.push(
        `                <timept time="0s" value="${fcpxmlTime(clip.sourceStartSec, fps)}" interp="smooth"/>`,
      );
      lines.push(
        `                <timept time="${fcpxmlTime(clip.durationSec, fps)}" value="${fcpxmlTime(sourceEnd, fps)}" interp="smooth"/>`,
      );
      lines.push(`              </timeMap>`);
      lines.push(`            </asset-clip>`);
    } else {
      lines.push(`            <asset-clip ${attrs}/>`);
    }
    cursor = Math.max(cursor, clip.startSec + clip.durationSec);
  }

  if (input.audio && audioAssetId) {
    const audioDuration = Math.min(input.audio.durationSec ?? sequenceDuration, sequenceDuration);
    lines.push(
      `            <asset-clip name="${escapeXml(input.audio.name)}" ref="${audioAssetId}" lane="-1" offset="0s" start="0s" duration="${fcpxmlTime(audioDuration, fps)}" tcFormat="NDF"/>`,
    );
  }

  lines.push(`          </spine>`);
  lines.push(`        </sequence>`);
  lines.push(`      </project>`);
  lines.push(`    </event>`);
  lines.push(`  </library>`);
  lines.push(`</fcpxml>`);
  return lines.join("\n") + "\n";
}
