import { apiErrorMessage } from "../../../lib/api-error";
import { useState } from "react";
import { Clapperboard, Clock, Loader2, Scissors, Sparkles, TrendingUp } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useHubProject } from "@/lib/hub-project";
import { AdvancedExpander, DeskSelectField, DeskTextField, deskInputCls } from "./CreateDeskLeaf";
import type { CreateDeskProps } from "./CreateDesks";
import {
  MOVIES_CLIP_CATEGORIES,
  MOVIES_FORMAT_LABELS,
  MOVIES_FORMATS,
  buildClipDetectPayload,
  buildConceptHubAsset,
  buildConceptPayload,
  conceptOfResponse,
  detectionOfResponse,
  moviesDeskInputReady,
  moviesDeskModeCost,
  moviesDeskModeFeature,
  moviesDeskModePath,
  pushMoviesHistory,
  type MoviesConcept,
  type MoviesDetection,
  type MoviesDeskMode,
  type MoviesFormat,
  type MoviesHistoryEntry,
} from "@/lib/world/movies-desk";

/* ─── The Movies Desk (stack1400 world parity wave #2, item 4) ─────
   Movies & Web Series, native in the Create Wing: the 2D /movies
   page's two tools on their own rails —
     Concept Generator   POST /api/movies/concept     400 VB
     Stream Clip Detector POST /api/movies/clip-detect 300 VB
   Every run rides confirmedFetch with the cost passed as an
   explicit override (the movies endpoints have no credit-costs
   registry row — the page does exactly the same), the price is
   printed on the desk before the run, a failed generation is
   refunded server-side, and a 402 reads as out-of-Visual-Bucs.
   A landed concept performs the page's own durable step — it
   flows into the hub project as a script asset. The movies rails
   persist nothing else (no saved-projects endpoint exists on
   either surface), so the desk's other keepsake is a session-only
   history strip, labelled as such. Results render IN the panel —
   nothing here ejects to the website. Members only, exactly the
   2D boundary: the station is membersOnly and both routes are
   requireAuth. */

const MODES: ReadonlyArray<{ key: MoviesDeskMode; label: string; icon: LucideIcon }> = [
  { key: "concept", label: "Concept Generator", icon: Sparkles },
  { key: "clips", label: "Stream Clip Detector", icon: Scissors },
];

const RUN_LABEL: Record<MoviesDeskMode, string> = {
  concept: "Develop the concept",
  clips: "Detect the highlights",
};

const EPISODE_COUNT_OPTIONS = Array.from({ length: 24 }, (_, i) => i + 1);
const STREAM_LENGTH_OPTIONS = [15, 30, 45, 60, 90, 120, 180, 240, 360, 480, 720, 1440];
const CLIP_COUNT_OPTIONS = Array.from({ length: 20 }, (_, i) => i + 1);

