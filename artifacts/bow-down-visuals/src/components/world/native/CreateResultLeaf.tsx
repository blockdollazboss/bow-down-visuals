import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Music, Target, Trophy } from "lucide-react";
import {
  CLIP_MODEL_OPTIONS,
  SEEDANCE_DURATION_OPTIONS,
  VEO_CLIP_COST_VB,
  questAdvancesBetween,
  questChipLine,
  questsOfResponse,
  type ClipSettings,
  type QuestProgress,
} from "@/lib/world/create-desks";
import { peaksFromChannelData } from "@/lib/world/audio-benches";
import {
  abAvailability,
  abResumePosition,
  abSettledSide,
  abSideAfterFlip,
  type ABSide,
} from "@/lib/world/audio-ab";
import { useDeskAuthHeaders } from "./CreateDeskLeaf";

/* ─── Shared RESULT bits for the Create Wing desks (NATIVE-PLAN §3.6)
   The finished-make half of the old CreateDeskShared: the clip
   model picker, the in-world result renderers, the song desks'
   audio rail + publish reward, the quest-progress chip and the
   A/B player. WORLD-PERF ROUND 3 split it from CreateDeskLeaf
   (the form bits) so the StationPanel frame — which needs only
   form classes — never pays for the picker/player graph, and so
   neither half carries a desk import: this module's heaviest
   dependency is the pure lib/world/create-desks data module.
   ResultChips, the one shared piece that opens the Release /
   Scheduler desks, lives in CreateDeskShared. */

/* ─── The clip model picker ────────────────────────────────────────
   The model shelf the clip rail already serves, docked at the
   Create desks (it used to live only in the 2D Scene Studio):
   Standard / Premium · Seedance 2.5 / Cinematic · Veo, with the
   length + finish controls only where the picked model supports
   them. Purely controlled — the desk owns the settings and prices
   the run from lib/world/create-desks' clipPlanCost. */

/* The clip model shelf's display copy lives in the catalogs under
   the clipModel* keys of the desk namespace — keyed by the model's stable id, so
   the lib registry's own label/blurb stay the payload-side data
   (mirrored from SceneStudio) while the picker renders the
   walker's language. */
const CLIP_MODEL_COPY_KEYS: Record<string, { label: string; blurb: string }> = {
  "gen4.5": { label: "worldCreateDesk.clipModelStandardLabel", blurb: "worldCreateDesk.clipModelStandardBlurb" },
  seedance2_5: { label: "worldCreateDesk.clipModelPremiumLabel", blurb: "worldCreateDesk.clipModelPremiumBlurb" },
  veo3_1: { label: "worldCreateDesk.clipModelCinematicLabel", blurb: "worldCreateDesk.clipModelCinematicBlurb" },
};

