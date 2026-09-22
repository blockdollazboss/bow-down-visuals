import type {
  AudioExportRecord,
  MusicStudioSettings,
  VideoAudioSource,
} from "@/lib/editor-settings";

export const VIDEO_AUDIO_SOURCE_LABELS: Record<VideoAudioSource, string> = {
  uploaded: "Uploaded Original Song",
  "full-mix": "Exported Full Mix",
  instrumental: "Exported Instrumental",
  acapella: "Exported Acapella",
  none: "No Audio",
};

export interface VideoAudioResolution {
  /** The URL that both preview and export should use. */
  url: string | null;
  /** The source the user selected. */
  requestedSource: VideoAudioSource;
  /** True when a selected rendered mix was not found. */
  missingExport: boolean;
  /** What the shared resolver used instead of the requested mix, if anything. */
  fallbackSource: "project-audio" | "first-stem" | "none" | null;
}

function hasUrl(record: AudioExportRecord): boolean {
  return record.url.trim().length > 0;
}

function fallbackResolution(
  requestedSource: VideoAudioSource,
  fallback: string | null,
  fallbackSource: VideoAudioResolution["fallbackSource"],
): VideoAudioResolution {
  return {
    url: fallback,
    requestedSource,
    missingExport: true,
    fallbackSource,
  };
}

/**
 * Resolves the selected video audio and explains whether the resolver had to
 * fall back. Keep this as the source of truth for UI warnings as well as the
 * URL wrapper below, so availability checks cannot drift from playback.
 */
export function resolveVideoAudio(
  musicStudio: Pick<MusicStudioSettings, "videoAudio" | "exports" | "stems">,
  projectAudioUrl: string | null | undefined,
): VideoAudioResolution {
  const va = musicStudio.videoAudio;
  const projectAudio = projectAudioUrl ?? null;
  const stemAudio = musicStudio.stems[0]?.url ?? null;
  const fallback = projectAudio ?? stemAudio;
  const fallbackSource: VideoAudioResolution["fallbackSource"] = projectAudio
    ? "project-audio"
    : stemAudio
    ? "first-stem"
    : "none";

  switch (va.source) {
    case "none":
      return {
        url: fallback,
        requestedSource: va.source,
        missingExport: false,
        fallbackSource: null,
      };
    case "uploaded":
      return {
        url: fallback,
        requestedSource: va.source,
        missingExport: false,
        fallbackSource: projectAudio ? null : fallbackSource,
      };
    case "full-mix": {
      const rendered = musicStudio.exports.find(
        (record) => record.kind === "full" && record.format === "mp3" && hasUrl(record),
      ) ?? musicStudio.exports.find(
        (record) => record.kind === "full" && hasUrl(record),
      );
      return rendered
        ? {
            url: rendered.url,
            requestedSource: va.source,
            missingExport: false,
            fallbackSource: null,
          }
        : fallbackResolution(va.source, fallback, fallbackSource);
    }
    case "instrumental": {
      const rendered = musicStudio.exports.find(
        (record) => record.kind === "instrumental" && hasUrl(record),
      );
      return rendered
        ? {
            url: rendered.url,
            requestedSource: va.source,
            missingExport: false,
            fallbackSource: null,
          }
        : fallbackResolution(va.source, fallback, fallbackSource);
    }
    case "acapella": {
      const rendered = musicStudio.exports.find(
        (record) => record.kind === "acapella" && hasUrl(record),
      );
      return rendered
        ? {
            url: rendered.url,
            requestedSource: va.source,
            missingExport: false,
            fallbackSource: null,
          }
        : fallbackResolution(va.source, fallback, fallbackSource);
    }
    default:
      return {
        url: fallback,
        requestedSource: va.source,
        missingExport: false,
        fallbackSource: null,
      };
  }
}

/** Whether the selected source has a usable rendered export record. */
export function hasRenderedVideoAudioExport(
  exports: AudioExportRecord[],
  source: VideoAudioSource,
): boolean {
  if (source === "full-mix") {
    return exports.some((record) => record.kind === "full" && hasUrl(record));
  }
  if (source === "instrumental" || source === "acapella") {
    return exports.some((record) => record.kind === source && hasUrl(record));
  }
  return source === "uploaded" || source === "none";
}

/**
 * Resolves which audio URL actually plays under the video, given the studio's
 * chosen `videoAudio.source`. This is the single source of truth used by both
 * the Timeline Preview / Master Player *and* Final Video Export, so a mix that
 * exists in `musicStudio.exports` is never silently swapped for the raw
 * uploaded song (or vice versa) between preview and export.
 *
 * Priority per source:
 *  - "none"          → project audio, else first uploaded stem, else null.
 *  - "uploaded"       → project audio, else first uploaded stem, else null.
 *  - "full-mix"       → rendered full-mix MP3 export, else any full-mix export,
 *                       else project audio, else first stem, else null.
 *  - "instrumental"   → rendered instrumental export, else project audio,
 *                       else first stem, else null.
 *  - "acapella"       → rendered acapella export, else project audio,
 *                       else first stem, else null.
 *
 * The "else project audio" branches ARE the fallback case: if the user picked
 * a studio mix but never rendered it (or it was deleted), export/preview both
 * fall back to the uploaded song instead of playing silence.
 */
export function resolveVideoAudioUrl(
  musicStudio: Pick<MusicStudioSettings, "videoAudio" | "exports" | "stems">,
  projectAudioUrl: string | null | undefined,
): string | null {
  return resolveVideoAudio(musicStudio, projectAudioUrl).url;
}
