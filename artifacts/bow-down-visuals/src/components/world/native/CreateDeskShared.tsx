import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { BadgeCheck, ChevronDown, Disc3, ListMusic, Music, PenLine, Rocket, Scissors, Sparkles, Trophy } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  jukeboxChipStateOf,
  jukeboxTrackIdOf,
  CLIP_MODEL_OPTIONS,
  SEEDANCE_DURATION_OPTIONS,
  VEO_CLIP_COST_VB,
  type ClipSettings,
} from "@/lib/world/create-desks";
import type { ReleasePrefill } from "@/lib/world/release-desk";
import type { SchedulerPrefill } from "@/lib/world/scheduler-desk";
import { ReleaseDeskStandalone } from "./ReleaseDesk";
import { SchedulerComposeStandalone } from "./SchedulerDesk";

/* ─── Shared bits for the Create Wing desks (NATIVE-PLAN §3.6) ──────
   One shape for all six benches: the CreateDeskRunner prompt card,
   Advanced fields behind ONE expander, the result in-world, and
   next-step chips under it. Fetching follows the panel host's own
   pattern (the member's token via useAuth — the same useAuthHeaders
   the Treasury/Jukebox panels use); the price is shown by the
   runner before anything runs, so no second confirmation stands
   between the walker and the make. */

export function useDeskAuthHeaders() {
  const { getAccessToken } = useAuth();
  return async (): Promise<Record<string, string>> => {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  };
}

export function deskInputCls(isLight: boolean): string {
  return `w-full rounded-xl border px-3 py-2 text-sm outline-none transition focus:border-[#d4af37] bdv-touch-target ${
    isLight
      ? "border-[#C9A84C]/40 bg-white/60 text-[#2a1e07] placeholder:text-[#6B5B36]/60"
      : "border-white/10 bg-white/5 text-white placeholder:text-white/35"
  }`;
}

export function DeskTextField({
  isLight,
  label,
  value,
  onChange,
  placeholder,
}: {
  isLight: boolean;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={deskInputCls(isLight)}
      />
    </label>
  );
}

export function DeskSelectField({
  isLight,
  label,
  value,
  onChange,
  options,
}: {
  isLight: boolean;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
}) {
  return (
    <label className="block">
      <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ colorScheme: isLight ? "light" : "dark" }}
        className={deskInputCls(isLight)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The ONE Advanced expander every desk folds its manual fields
 *  behind (Turbo is the desk's face; Advanced is one tap deeper). */
export function AdvancedExpander({
  isLight,
  children,
  defaultOpen = false,
}: {
  isLight: boolean;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`rounded-xl border ${isLight ? "border-[#C9A84C]/40" : "border-white/10"}`}>
      <button
        type="button"
        data-testid="world-create-advanced-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`flex w-full items-center gap-2 px-3 py-2 text-xs font-black uppercase tracking-[0.14em] ${
          isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"
        }`}
      >
          Advanced
        <ChevronDown className={`ml-auto h-4 w-4 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? <div className="space-y-3 px-3 pb-3">{children}</div> : null}
    </div>
  );
}

/* ─── The clip model picker ────────────────────────────────────────
   The model shelf the clip rail already serves, docked at the
   Create desks (it used to live only in the 2D Scene Studio):
   Standard / Premium · Seedance 2.5 / Cinematic · Veo, with the
   length + finish controls only where the picked model supports
   them. Purely controlled — the desk owns the settings and prices
   the run from lib/world/create-desks' clipPlanCost. */

export function ClipModelPicker(props: {
  isLight: boolean;
  settings: ClipSettings;
  onChange: (settings: ClipSettings) => void;
}) {
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
      <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Clip model">
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
            {m.label}
          </button>
        ))}
      </div>
      {picked ? <p className={`text-[11px] ${muted}`}>{picked.blurb}</p> : null}
      {settings.model === "seedance2_5" ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Clip length">
            <span className={`text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>Length</span>
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
                {d}s
              </button>
            ))}
            <span className={`ml-2 text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>Finish</span>
            {settings.draft ? (
              <span className={chip(true)}>480p draft</span>
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
          <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-bold">
            <input
              type="checkbox"
              data-testid="world-clip-draft-toggle"
              checked={settings.draft}
              onChange={(e) => onChange({ ...settings, draft: e.target.checked })}
            />
            Draft mode — cheap 480p preview first
          </label>
        </div>
      ) : null}
      {settings.model === "veo3_1" ? (
        <p className={`text-[11px] ${muted}`}>
          One fixed 8-second clip · {VEO_CLIP_COST_VB.toLocaleString("en-US")} Visual Bucs.
        </p>
      ) : null}
    </div>
  );
}

/** POST /api/generated-clips — the library save SceneStudio makes
 *  the moment a clip lands, shared by the Create desks: a finished
 *  desk clip lands in My Clips like any other. Best-effort like the
 *  page's (the clip already plays in the panel either way); the
 *  boolean lets the desk SAY whether the library copy landed. */