export function MoviesDesk(props: CreateDeskProps) {
  const { isLight } = props;
  const { refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const { addAsset } = useHubProject();
  const [mode, setMode] = useState<MoviesDeskMode>("concept");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  /* concept state */
  const [idea, setIdea] = useState("");
  const [format, setFormat] = useState<MoviesFormat>("web-series");
  const [genre, setGenre] = useState("");
  const [episodeCount, setEpisodeCount] = useState(8);
  const [concept, setConcept] = useState<MoviesConcept | null>(null);

  /* clip-detect state */
  const [streamUrl, setStreamUrl] = useState("");
  const [description, setDescription] = useState("");
  const [streamLengthMin, setStreamLengthMin] = useState(120);
  const [clipCount, setClipCount] = useState(8);
  const [detection, setDetection] = useState<MoviesDetection | null>(null);
  const [detectNote, setDetectNote] = useState("");

  const [history, setHistory] = useState<MoviesHistoryEntry[]>([]);

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const cost = moviesDeskModeCost(mode);
  const ready = moviesDeskInputReady(mode, { idea, description });
  const cardCls = isLight
    ? "border-[#C9A84C]/40 bg-white/50"
    : "border-white/10 bg-white/5";

  const switchMode = (next: MoviesDeskMode) => {
    setMode(next);
    setNote(null);
    setOutOfCredits(false);
  };

  const run = async () => {
    if (busy || !ready) return;
    setBusy(true);
    setNote(null);
    setOutOfCredits(false);
    try {
      const body =
        mode === "concept"
          ? buildConceptPayload({ idea, format, genre, episodeCount })
          : buildClipDetectPayload({ streamUrl, description, streamLengthMin, clipCount });
      const res = await confirmedFetch(moviesDeskModePath(mode), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        overrideCost: cost,
        overrideFeature: moviesDeskModeFeature(mode),
        body: JSON.stringify(body),
      });
      if (!res) return; // spend confirmation declined — nothing ran
      const data: unknown = await res.json().catch(() => ({}));
      if (res.status === 402 || (data as { error?: string }).error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok) {
        const d = data as { message?: string; error?: string };
        setNote(apiErrorMessage(d, "The studio hiccupped — a failed make is refunded. Try again."));
        return;
      }
      /* Shape-guard the answer: a body that drifts is a failed
         make (refunded server-side), never rows dressed as a win. */
      if (mode === "concept") {
        const parsed = conceptOfResponse(data);
        if (!parsed) {
          setNote("The concept came back empty — a failed make is refunded. Try again.");
          return;
        }
        setConcept(parsed);
        /* The page's durable landing: the concept flows into the
           hub project as a script asset — the script writer and
           the video tools pick it up from there. */
        try {
          addAsset(buildConceptHubAsset(parsed));
        } catch { /* hub unavailable — non-fatal, as on the page */ }
        setHistory((h) => pushMoviesHistory(h, { mode, label: parsed.title, concept: parsed }));
      } else {
        const parsed = detectionOfResponse(data);
        if (!parsed) {
          setNote("The highlights came back empty — a failed make is refunded. Try again.");
          return;
        }
        setDetection(parsed.detection);
        setDetectNote(parsed.note);
        setHistory((h) =>
          pushMoviesHistory(h, {
            mode,
            label: parsed.detection.clips[0]?.title ?? "Clip detection",
            detection: parsed.detection,
            note: parsed.note,
          }),
        );
      }
      refreshProfile();
    } catch {
      setNote("The studio hiccupped — a failed make is refunded. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const restoreHistory = (entry: MoviesHistoryEntry) => {
    switchMode(entry.mode);
    if (entry.mode === "concept" && entry.concept) setConcept(entry.concept);
    if (entry.mode === "clips" && entry.detection) {
      setDetection(entry.detection);
      setDetectNote(entry.note ?? "");
    }
  };

  const chipCls = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${
      active
        ? "border-[#d4af37] bg-[#d4af37] text-black"
        : isLight
          ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
          : "border-white/15 text-white/75 hover:text-white"
    }`;

  return (
    <div className="space-y-3" data-testid="world-create-movies-desk">
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Movies Desk tools">
        {MODES.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={mode === key}
            data-testid={`world-movies-desk-mode-${key}`}
            onClick={() => switchMode(key)}
            className={chipCls(mode === key)}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>

      {mode === "concept" && (
        <div className="space-y-3">
          <div>
            <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
              What are you making?
            </span>
            <div className="flex flex-wrap gap-1.5">
              {MOVIES_FORMATS.map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={format === f}
                  data-testid={`world-movies-desk-format-${f}`}
                  onClick={() => setFormat(f)}
                  className={chipCls(format === f)}
                >
                  {MOVIES_FORMAT_LABELS[f]}
                </button>
              ))}
            </div>
          </div>
          <label className="block">
            <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
              Describe your concept
            </span>
            <textarea
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              disabled={busy}
              rows={5}
              placeholder="Give me the raw idea — characters, world, the vibe. The messier the better."
              className={deskInputCls(isLight)}
            />
          </label>
          <p className={`text-xs ${muted}`}>
            {idea.trim().length} characters {idea.trim().length < 50 ? "(need 50+)" : "✓"}
          </p>
          <AdvancedExpander isLight={isLight}>
            <div className="grid gap-3 p-3 sm:grid-cols-2">
              <DeskTextField
                isLight={isLight}
                label="Genre (optional)"
                value={genre}
                onChange={setGenre}
                placeholder="e.g. sci-fi thriller, street drama, dark comedy…"
              />
              <DeskSelectField
                isLight={isLight}
                label="Episodes (series formats)"
                value={String(episodeCount)}
                onChange={(v) => setEpisodeCount(Number(v) || 8)}
                options={EPISODE_COUNT_OPTIONS.map((n) => ({ value: String(n), label: String(n) }))}
              />
            </div>
          </AdvancedExpander>
        </div>
      )}

      {mode === "clips" && (
        <div className="space-y-3">
          <DeskTextField
            isLight={isLight}
            label="Stream / VOD URL (optional)"
            value={streamUrl}
            onChange={setStreamUrl}
            placeholder="https://twitch.tv/videos/… or youtube.com/watch?v=…"
          />
          <label className="block">
            <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
              Describe the stream
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={busy}
              rows={5}
              placeholder="What happened? Big plays, funny fails, rage moments, wholesome bits — walk me through the stream."
              className={deskInputCls(isLight)}
            />
          </label>
          <p className={`text-xs ${muted}`}>
            {description.trim().length} characters {description.trim().length < 50 ? "(need 50+)" : "✓"}
          </p>
          <AdvancedExpander isLight={isLight}>
            <div className="grid gap-3 p-3 sm:grid-cols-2">
              <DeskSelectField
                isLight={isLight}
                label="Stream length"
                value={String(streamLengthMin)}
                onChange={(v) => setStreamLengthMin(Number(v) || 120)}
                options={STREAM_LENGTH_OPTIONS.map((n) => ({
                  value: String(n),
                  label: n >= 60 ? `${n / 60} hr${n === 60 ? "" : "s"}` : `${n} min`,
                }))}
              />
              <DeskSelectField
                isLight={isLight}
                label="Clips wanted"
                value={String(clipCount)}
                onChange={(v) => setClipCount(Number(v) || 8)}
                options={CLIP_COUNT_OPTIONS.map((n) => ({ value: String(n), label: String(n) }))}
              />
            </div>
          </AdvancedExpander>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <span data-testid="world-movies-desk-cost" className={`text-xs font-semibold ${muted}`}>
          Costs {cost.toLocaleString("en-US")} Visual Bucs — shown before anything runs.
        </span>
        <button
          type="button"
          data-testid="world-movies-desk-run"
          onClick={() => void run()}
          disabled={busy || !ready}
          className="ml-auto inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clapperboard className="h-4 w-4" />}
          {busy ? (mode === "concept" ? "Developing…" : "Finding your highlights…") : RUN_LABEL[mode]}
        </button>
      </div>
      {!ready && (
        <p className={`text-xs ${muted}`}>
          {mode === "concept"
            ? "Describe the concept first — at least 50 characters, like the website asks."
            : "Describe the stream first — at least 50 characters, like the website asks."}
        </p>
      )}
      {outOfCredits && (
        <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
          You&rsquo;re out of Visual Bucs — top up at the Visual Buc Packs desk in the Treasury and the Movies Desk is ready again.
        </p>
      )}
      {note && <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{note}</p>}
      {mode === "concept" && concept && (
        <div data-testid="world-movies-desk-result" className="space-y-3">
          <div className={`rounded-xl border px-3 py-2 ${cardCls}`}>
            <p className={`text-[11px] font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
              {MOVIES_FORMAT_LABELS[format]}
            </p>
            <p className={`text-lg font-black ${isLight ? "text-[#2a1e07]" : "text-white"}`}>{concept.title}</p>
            {concept.tagline && <p className={`text-sm italic ${muted}`}>&ldquo;{concept.tagline}&rdquo;</p>}
          </div>
          <div className={`rounded-xl border px-3 py-2 text-sm ${cardCls}`}>
            <p className="font-bold">Logline</p>
            <p className={muted}>{concept.logline}</p>
            {concept.synopsis && <p className={`mt-2 ${muted}`}>{concept.synopsis}</p>}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {concept.genre && <span className={chipCls(false)}>{concept.genre}</span>}
              {concept.targetAudience && <span className={chipCls(false)}>{concept.targetAudience}</span>}
            </div>
          </div>
          {concept.episodes.length > 0 && (
            <div className="space-y-2">
              <p className={`text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
                {format === "movie" ? "Three-Act Structure" : `Episode Breakdown (${concept.episodes.length})`}
              </p>
              {concept.episodes.map((ep) => (
                <div key={ep.number} className={`rounded-xl border px-3 py-2 text-sm ${cardCls}`}>
                  <p className="font-bold">{format === "movie" ? ep.title : `Ep ${ep.number} — ${ep.title}`}</p>
                  <p className={muted}>{ep.summary}</p>
                </div>
              ))}
            </div>
          )}
          {concept.characters.length > 0 && (
            <div className="space-y-2">
              <p className={`text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
                Character Bible
              </p>
              {concept.characters.map((c, i) => (
                <div key={`${c.name}-${i}`} className={`rounded-xl border px-3 py-2 text-sm ${cardCls}`}>
                  <p className="font-bold">
                    {c.name}
                    {c.role && <span className={`ml-2 text-[11px] font-black uppercase tracking-[0.12em] ${muted}`}>{c.role}</span>}
                  </p>
                  <p className={muted}>{c.description}</p>
                  {c.arc && <p className={`mt-1 text-xs italic ${muted}`}>Arc: {c.arc}</p>}
                </div>
              ))}
            </div>
          )}
          {concept.pilotHook && (
            <p className={`rounded-xl border px-3 py-2 text-sm ${cardCls}`}>
              <span className="font-bold">Pilot Hook: </span>
              <span className={muted}>{concept.pilotHook}</span>
            </p>
          )}
          {concept.comparables.length > 0 && (
            <p className={`text-xs ${muted}`}>
              <span className="font-black uppercase tracking-[0.12em]">Comparables: </span>
              {concept.comparables.join(" · ")}
            </p>
          )}
          <p className={`text-xs ${muted}`}>
            Saved to your hub project as a script asset — the script writer and the video tools pick it up from there.
          </p>
          <button
            type="button"
            onClick={() => { setConcept(null); setIdea(""); setGenre(""); }}
            className={chipCls(false)}
          >
            Develop another concept
          </button>
        </div>
      )}

      {mode === "clips" && detection && (
        <div data-testid="world-movies-desk-result" className="space-y-3">
          {detection.streamSummary && (
            <div className={`rounded-xl border px-3 py-2 text-sm ${cardCls}`}>
              <p className="font-bold">Stream Summary</p>
              <p className={muted}>{detection.streamSummary}</p>
            </div>
          )}
          <p className={`text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
            Clip-Worthy Moments ({detection.clips.length})
          </p>
          {detection.clips.map((clip, i) => (
            <div key={`${clip.title}-${i}`} className={`rounded-xl border px-3 py-2 text-sm ${cardCls}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="font-bold">{clip.title}</p>
                {clip.category && (
                  <span className={chipCls(false)}>
                    {(MOVIES_CLIP_CATEGORIES as readonly string[]).includes(clip.category)
                      ? clip.category.replace("-", " ")
                      : clip.category}
                  </span>
                )}
              </div>
              <div className={`mt-1 flex flex-wrap gap-3 text-xs ${muted}`}>
                {clip.timestamp && (
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" /> {clip.timestamp} · {clip.durationSec}s
                  </span>
                )}
                {clip.viralityScore > 0 && (
                  <span className="inline-flex items-center gap-1 font-bold">
                    <TrendingUp className="h-3.5 w-3.5" /> Virality {clip.viralityScore}/10
                  </span>
                )}
              </div>
              {clip.hook && <p className={`mt-1 italic ${muted}`}>Hook: &ldquo;{clip.hook}&rdquo;</p>}
              {clip.caption && <p className={`mt-1 text-xs ${muted}`}>{clip.caption}</p>}
            </div>
          ))}
          {detection.postingStrategy && (
            <div className={`rounded-xl border px-3 py-2 text-sm ${cardCls}`}>
              <p className="font-bold">Posting Strategy</p>
              <p className={muted}>{detection.postingStrategy}</p>
            </div>
          )}
          {detectNote && <p className={`text-center text-xs ${muted}`}>{detectNote}</p>}
          <button
            type="button"
            onClick={() => { setDetection(null); setDescription(""); setStreamUrl(""); }}
            className={chipCls(false)}
          >
            Analyze another stream
          </button>
        </div>
      )}

      {history.length > 0 && (
        <div>
          <p className={`mb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
            This session
          </p>
          <div className="flex flex-wrap gap-1.5">
            {history.map((entry, i) => (
              <button
                key={`${entry.mode}-${entry.label}-${i}`}
                type="button"
                onClick={() => restoreHistory(entry)}
                className={chipCls(mode === entry.mode)}
              >
                {entry.mode === "concept" ? "Concept" : "Clips"}: {entry.label || "make"}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