export function ClipModelPicker(props: {
  isLight: boolean;
  settings: ClipSettings;
  onChange: (settings: ClipSettings) => void;
}) {
  const { t, i18n } = useTranslation();
  const { isLight, settings, onChange } = props;
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${
      active
        ? "border-[#d4af37] bg-[#d4af37] text-black"
        : isLight
          ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
          : "border-white/15 text-white/75 hover:text-white"
    }`;
  const picked = CLIP_MODEL_OPTIONS.find((m) => m.id === settings.model);
  return (
    <div className="space-y-2" data-testid="world-clip-model-picker">
      <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label={t("worldCreateDesk.clipModelAria")}>
        {CLIP_MODEL_OPTIONS.map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={settings.model === m.id}
            data-testid={`world-clip-model-${m.id}`}
            onClick={() => onChange({ ...settings, model: m.id })}
            className={chip(settings.model === m.id)}
          >
            {CLIP_MODEL_COPY_KEYS[m.id] ? t(CLIP_MODEL_COPY_KEYS[m.id]!.label) : m.label}
          </button>
        ))}
      </div>
      {picked ? (
        <p className={`text-[11px] ${muted}`}>
          {CLIP_MODEL_COPY_KEYS[picked.id] ? t(CLIP_MODEL_COPY_KEYS[picked.id]!.blurb) : picked.blurb}
        </p>
      ) : null}
      {settings.model === "seedance2_5" ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label={t("worldCreateDesk.clipLengthAria")}>
            <span className={`text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>{t("worldCreateDesk.clipLengthLabel")}</span>
            {SEEDANCE_DURATION_OPTIONS.map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={settings.durationSec === d}
                data-testid={`world-clip-duration-${d}`}
                onClick={() => onChange({ ...settings, durationSec: d })}
                className={chip(settings.durationSec === d)}
              >
                {t("worldCreateDesk.clipSeconds", { count: d })}
              </button>
            ))}
            <span className={`ml-2 text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>{t("worldCreateDesk.clipFinishLabel")}</span>
            {settings.draft ? (
              <span className={chip(true)}>{t("worldCreateDesk.clipDraftChip")}</span>
            ) : (
              (["720p", "1080p"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={settings.resolution === r}
                  data-testid={`world-clip-res-${r}`}
                  onClick={() => onChange({ ...settings, resolution: r })}
                  className={chip(settings.resolution === r)}
                >
                  {r}
                </button>
              ))
            )}
          </div>
          <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-bold bdv-touch-target">
            <input
              type="checkbox"
              data-testid="world-clip-draft-toggle"
              checked={settings.draft}
              onChange={(e) => onChange({ ...settings, draft: e.target.checked })}
            />
            {t("worldCreateDesk.clipDraftMode")}
          </label>
        </div>
      ) : null}
      {settings.model === "veo3_1" ? (
        <p className={`text-[11px] ${muted}`}>
          {t("worldCreateDesk.clipVeoNote", { cost: VEO_CLIP_COST_VB.toLocaleString(i18n.language) })}
        </p>
      ) : null}
    </div>
  );
}

/* ─── In-world result renderers ────────────────────────────────────── */

export function AudioResult({ url, title }: { url: string; title: string }) {
  return (
    <div data-testid="world-create-result-audio" className="space-y-2">
      <p className="text-sm font-bold">{title}</p>
      <audio src={url} controls className="w-full" />
    </div>
  );
}

export function VideoResult({ url, title }: { url: string; title: string }) {
  return (
    <div data-testid="world-create-result-video" className="space-y-2">
      <p className="text-sm font-bold">{title}</p>
      <video src={url} controls playsInline className="max-h-[320px] w-full rounded-xl" />
    </div>
  );
}

export function ImageResult({ url, title }: { url: string; title: string }) {
  return (
    <div data-testid="world-create-result-image" className="space-y-2">
      <p className="text-sm font-bold">{title}</p>
      <img src={url} alt={title} className="max-h-[320px] w-full rounded-xl object-contain" />
    </div>
  );
}

/* ─── The song desks' audio + publish reward rail (Ring 2, 2.1/2.2) ──
   A song package is words until it has audio: this rail is the
   site's own next step (GenerationResult's "Generate real audio")
   docked under the result — the price on the button is the real
   music-audio tier, the player appears only when audio truly
   landed, and a failure says so with a retry. Publishing rides the
   ResultChips publish chip beside it; once the server answers with
   the track, PublishedReward below is the unlock moment. */

export type SongAudioState = "idle" | "running" | "done" | "failed";

export function SongAudioRail(props: {
  isLight: boolean;
  state: SongAudioState;
  error: string | null;
  audioUrl: string | null;
  title: string;
  costVisualBucs: number;
  onMakeAudio: () => void;
  /** The Song Desk's one-confirmation flow: the member already
   *  confirmed this leg as part of the desk's up-front total, so
   *  the button carries no second price — the note names the
   *  total it rides on. The leg still charges exactly once, on
   *  its own rail, only when the audio is made. */
  includedInTotal?: number;
}) {
  const { t, i18n } = useTranslation();
  const { isLight } = props;
  if (props.state === "done" && props.audioUrl) {
    return (
      <div className="mt-3">
        <AudioResult url={props.audioUrl} title={props.title} />
      </div>
    );
  }
  return (
    <div className="mt-3 space-y-2">
      <button
        type="button"
        data-testid="world-create-make-audio"
        onClick={props.onMakeAudio}
        disabled={props.state === "running"}
        className="inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target"
      >
        <Music className="h-4 w-4" />
        {props.state === "running"
          ? t("worldCreateDesk.audioMaking")
          : props.state === "failed"
            ? props.includedInTotal !== undefined
              ? t("worldCreateDesk.audioMakeAgain")
              : t("worldCreateDesk.audioMakeAgainCost", {
                  cost: props.costVisualBucs.toLocaleString(i18n.language),
                })
            : props.includedInTotal !== undefined
              ? t("worldCreateDesk.audioMake")
              : t("worldCreateDesk.audioMakeCost", {
                  cost: props.costVisualBucs.toLocaleString(i18n.language),
                })}
      </button>
      {props.state === "failed" && props.error ? (
        <p data-testid="world-create-audio-error" className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
          {props.error}
        </p>
      ) : props.includedInTotal !== undefined ? (
        <p className={`text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
          {t("worldCreateDesk.audioCoveredNote", {
            total: props.includedInTotal.toLocaleString(i18n.language),
          })}
        </p>
      ) : (
        <p className={`text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
          {t("worldCreateDesk.audioPackageNote")}
        </p>
      )}
    </div>
  );
}

/** The publish unlock: shown ONLY after the publish rail answered
 *  with the track (server truth — never on click, never on hope).
 *  Gold reward card in the panel kit's language; the jukebox line
 *  flips to its celebrated state only once the chip has actually
 *  been fired from this card. */
export function PublishedReward(props: {
  isLight: boolean;
  title: string;
  jukeboxSent: boolean;
}) {
  const { t } = useTranslation();
  const { isLight } = props;
  return (
    <div
      data-testid="world-create-published-reward"
      className={`mt-3 rounded-2xl border p-3 ${
        isLight
          ? "border-[#C9A84C]/60 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]"
          : "border-[#d4af37]/40 bg-gradient-to-b from-[#1a1408] to-[#0d0a04]"
      }`}
    >
      <p className="flex items-center gap-2 text-sm font-black">
        <Trophy className="h-4 w-4 shrink-0 text-[#d4af37]" />
        {t("worldCreateDesk.rewardUnlocked", { title: props.title })}
      </p>
      <p className={`mt-1 text-[11px] leading-relaxed ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
        {props.jukeboxSent
          ? t("worldCreateDesk.rewardJukeboxSent")
          : t("worldCreateDesk.rewardJukeboxPrompt")}
      </p>
    </div>
  );
}