export async function saveGeneratedClipToLibrary(
  authHeaders: () => Promise<Record<string, string>>,
  payload: Record<string, unknown>,
): Promise<boolean> {
  try {
    const res = await fetch("/api/generated-clips", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/* ─── Result chips ───────────────────────────────────────────────────
   The in-world next steps under a finished make. Every chip is a
   real rail: Send to the editor saves the result as a project and
   steps through to the editor seeded with it; Put it on the
   jukebox rides the room socket's jukebox.add intent and lights
   ONLY for a published-track id (the queue's own rule) — before
   the publish lands, the chip sits dark with its reason on its
   face ("publish first"), a plain span that takes no click at
   all, never a dead button; Schedule / Release render only where
   the desk's page offers that exact rail for that exact asset;
   Make another resets the bench. */

export interface ResultChipsProps {
  isLight: boolean;
  /** Save-as-project + step through to the seeded editor. Absent
   *  when the host gave the panel no editor door. */
  onSendToEditor?: () => void;
  editorBusy?: boolean;
  /** Publish to the creator's profile on the site's real rail
   *  (POST /api/publish/track). Offered only when the desk holds a
   *  publishable asset; once `published` is true the chip becomes
   *  the settled state and can never fire a second publish. */
  onPublish?: () => void;
  publishBusy?: boolean;
  published?: boolean;
  /** A published profile track id (`track:<uuid>`) — the only ids
   *  the room jukebox accepts. Anything else leaves the chip dark
   *  with its reason showing (see the dark chip below); the chip
   *  lights the moment a gate-passing id lands here. */
  jukeboxTrackId?: string | null;
  onJukeboxAdd?: (trackId: string) => void;
  /** The finished asset handed to the IN-WORLD scheduler
   *  (Stack-100 #46): the chip opens the scheduler compose right
   *  here, prefilled — the post completes in-world, never a
   *  target=_blank exit to the 2D scheduler. */
  schedulePrefill?: SchedulerPrefill;
  /** The finished asset handed to the IN-WORLD release desk
   *  (Stack-100 #55): the chip opens the distribution wizard right
   *  here, prefilled with the cover — the release completes
   *  in-world, never a target=_blank exit to /distribute. */
  releasePrefill?: ReleasePrefill;
  onSaveDraft?: () => void;
  draftSaved?: boolean;
  onMakeAnother: () => void;
}

export function ResultChips(props: ResultChipsProps) {
  const { isLight } = props;
  const [schedulerOpen, setSchedulerOpen] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const chipCls = `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${
    isLight
      ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
      : "border-white/15 text-white/75 hover:text-white"
  }`;
  const goldChipCls =
    "inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target";
  const trackId = jukeboxTrackIdOf(props.jukeboxTrackId);
  const jukeboxChip = jukeboxChipStateOf({
    candidate: props.jukeboxTrackId,
    railOffered: Boolean(props.onJukeboxAdd),
  });
  return (
    <div data-testid="world-create-result-chips" className="mt-3 flex flex-wrap gap-1.5">
      {props.onSendToEditor ? (
        <button
          type="button"
          data-testid="world-create-chip-editor"
          onClick={props.onSendToEditor}
          disabled={props.editorBusy}
          className={goldChipCls}
        >
          <Scissors className="h-3.5 w-3.5" /> Send to the editor
        </button>
      ) : null}
      {props.published ? (
        <span
          data-testid="world-create-chip-published"
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold ${
            isLight ? "border-emerald-700/40 text-emerald-800" : "border-emerald-400/40 text-emerald-300"
          }`}
        >
          <BadgeCheck className="h-3.5 w-3.5" /> Published — live on your profile
        </span>
      ) : props.onPublish ? (
        <button
          type="button"
          data-testid="world-create-chip-publish"
          onClick={props.onPublish}
          disabled={props.publishBusy}
          className={goldChipCls}
        >
          <Rocket className="h-3.5 w-3.5" /> {props.publishBusy ? "Publishing…" : "Publish to my profile"}
        </button>
      ) : null}
      {jukeboxChip === "live" && trackId ? (
        <button
          type="button"
          data-testid="world-create-chip-jukebox"
          onClick={() => props.onJukeboxAdd?.(trackId)}
          className={chipCls}
        >
          <ListMusic className="h-3.5 w-3.5" /> Put it on the jukebox
        </button>
      ) : jukeboxChip === "dark" ? (
        /* The dark chip (stack-20 round 2, #4): the desk offers the
           jukebox rail but this result carries no published track
           yet, so the chip shows its face with the reason on it —
           a span, not a button: it takes no click, so it can never
           be a dead one. It lights into the live chip above the
           moment the publish response's id passes the gate. */
        <span
          data-testid="world-create-chip-jukebox-dark"
          aria-disabled="true"
          title="The jukebox only plays published tracks — publish this song first"
          className={`inline-flex cursor-not-allowed select-none items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold opacity-50 ${
            isLight ? "border-[#7A5A12]/30 text-[#6B5B36]" : "border-white/15 text-white/75"
          }`}
        >
          <ListMusic className="h-3.5 w-3.5" /> Put it on the jukebox · publish first
        </span>
      ) : null}
      {props.schedulePrefill ? (
        <button
          type="button"
          data-testid="world-create-chip-schedule"
          aria-expanded={schedulerOpen}
          onClick={() => setSchedulerOpen((v) => !v)}
          className={chipCls}
        >
          <Rocket className="h-3.5 w-3.5" /> Schedule it
        </button>
      ) : null}
      {props.releasePrefill ? (
        <button
          type="button"
          data-testid="world-create-chip-release"
          aria-expanded={releaseOpen}
          onClick={() => setReleaseOpen((v) => !v)}
          className={chipCls}
        >
          <Disc3 className="h-3.5 w-3.5" /> Release it
        </button>
      ) : null}
      {props.onSaveDraft ? (
        <button
          type="button"
          data-testid="world-create-chip-draft"
          onClick={props.onSaveDraft}
          disabled={props.draftSaved}
          className={chipCls}
        >
          <PenLine className="h-3.5 w-3.5" /> {props.draftSaved ? "Draft saved" : "Save as draft"}
        </button>
      ) : null}
      <button
        type="button"
        data-testid="world-create-chip-another"
        onClick={props.onMakeAnother}
        className={chipCls}
      >
        <Sparkles className="h-3.5 w-3.5" /> Make another
      </button>
      {schedulerOpen && props.schedulePrefill ? (
        <div className="w-full">
          <SchedulerComposeStandalone isLight={isLight} prefill={props.schedulePrefill} />
        </div>
      ) : null}
      {releaseOpen && props.releasePrefill ? (
        <div className="w-full">
          <ReleaseDeskStandalone isLight={isLight} prefill={props.releasePrefill} />
        </div>
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
          ? "Making the audio…"
          : props.state === "failed"
            ? props.includedInTotal !== undefined
              ? "Make the audio again"
              : `Make the audio again · ${props.costVisualBucs.toLocaleString("en-US")} Visual Bucs`
            : props.includedInTotal !== undefined
              ? "Make the audio"
              : `Make the audio · ${props.costVisualBucs.toLocaleString("en-US")} Visual Bucs`}
      </button>
      {props.state === "failed" && props.error ? (
        <p data-testid="world-create-audio-error" className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
          {props.error}
        </p>
      ) : props.includedInTotal !== undefined ? (
        <p className={`text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
          Covered by the {props.includedInTotal.toLocaleString("en-US")} Visual Bucs you confirmed for this song —
          this leg charges its share only when the audio lands, never twice. The song saves to your library, ready to publish.
        </p>
      ) : (
        <p className={`text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
          The package becomes a real, playable song — saved to your library, ready to publish.
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
        Unlocked — &ldquo;{props.title}&rdquo; is live on your profile
      </p>
      <p className={`mt-1 text-[11px] leading-relaxed ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
        {props.jukeboxSent
          ? "Sent to the jukebox — walk into the Music Hall and the whole room hears your song."
          : "The win screen is the room hearing it: tap \u201CPut it on the jukebox\u201D above and your song rides the Music Hall jukebox."}
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

import {
  questAdvancesBetween,
  questChipLine,
  questsOfResponse,
  type QuestProgress,
} from "@/lib/world/create-desks";
import { Target } from "lucide-react";
import { peaksFromChannelData } from "@/lib/world/audio-benches";
import {
  abAvailability,
  abResumePosition,
  abSettledSide,
  abSideAfterFlip,
  type ABSide,
} from "@/lib/world/audio-ab";

export function useQuestProgressChip() {
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
      if (advances.length > 0) setLines(advances.map(questChipLine));
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
  if (!peaks) {
    return (
      <div className="flex h-14 items-center justify-center text-[11px] opacity-60">
        Waveform unavailable — the audio still plays.
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
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Before and after">
        <button type="button" role="tab" aria-selected={shownSide === "before"} data-testid="world-audio-ab-before" onClick={() => flip("before")} disabled={!beforeUrl} className={tabCls(shownSide === "before")}>
          Before — {props.beforeLabel}
        </button>
        <button type="button" role="tab" aria-selected={shownSide === "after"} data-testid="world-audio-ab-after" onClick={() => flip("after")} className={tabCls(shownSide === "after")}>
          After — {props.afterLabel}
        </button>
      </div>
      {!availability.before && (
        <p data-testid="world-audio-ab-before-gone" className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
          The original isn&rsquo;t at this desk anymore — only the {props.afterLabel} version can play, so there&rsquo;s nothing to compare against.
        </p>
      )}
      <WaveformBars peaks={shownSide === "before" ? beforePeaks : afterPeaks} active />
      <audio ref={audioRef} src={shownSide === "after" ? props.afterUrl : (beforeUrl ?? undefined)} controls className="w-full" />
    </div>
  );
}