export function TextResult({ isLight, text, title }: { isLight: boolean; text: string; title: string }) {
  return (
    <div data-testid="world-create-result-text" className="space-y-2">
      <p className="text-sm font-bold">{title}</p>
      <pre
        className={`max-h-[240px] overflow-y-auto whitespace-pre-wrap rounded-xl border p-3 text-xs leading-relaxed ${
          isLight ? "border-[#C9A84C]/40 bg-white/50 text-[#2a1e07]" : "border-white/10 bg-white/5 text-white/80"
        }`}
      >
        {text}
      </pre>
    </div>
  );
}

/* ─── THE-GAME §5(a) — the desk result quest-progress chip ──────────
   A desk job snapshots the member's quest rails when it STARTS
   (GET /api/retention/quests — the Treasury board's own read) and
   re-reads them when it FINISHES. The diff is server truth: only a
   quest whose progress actually moved (or newly completed) earns a
   chip, named, with the claim pointed at the Treasury. No movement
   → no chip. A failed snapshot → no chip (never a guess). */

export function useQuestProgressChip() {
  const { t } = useTranslation();
  const beforeRef = useRef<QuestProgress[] | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const authHeaders = useDeskAuthHeaders();

  const snapshot = useCallback(async () => {
    setLines([]);
    try {
      const res = await fetch("/api/retention/quests", { headers: await authHeaders() });
      beforeRef.current = res.ok ? questsOfResponse(await res.json().catch(() => null)) : null;
    } catch {
      beforeRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkAfter = useCallback(async () => {
    try {
      const res = await fetch("/api/retention/quests", { headers: await authHeaders() });
      if (!res.ok) return;
      const after = questsOfResponse(await res.json().catch(() => null));
      const advances = questAdvancesBetween(beforeRef.current, after);
      if (advances.length > 0) {
        /* The line templates ride the catalogs (worldCreateDesk.
           questDone / questProgress); questChipLine stays the one
           composer — it substitutes the quest's own title/progress
           into whichever language's template it is handed. A bare
           t() with no values leaves the {{...}} slots intact. */
        const strings = {
          completed: t("worldCreateDesk.questDone"),
          progress: t("worldCreateDesk.questProgress"),
        };
        setLines(advances.map((a) => questChipLine(a, strings)));
      }
    } catch {
      /* the chip is a celebration, never a blocker — silence on failure */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { snapshot, checkAfter, lines };
}

export function QuestProgressChip({ isLight, lines }: { isLight: boolean; lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <div
      data-testid="world-create-quest-chip"
      className={`mt-3 rounded-2xl border p-3 ${
        isLight
          ? "border-[#C9A84C]/60 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]"
          : "border-[#d4af37]/40 bg-gradient-to-b from-[#1a1408] to-[#0d0a04]"
      }`}
    >
      {lines.map((line) => (
        <p key={line} className="flex items-start gap-2 text-xs font-bold leading-relaxed">
          <Target className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#d4af37]" />
          {line}
        </p>
      ))}
    </div>
  );
}

/* ─── Ring 2 (2.7) — the before/after A/B player with waveform peaks ─
   The Audio Studio cleanup panel's own pattern docked: decode both
   sides, draw per-bar peaks (lib/world/audio-benches shaping), and
   swap the playing source at the same position when the side
   flips. Peaks that can't decode render an honest "waveform
   unavailable" strip instead of a fake flat line. STACK-20 R2 #9:
   the flip/availability/position logic lives in lib/world/audio-ab
   and is shared with the full workbench; a missing original is
   named in the open (the note under the tabs), never silent. */

async function computePeaks(source: File | string, bars = 48): Promise<number[] | null> {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    let raw: ArrayBuffer;
    if (typeof source === "string") {
      const res = await fetch(source);
      raw = await res.arrayBuffer();
    } else {
      raw = await source.arrayBuffer();
    }
    const buf = await ctx.decodeAudioData(raw);
    const peaks = peaksFromChannelData(buf.getChannelData(0), bars);
    void ctx.close();
    return peaks.length > 0 ? peaks : null;
  } catch {
    return null;
  }
}

function WaveformBars({ peaks, active }: { peaks: number[] | null; active: boolean }) {
  const { t } = useTranslation();
  if (!peaks) {
    return (
      <div className="flex h-14 items-center justify-center text-[11px] opacity-60">
        {t("worldCreateDesk.waveformUnavailable")}
      </div>
    );
  }
  return (
    <div className="flex h-14 items-end gap-[2px]" aria-hidden>
      {peaks.map((p, i) => (
        <div
          key={i}
          className="flex-1 rounded-full bg-[#d4af37] transition-opacity"
          style={{ height: `${Math.max(6, p * 100)}%`, opacity: active ? 0.95 : 0.35 }}
        />
      ))}
    </div>
  );
}

export function ABAudioPlayer(props: {
  isLight: boolean;
  beforeLabel: string;
  afterLabel: string;
  beforeSource: File | string | null;
  afterUrl: string;
}) {
  const { t } = useTranslation();
  const { isLight } = props;
  const [side, setSide] = useState<ABSide>("after");
  const [beforeUrl, setBeforeUrl] = useState<string | null>(null);
  const [beforePeaks, setBeforePeaks] = useState<number[] | null>(null);
  const [afterPeaks, setAfterPeaks] = useState<number[] | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  /* STACK-20 R2 #9: availability + the honestly-shown side come
     from the seam (lib/world/audio-ab). A missing original is
     said out loud below — never a silently dead tab, and never
     the finished audio playing under a "Before" face. */
  const availability = abAvailability({ beforeSource: props.beforeSource, afterUrl: props.afterUrl });
  const shownSide = abSettledSide(side, availability);

  useEffect(() => {
    if (!props.beforeSource) {
      setBeforeUrl(null);
      setBeforePeaks(null);
      return;
    }
    if (typeof props.beforeSource === "string") {
      setBeforeUrl(props.beforeSource);
      void computePeaks(props.beforeSource).then(setBeforePeaks);
      return;
    }
    const url = URL.createObjectURL(props.beforeSource);
    setBeforeUrl(url);
    void computePeaks(props.beforeSource).then(setBeforePeaks);
    return () => URL.revokeObjectURL(url);
  }, [props.beforeSource]);

  useEffect(() => {
    void computePeaks(props.afterUrl).then(setAfterPeaks);
  }, [props.afterUrl]);

  const flip = (next: ABSide) => {
    const target = abSideAfterFlip(shownSide, next, availability);
    setSide(target);
    if (target === shownSide) return;
    const el = audioRef.current;
    if (!el) return;
    const t = el.currentTime;
    const wasPlaying = !el.paused;
    el.pause();
    window.setTimeout(() => {
      const url = target === "after" ? props.afterUrl : beforeUrl;
      if (!url || !audioRef.current) return;
      audioRef.current.src = url;
      audioRef.current.currentTime = abResumePosition(t, audioRef.current.duration);
      if (wasPlaying) void audioRef.current.play().catch(() => {});
    }, 0);
  };

  const tabCls = (active: boolean) =>
    `rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${
      active
        ? "border-[#d4af37] bg-[#d4af37] text-black"
        : isLight
          ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
          : "border-white/15 text-white/75 hover:text-white"
    }`;

  return (
    <div data-testid="world-audio-ab-player" className="space-y-2">
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={t("worldCreateDesk.abAria")}>
        <button type="button" role="tab" aria-selected={shownSide === "before"} data-testid="world-audio-ab-before" onClick={() => flip("before")} disabled={!beforeUrl} className={tabCls(shownSide === "before")}>
          {t("worldCreateDesk.abBefore", { label: props.beforeLabel })}
        </button>
        <button type="button" role="tab" aria-selected={shownSide === "after"} data-testid="world-audio-ab-after" onClick={() => flip("after")} className={tabCls(shownSide === "after")}>
          {t("worldCreateDesk.abAfter", { label: props.afterLabel })}
        </button>
      </div>
      {!availability.before && (
        <p data-testid="world-audio-ab-before-gone" className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
          {t("worldCreateDesk.abBeforeGone", { label: props.afterLabel })}
        </p>
      )}
      <WaveformBars peaks={shownSide === "before" ? beforePeaks : afterPeaks} active />
      <audio ref={audioRef} src={shownSide === "after" ? props.afterUrl : (beforeUrl ?? undefined)} controls className="w-full" />
    </div>
  );
}
