import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  Upload, Loader2, Download, AlertTriangle, CheckCircle2,
  ArrowLeft, AudioWaveform, AudioLines, Info, RefreshCw,
  Play, Pause, FileAudio, X, SlidersHorizontal, Gauge, Disc3,
} from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { OutOfCredits } from "@/components/OutOfCredits";

/* ─── AI Mix & Master ───────────────────────────────────────────────────
   The flagship audio service: upload a finished mix and get back a
   radio-ready master (AI Master), or upload up to 12 stems and get a
   full genre-aware mixdown + master (AI Mix).

   Real DSP on the server (ffmpeg): per-stem gain staging / EQ /
   compression / panning → amix bus → subsonic cleanup → glue
   compression → genre sweetening EQ → stereo widening → two-pass
   EBU R128 loudness normalization with true-peak limiting.
   8 credits per master, 15 per stem mix — refunded if the job fails.
   Server-owned background jobs: safe to close the tab while it runs.
   Honest copy: this polishes and assembles — it can't fix a bad
   recording, out-of-tune vocals, or clipping stems. */

const MASTER_CREDIT_COST = 8;
const MIX_CREDIT_COST = 15;
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MAX_STEMS = 12;
const AUDIO_ACCEPT = "audio/*,.wav,.mp3,.aiff,.aif,.flac,.m4a,.ogg";

type GenreKey = "hip-hop" | "pop" | "rnb" | "edm" | "rock" | "lofi" | "afrobeat" | "gospel";
type IntensityKey = "subtle" | "balanced" | "aggressive";
type LoudnessKey = "streaming" | "club" | "radio";
type StemType = "vocals" | "drums" | "bass" | "keys" | "guitar" | "strings" | "fx" | "beat" | "other";
type JobStatus = "idle" | "uploading" | "queued" | "processing" | "done" | "failed";

const GENRES: Array<{ key: GenreKey; label: string; blurb: string }> = [
  { key: "hip-hop", label: "Hip-Hop", blurb: "Heavy low end, forward vocals." },
  { key: "pop", label: "Pop", blurb: "Polished, bright, radio sheen." },
  { key: "rnb", label: "R&B", blurb: "Smooth, warm, silky vocals." },
  { key: "edm", label: "EDM", blurb: "Maximum energy, huge and wide." },
  { key: "rock", label: "Rock", blurb: "Gritty guitars, drums up front." },
  { key: "lofi", label: "Lo-Fi", blurb: "Dusty, warm, mellow." },
  { key: "afrobeat", label: "Afrobeat", blurb: "Bouncy percussion, log drums." },
  { key: "gospel", label: "Gospel", blurb: "Big, uplifting choir clarity." },
];

const INTENSITIES: Array<{ key: IntensityKey; label: string; blurb: string }> = [
  { key: "subtle", label: "Subtle", blurb: "Gentle polish, dynamics intact." },
  { key: "balanced", label: "Balanced", blurb: "The sweet spot for most tracks." },
  { key: "aggressive", label: "Aggressive", blurb: "Loud, punchy, in-your-face." },
];

const LOUDNESS: Array<{ key: LoudnessKey; label: string; blurb: string; spec: string }> = [
  { key: "streaming", label: "Streaming", blurb: "Spotify / Apple Music ready.", spec: "-14 LUFS · -1.0 dBTP" },
  { key: "club", label: "Club", blurb: "Loud and punchy for big systems.", spec: "-9 LUFS · -1.0 dBTP" },
  { key: "radio", label: "Radio", blurb: "Broadcast-friendly consistency.", spec: "-11 LUFS · -1.0 dBTP" },
];

const STEM_TYPE_META: Record<StemType, { label: string; chip: string }> = {
  vocals: { label: "Vocals", chip: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30" },
  drums: { label: "Drums", chip: "bg-red-500/15 text-red-300 border-red-500/30" },
  bass: { label: "Bass", chip: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  keys: { label: "Keys", chip: "bg-sky-500/15 text-sky-300 border-sky-500/30" },
  guitar: { label: "Guitar", chip: "bg-orange-500/15 text-orange-300 border-orange-500/30" },
  strings: { label: "Strings", chip: "bg-violet-500/15 text-violet-300 border-violet-500/30" },
  fx: { label: "FX", chip: "bg-teal-500/15 text-teal-300 border-teal-500/30" },
  beat: { label: "Beat", chip: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  other: { label: "Stem", chip: "bg-white/10 text-white/60 border-white/20" },
};

/** Client-side mirror of the server's filename → stem-type detection (instant UI feedback). */
function detectStemTypeClient(filename: string): StemType {
  const name = (filename || "").toLowerCase();
  const patterns: Array<[StemType, RegExp]> = [
    ["vocals", /(voc|vox|vocal|acapella|a cappella|lead|hook|chorus|verse|adlib|ad-lib|bgv|choir)/],
    ["drums", /(drum|perc|kick|snare|hat|clap|tom|cymbal|shaker|conga|bongo|djembe)/],
    ["bass", /(bass|808|sub|lowend|low[ -]?end)/],
    ["keys", /(key|piano|synth|pad|arp|organ|rhodes|epiano|midi|pluck|bell)/],
    ["guitar", /(guit|gtr|strum|acoustic|electric)/],
    ["strings", /(string|violin|viola|cello|orchestra|ensemble)/],
    ["fx", /(fx|sfx|riser|sweep|impact|transition|earcandy|ear candy|texture|ambien)/],
    ["beat", /(beat|instrumental|backing|track|music|playback|karaoke)/],
  ];
  for (const [type, re] of patterns) if (re.test(name)) return type;
  return "other";
}

interface MasterReport {
  inputLufs: number | null;
  inputTruePeak: number | null;
  inputLra: number | null;
  targetLufs: number | null;
  targetTruePeak: number | null;
  referenceLufs: number | null;
  outputLufs: number | null;
  outputTruePeak: number | null;
}

interface JobResponse {
  jobId?: string;
  status?: string;
  kind?: string;
  genre?: string;
  stemTypes?: StemType[];
  stats?: MasterReport;
  wavUrl?: string | null;
  mp3Url?: string | null;
  error?: string;
  message?: string;
  creditsRemaining?: number;
  creditsCharged?: number;
}

function fmtLufs(v: number | null | undefined): string {
  return typeof v === "number" && Number.isFinite(v) ? `${v.toFixed(1)} LUFS` : "—";
}
function fmtDb(v: number | null | undefined, suffix = "dBTP"): string {
  return typeof v === "number" && Number.isFinite(v) ? `${v.toFixed(1)} ${suffix}` : "—";
}
function isAudioFile(f: File): boolean {
  return f.type.startsWith("audio/") || /\.(wav|mp3|aiff|aif|flac|m4a|ogg)$/i.test(f.name);
}

/* ── Shared pickers ─────────────────────────────────────────────────── */

function GenreGrid({ value, onChange }: { value: GenreKey; onChange: (g: GenreKey) => void }) {
  return (
    <div>
      <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-2">Genre sound</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {GENRES.map((g) => (
          <button
            key={g.key}
            type="button"
            onClick={() => onChange(g.key)}
            className={`rounded-xl border px-3 py-2.5 text-left transition ${
              value === g.key
                ? "border-[#C9A84C]/60 bg-[#C9A84C]/10"
                : "border-white/[0.08] bg-white/[0.02] hover:border-white/20"
            }`}
          >
            <p className={`font-bold text-sm ${value === g.key ? "text-[#f7dd7f]" : "text-white/80"}`}>{g.label}</p>
            <p className="text-[11px] text-white/40 mt-0.5 leading-snug">{g.blurb}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

function IntensityPicker({ value, onChange }: { value: IntensityKey; onChange: (v: IntensityKey) => void }) {
  return (
    <div>
      <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-2">Processing intensity</p>
      <div className="grid grid-cols-3 gap-2.5">
        {INTENSITIES.map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            className={`rounded-xl border px-3 py-2.5 text-left transition ${
              value === opt.key
                ? "border-[#C9A84C]/60 bg-[#C9A84C]/10"
                : "border-white/[0.08] bg-white/[0.02] hover:border-white/20"
            }`}
          >
            <p className={`font-bold text-sm ${value === opt.key ? "text-[#f7dd7f]" : "text-white/80"}`}>{opt.label}</p>
            <p className="text-[11px] text-white/40 mt-0.5 leading-snug">{opt.blurb}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

function LoudnessPicker({ value, onChange }: { value: LoudnessKey; onChange: (v: LoudnessKey) => void }) {
  return (
    <div>
      <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-2">Target loudness</p>
      <div className="grid grid-cols-3 gap-2.5">
        {LOUDNESS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            className={`rounded-xl border px-3 py-2.5 text-left transition ${
              value === t.key
                ? "border-[#C9A84C]/60 bg-[#C9A84C]/10"
                : "border-white/[0.08] bg-white/[0.02] hover:border-white/20"
            }`}
          >
            <p className={`font-bold text-sm ${value === t.key ? "text-[#f7dd7f]" : "text-white/80"}`}>{t.label}</p>
            <p className="text-[11px] text-white/40 mt-0.5 leading-snug">{t.blurb}</p>
            <p className="text-[10px] text-white/30 mt-1 font-mono">{t.spec}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

function ReferenceUpload({
  file, onPick, onClear,
}: { file: File | null; onPick: (f: File) => void; onClear: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div>
      <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-2">
        Reference track <span className="text-white/25 normal-case font-medium">(optional — match its loudness)</span>
      </p>
      {file ? (
        <div className="flex items-center justify-between rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-2.5">
          <span className="text-sm text-white/70 truncate">{file.name}</span>
          <button type="button" onClick={onClear} className="text-white/40 hover:text-white/80 transition shrink-0 ml-3">
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => ref.current?.click()}
          className="w-full rounded-xl border border-dashed border-white/[0.12] px-4 py-3 text-sm text-white/40 hover:text-white/70 hover:border-white/25 transition"
        >
          <Disc3 className="h-4 w-4 inline mr-2 -mt-0.5" />
          Add a reference track — we'll match its loudness
        </button>
      )}
      <input
        ref={ref}
        type="file"
        accept={AUDIO_ACCEPT}
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f && isAudioFile(f)) onPick(f); e.target.value = ""; }}
      />
    </div>
  );
}

/* ── Shared result: loudness-matched A/B player + Master Report ────── */

function JobResult({
  data, beforeUrl, kindLabel, onReset,
}: {
  data: JobResponse;
  beforeUrl: string | null;
  kindLabel: string;
  onReset: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [abSide, setAbSide] = useState<"before" | "after">("after");
  const [playing, setPlaying] = useState(false);
  const [loudnessMatch, setLoudnessMatch] = useState(true);
  const stats = data.stats ?? null;
  const mp3Url = data.mp3Url ?? null;
  const wavUrl = data.wavUrl ?? null;

  /* Loudness-matched A/B: attenuate the louder side via the volume
     property so the comparison is about tone, not level. Real, no Web Audio. */
  const inputLufs = stats?.inputLufs;
  const outputLufs = stats?.outputLufs;
  const gainBefore = typeof inputLufs === "number" && typeof outputLufs === "number"
    ? Math.min(1, Math.pow(10, (outputLufs - inputLufs) / 20)) : 1;
  const gainAfter = typeof inputLufs === "number" && typeof outputLufs === "number"
    ? Math.min(1, Math.pow(10, (inputLufs - outputLufs) / 20)) : 1;

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.volume = !loudnessMatch ? 1 : abSide === "before" ? gainBefore : gainAfter;
  }, [abSide, loudnessMatch, gainBefore, gainAfter]);

  function flipSide(side: "before" | "after") {
    const el = audioRef.current;
    const t = el ? el.currentTime : 0;
    const wasPlaying = playing;
    setAbSide(side);
    requestAnimationFrame(() => {
      const next = audioRef.current;
      if (!next) return;
      next.currentTime = t;
      if (wasPlaying) void next.play().catch(() => {});
    });
  }

  const activeSrc = abSide === "before" ? beforeUrl : mp3Url;

  return (
    <div className="mt-6 space-y-5">
      <div className="flex items-center gap-2.5 rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-4 py-3">
        <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
        <p className="text-sm text-emerald-200/80">{kindLabel} complete — compare it against the original below.</p>
      </div>

      {/* A/B player */}
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <p className="text-xs font-bold text-white/40 uppercase tracking-wider">Before / After</p>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-[11px] text-white/45 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={loudnessMatch}
                onChange={(e) => setLoudnessMatch(e.target.checked)}
                className="accent-[#C9A84C] h-3.5 w-3.5"
              />
              Loudness-matched
            </label>
            <div className="flex rounded-lg border border-white/[0.1] overflow-hidden">
              <button
                type="button"
                onClick={() => flipSide("before")}
                disabled={!beforeUrl}
                className={`px-4 py-1.5 text-xs font-bold transition disabled:opacity-30 ${
                  abSide === "before" ? "bg-white/[0.12] text-white" : "text-white/40 hover:text-white/70"
                }`}
              >
                Before
              </button>
              <button
                type="button"
                onClick={() => flipSide("after")}
                disabled={!mp3Url}
                className={`px-4 py-1.5 text-xs font-bold transition disabled:opacity-30 ${
                  abSide === "after" ? "bg-[#C9A84C]/25 text-[#f7dd7f]" : "text-white/40 hover:text-white/70"
                }`}
              >
                After
              </button>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              const el = audioRef.current;
              if (!el) return;
              if (playing) el.pause();
              else void el.play().catch(() => {});
            }}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#f7dd7f] to-[#C9A84C] text-black hover:brightness-110 transition"
          >
            {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}
          </button>
          <audio
            ref={audioRef}
            src={activeSrc ?? undefined}
            className="w-full accent-[#C9A84C]"
            controls
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
          />
        </div>
        <p className="text-[11px] text-white/30 mt-2">
          Listening to: <span className="text-white/60 font-semibold">{abSide === "before" ? "your original" : "the processed version"}</span>
          {loudnessMatch && inputLufs != null && outputLufs != null && (
            <> — level-matched ({abSide === "before" ? `before at ${(20 * Math.log10(gainBefore)).toFixed(1)} dB` : `after at ${(20 * Math.log10(gainAfter)).toFixed(1)} dB`}) so you're judging tone, not volume</>
          )}
          {!loudnessMatch && <> — raw levels (the master is supposed to be louder)</>}.
          Position is preserved when you flip.
        </p>
      </div>

      {/* Master Report */}
      {stats && (
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
          <div className="flex items-center gap-2 mb-3">
            <Gauge className="h-3.5 w-3.5 text-[#C9A84C]" />
            <p className="text-xs font-bold text-white/40 uppercase tracking-wider">Master report</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Input loudness", value: fmtLufs(stats.inputLufs) },
              { label: "Output loudness", value: fmtLufs(stats.outputLufs ?? stats.targetLufs) },
              { label: "True peak in", value: fmtDb(stats.inputTruePeak) },
              { label: "True peak out", value: fmtDb(stats.outputTruePeak ?? stats.targetTruePeak) },
            ].map((s) => (
              <div key={s.label} className="rounded-xl bg-black/40 border border-white/[0.06] px-3 py-2.5">
                <p className="text-[10px] text-white/35 uppercase tracking-wider">{s.label}</p>
                <p className="text-sm font-black text-[#f7dd7f] mt-1 font-mono">{s.value}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 mt-3">
            {typeof stats.inputLra === "number" && (
              <p className="text-[11px] text-white/30">
                Dynamic range: <span className="text-white/55 font-mono">{stats.inputLra.toFixed(1)} LU</span>
              </p>
            )}
            {typeof stats.referenceLufs === "number" && (
              <p className="text-[11px] text-white/30">
                Reference loudness: <span className="text-white/55 font-mono">{fmtLufs(stats.referenceLufs)}</span> <span className="text-white/25">(used as target)</span>
              </p>
            )}
            {data.genre && (
              <p className="text-[11px] text-white/30">
                Chain: <span className="text-white/55 capitalize">{data.genre.replace("-", " ")}</span>
              </p>
            )}
          </div>
        </div>
      )}

      {/* Stem readout for mixes */}
      {data.stemTypes && data.stemTypes.length > 0 && (
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
          <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-3">
            Stems detected — {data.stemTypes.length}
          </p>
          <div className="flex flex-wrap gap-2">
            {data.stemTypes.map((t, i) => (
              <span
                key={i}
                className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-bold ${STEM_TYPE_META[t]?.chip ?? STEM_TYPE_META.other.chip}`}
              >
                {STEM_TYPE_META[t]?.label ?? t}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Downloads */}
      <div className="grid grid-cols-2 gap-3">
        <a
          href={wavUrl ?? undefined}
          download
          className={`flex items-center justify-center gap-2 rounded-xl border border-[#C9A84C]/40 bg-[#C9A84C]/10 py-3 font-bold text-sm text-[#f7dd7f] hover:bg-[#C9A84C]/20 transition ${!wavUrl ? "pointer-events-none opacity-30" : ""}`}
        >
          <Download className="h-4 w-4" /> WAV (24-bit)
        </a>
        <a
          href={mp3Url ?? undefined}
          download
          className={`flex items-center justify-center gap-2 rounded-xl border border-white/[0.12] bg-white/[0.04] py-3 font-bold text-sm text-white/80 hover:bg-white/[0.08] transition ${!mp3Url ? "pointer-events-none opacity-30" : ""}`}
        >
          <Download className="h-4 w-4" /> MP3 (320k)
        </a>
      </div>

      <button
        type="button"
        onClick={onReset}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/[0.1] py-3 text-sm font-bold text-white/50 hover:text-white/80 hover:bg-white/[0.04] transition"
      >
        <RefreshCw className="h-4 w-4" /> Start another
      </button>
    </div>
  );
}

/* ── AI Master panel ──────────────────────────────────────────────── */

function MasterPanel() {
  const { user } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const [file, setFile] = useState<File | null>(null);
  const [beforeUrl, setBeforeUrl] = useState<string | null>(null);
  const [reference, setReference] = useState<File | null>(null);
  const [genre, setGenre] = useState<GenreKey>("hip-hop");
  const [intensity, setIntensity] = useState<IntensityKey>("balanced");
  const [loudness, setLoudness] = useState<LoudnessKey>("streaming");
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<JobStatus>("idle");
  const [result, setResult] = useState<JobResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null);
  const pollRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!jobId || (status !== "queued" && status !== "processing")) return;
    pollRef.current = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/mix-master/job/${jobId}`);
        const data: JobResponse = await res.json();
        if (!res.ok) return;
        if (data.status === "done") {
          if (pollRef.current) window.clearInterval(pollRef.current);
          setResult(data);
          setStatus("done");
        } else if (data.status === "failed") {
          if (pollRef.current) window.clearInterval(pollRef.current);
          setStatus("failed");
          setError(data.error || "Mastering failed — your credits were refunded.");
        }
      } catch { /* keep polling */ }
    }, 3000);
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
  }, [jobId, status]);

  function pickFile(f: File | undefined) {
    if (!f) return;
    if (!isAudioFile(f)) { setError("Please choose an audio file (WAV, MP3, AIFF, FLAC, M4A, OGG)."); return; }
    if (f.size > MAX_FILE_BYTES) { setError("That file is over 100 MB — please use a smaller mix."); return; }
    if (beforeUrl) URL.revokeObjectURL(beforeUrl);
    setBeforeUrl(URL.createObjectURL(f));
    setFile(f);
    setError(null);
    setResult(null);
    setJobId(null);
    setStatus("idle");
  }

  async function start() {
    if (!file || !user) return;
    setStatus("uploading");
    setError(null);
    setOutOfCredits(false);
    try {
      const form = new FormData();
      form.append("audio", file);
      form.append("genre", genre);
      form.append("intensity", intensity);
      form.append("loudness", loudness);
      if (reference) form.append("reference", reference);
      const res = await confirmedFetch("/api/mix-master/master", { method: "POST", body: form });
      if (!res) { setStatus("idle"); return; }
      const data: JobResponse = await res.json();
      if (res.status === 402) { setOutOfCredits(true); setStatus("idle"); return; }
      if (!res.ok || !data.jobId) {
        setStatus("failed");
        setError(data.message || data.error || "Could not start mastering.");
        return;
      }
      setJobId(data.jobId);
      setStatus("queued");
      if (typeof data.creditsRemaining === "number") setCreditsRemaining(data.creditsRemaining);
    } catch {
      setStatus("failed");
      setError("Network error — please try again.");
    }
  }

  function reset() {
    if (beforeUrl) URL.revokeObjectURL(beforeUrl);
    setFile(null); setBeforeUrl(null); setReference(null);
    setJobId(null); setStatus("idle"); setResult(null);
    setError(null); setOutOfCredits(false);
  }

  const busy = status === "uploading" || status === "queued" || status === "processing";

  return (
    <div>
      {outOfCredits && <div className="mt-4"><OutOfCredits /></div>}
      {error && (
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-red-500/25 bg-red-500/5 px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
          <p className="text-sm text-red-200/80">{error}</p>
        </div>
      )}

      {(status === "idle" || status === "failed") && !busy && !result && (
        <div className="mt-6 space-y-5">
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); pickFile(e.dataTransfer.files?.[0]); }}
            className={`cursor-pointer rounded-2xl border-2 border-dashed px-6 py-10 text-center transition ${
              dragOver ? "border-[#C9A84C]/60 bg-[#C9A84C]/5" : "border-white/[0.12] hover:border-white/25"
            }`}
          >
            <Upload className="h-8 w-8 text-white/30 mx-auto mb-3" />
            {file ? (
              <div>
                <p className="font-semibold text-white">{file.name}</p>
                <p className="text-xs text-white/40 mt-1">{(file.size / 1024 / 1024).toFixed(1)} MB — click to change</p>
              </div>
            ) : (
              <div>
                <p className="font-semibold text-white/70">Drop your finished mix here, or click to browse</p>
                <p className="text-xs text-white/35 mt-1">WAV, MP3, AIFF, FLAC, M4A, OGG — up to 100 MB</p>
              </div>
            )}
            <input ref={fileInputRef} type="file" accept={AUDIO_ACCEPT} className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0])} />
          </div>

          <GenreGrid value={genre} onChange={setGenre} />
          <IntensityPicker value={intensity} onChange={setIntensity} />
          <LoudnessPicker value={loudness} onChange={setLoudness} />
          <ReferenceUpload file={reference} onPick={setReference} onClear={() => setReference(null)} />

          <button
            type="button"
            onClick={start}
            disabled={!file || !user}
            className="w-full rounded-xl bg-gradient-to-br from-[#f7dd7f] to-[#C9A84C] py-3.5 font-black text-black hover:brightness-110 active:scale-[0.99] transition disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {!user ? "Sign in to master" : `Master my track — ${MASTER_CREDIT_COST} credits`}
          </button>
          {typeof creditsRemaining === "number" && (
            <p className="text-center text-xs text-white/35">{creditsRemaining} credits remaining</p>
          )}
        </div>
      )}

      {busy && (
        <div className="mt-6 rounded-2xl border border-white/[0.08] bg-white/[0.02] px-6 py-10 text-center">
          <Loader2 className="h-8 w-8 text-[#C9A84C] mx-auto mb-4 animate-spin" />
          <p className="font-bold text-white">
            {status === "uploading" ? "Uploading your mix…" : status === "queued" ? "Queued — warming up the chain…" : "Mastering in progress…"}
          </p>
          <p className="text-xs text-white/40 mt-2">
            Analyzing loudness → genre chain → two-pass normalization → WAV + MP3. Safe to close this tab — the job runs on the server.
          </p>
        </div>
      )}

      {status === "done" && result && (
        <JobResult data={result} beforeUrl={beforeUrl} kindLabel="Master" onReset={reset} />
      )}
    </div>
  );
}

/* ── AI Mix (stems) panel ─────────────────────────────────────────── */

function MixPanel() {
  const { user } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const [stems, setStems] = useState<File[]>([]);
  const [reference, setReference] = useState<File | null>(null);
  const [genre, setGenre] = useState<GenreKey>("hip-hop");
  const [intensity, setIntensity] = useState<IntensityKey>("balanced");
  const [loudness, setLoudness] = useState<LoudnessKey>("streaming");
  const [vocalDb, setVocalDb] = useState(0);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<JobStatus>("idle");
  const [result, setResult] = useState<JobResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null);
  const pollRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!jobId || (status !== "queued" && status !== "processing")) return;
    pollRef.current = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/mix-master/job/${jobId}`);
        const data: JobResponse = await res.json();
        if (!res.ok) return;
        if (data.status === "done") {
          if (pollRef.current) window.clearInterval(pollRef.current);
          setResult(data);
          setStatus("done");
        } else if (data.status === "failed") {
          if (pollRef.current) window.clearInterval(pollRef.current);
          setStatus("failed");
          setError(data.error || "Mixing failed — your credits were refunded.");
        }
      } catch { /* keep polling */ }
    }, 3000);
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
  }, [jobId, status]);

  function addFiles(list: FileList | File[] | undefined) {
    if (!list) return;
    const incoming = Array.from(list).filter(isAudioFile);
    if (incoming.length === 0) { setError("Those files aren't audio — use WAV, MP3, AIFF, FLAC, M4A or OGG."); return; }
    setStems((prev) => {
      const merged = [...prev, ...incoming].slice(0, MAX_STEMS);
      return merged;
    });
    setError(null);
    setResult(null);
    setJobId(null);
    setStatus("idle");
  }

  function removeStem(idx: number) {
    setStems((prev) => prev.filter((_, i) => i !== idx));
  }

  async function start() {
    if (stems.length === 0 || !user) return;
    setStatus("uploading");
    setError(null);
    setOutOfCredits(false);
    try {
      const form = new FormData();
      for (const s of stems) form.append("stems", s);
      form.append("genre", genre);
      form.append("intensity", intensity);
      form.append("loudness", loudness);
      form.append("vocalLevelDb", String(vocalDb));
      if (reference) form.append("reference", reference);
      const res = await confirmedFetch("/api/mix-master/mix", { method: "POST", body: form });
      if (!res) { setStatus("idle"); return; }
      const data: JobResponse = await res.json();
      if (res.status === 402) { setOutOfCredits(true); setStatus("idle"); return; }
      if (!res.ok || !data.jobId) {
        setStatus("failed");
        setError(data.message || data.error || "Could not start the mix.");
        return;
      }
      setJobId(data.jobId);
      setStatus("queued");
      if (typeof data.creditsRemaining === "number") setCreditsRemaining(data.creditsRemaining);
    } catch {
      setStatus("failed");
      setError("Network error — please try again.");
    }
  }

  function reset() {
    setStems([]); setReference(null);
    setJobId(null); setStatus("idle"); setResult(null);
    setError(null); setOutOfCredits(false);
  }

  const busy = status === "uploading" || status === "queued" || status === "processing";

  return (
    <div>
      {outOfCredits && <div className="mt-4"><OutOfCredits /></div>}
      {error && (
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-red-500/25 bg-red-500/5 px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
          <p className="text-sm text-red-200/80">{error}</p>
        </div>
      )}

      {(status === "idle" || status === "failed") && !busy && !result && (
        <div className="mt-6 space-y-5">
          <div>
            <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-2">
              Stems <span className="text-white/25 normal-case font-medium">({stems.length}/{MAX_STEMS})</span>
            </p>
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
              className={`cursor-pointer rounded-2xl border-2 border-dashed px-6 py-8 text-center transition ${
                dragOver ? "border-[#C9A84C]/60 bg-[#C9A84C]/5" : "border-white/[0.12] hover:border-white/25"
              }`}
            >
              <Upload className="h-7 w-7 text-white/30 mx-auto mb-2" />
              <p className="font-semibold text-white/70 text-sm">Drop your stems here, or click to browse</p>
              <p className="text-xs text-white/35 mt-1">Vocals, drums, bass, keys… up to {MAX_STEMS} files, 100 MB each</p>
              <input
                ref={fileInputRef}
                type="file"
                accept={AUDIO_ACCEPT}
                multiple
                className="hidden"
                onChange={(e) => { addFiles(e.target.files ?? undefined); e.target.value = ""; }}
              />
            </div>

            {stems.length > 0 && (
              <div className="mt-3 space-y-2">
                {stems.map((s, i) => {
                  const t = detectStemTypeClient(s.name);
                  const meta = STEM_TYPE_META[t];
                  return (
                    <div key={`${s.name}-${i}`} className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] px-3.5 py-2.5">
                      <FileAudio className="h-4 w-4 text-white/35 shrink-0" />
                      <span className="text-sm text-white/75 truncate flex-1">{s.name}</span>
                      <span className="text-[11px] text-white/30 font-mono shrink-0 hidden sm:block">
                        {(s.size / 1024 / 1024).toFixed(1)} MB
                      </span>
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold shrink-0 ${meta.chip}`}>
                        {meta.label}
                      </span>
                      <button type="button" onClick={() => removeStem(i)} className="text-white/35 hover:text-white/80 transition shrink-0">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
                <p className="text-[11px] text-white/30">
                  Stem types are auto-detected from filenames — the engine applies the right chain to each one.
                </p>
              </div>
            )}
          </div>

          <GenreGrid value={genre} onChange={setGenre} />
          <IntensityPicker value={intensity} onChange={setIntensity} />

          {/* Vocal level */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold text-white/40 uppercase tracking-wider">Vocal level</p>
              <span className="text-xs font-mono text-[#f7dd7f]">
                {vocalDb > 0 ? `+${vocalDb.toFixed(1)}` : vocalDb.toFixed(1)} dB
              </span>
            </div>
            <input
              type="range"
              min={-6}
              max={4}
              step={0.5}
              value={vocalDb}
              onChange={(e) => setVocalDb(Number(e.target.value))}
              className="w-full accent-[#C9A84C]"
            />
            <div className="flex justify-between text-[10px] text-white/30 mt-1">
              <span>Buried (-6 dB)</span>
              <span>Up front (+4 dB)</span>
            </div>
          </div>

          <LoudnessPicker value={loudness} onChange={setLoudness} />
          <ReferenceUpload file={reference} onPick={setReference} onClear={() => setReference(null)} />

          <button
            type="button"
            onClick={start}
            disabled={stems.length === 0 || !user}
            className="w-full rounded-xl bg-gradient-to-br from-[#f7dd7f] to-[#C9A84C] py-3.5 font-black text-black hover:brightness-110 active:scale-[0.99] transition disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {!user ? "Sign in to mix" : `Mix & master ${stems.length} stem${stems.length === 1 ? "" : "s"} — ${MIX_CREDIT_COST} credits`}
          </button>
          {typeof creditsRemaining === "number" && (
            <p className="text-center text-xs text-white/35">{creditsRemaining} credits remaining</p>
          )}
        </div>
      )}

      {busy && (
        <div className="mt-6 rounded-2xl border border-white/[0.08] bg-white/[0.02] px-6 py-10 text-center">
          <Loader2 className="h-8 w-8 text-[#C9A84C] mx-auto mb-4 animate-spin" />
          <p className="font-bold text-white">
            {status === "uploading" ? `Uploading ${stems.length} stems…` : status === "queued" ? "Queued — staging your stems…" : "Mixing in progress…"}
          </p>
          <p className="text-xs text-white/40 mt-2">
            Detecting stems → gain staging → EQ → compression → panning → mixdown → master chain → WAV + MP3. Safe to close this tab.
          </p>
        </div>
      )}

      {status === "done" && result && (
        <JobResult data={result} beforeUrl={null} kindLabel="Mix & master" onReset={reset} />
      )}
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────────────── */

export default function MixMaster() {
  const [tab, setTab] = useState<"master" | "mix">("master");

  return (
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-white/40 hover:text-white/70 mb-6">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>

        <div className="flex items-center gap-3 mb-2">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#C9A84C]/15 text-[#f7dd7f]">
            <AudioLines className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-black">AI Mix &amp; Master</h1>
            <p className="text-sm text-white/45">Professional sound, no engineer required</p>
          </div>
        </div>

        {/* Honest framing */}
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
          <Info className="h-4 w-4 text-[#C9A84C]/70 shrink-0 mt-0.5" />
          <p className="text-xs text-white/55 leading-relaxed">
            A real DSP pipeline — per-stem gain staging, EQ, compression, genre panning,
            then a full mastering chain with true-peak limiting. It{" "}
            <span className="text-white/80 font-semibold">assembles and polishes great recordings; it can't fix clipping, out-of-tune vocals, or a bad arrangement.</span>{" "}
            Trust your ears on the loudness-matched A/B before you ship it.
          </p>
        </div>

        {/* Tabs */}
        <div className="mt-6 grid grid-cols-2 gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-1.5">
          <button
            type="button"
            onClick={() => setTab("master")}
            className={`flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold transition ${
              tab === "master"
                ? "bg-gradient-to-br from-[#f7dd7f] to-[#C9A84C] text-black"
                : "text-white/50 hover:text-white/80"
            }`}
          >
            <SlidersHorizontal className="h-4 w-4" />
            AI Master
            <span className={`text-[11px] font-black px-1.5 py-0.5 rounded ${tab === "master" ? "bg-black/20" : "bg-white/[0.08] text-white/50"}`}>
              {MASTER_CREDIT_COST} cr
            </span>
          </button>
          <button
            type="button"
            onClick={() => setTab("mix")}
            className={`flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold transition ${
              tab === "mix"
                ? "bg-gradient-to-br from-[#f7dd7f] to-[#C9A84C] text-black"
                : "text-white/50 hover:text-white/80"
            }`}
          >
            <AudioWaveform className="h-4 w-4" />
            AI Mix <span className="hidden sm:inline">· Stems</span>
            <span className={`text-[11px] font-black px-1.5 py-0.5 rounded ${tab === "mix" ? "bg-black/20" : "bg-white/[0.08] text-white/50"}`}>
              {MIX_CREDIT_COST} cr
            </span>
          </button>
        </div>

        <p className="text-xs text-white/35 mt-3 leading-relaxed">
          {tab === "master"
            ? "Upload one finished stereo mix — choose a genre sound, intensity and loudness target, get back a release-ready master."
            : "Upload up to 12 stems — the engine detects each one, balances levels, EQs, compresses, pans and masters the full mixdown."}
        </p>

        {tab === "master" ? <MasterPanel /> : <MixPanel />}
      </main>
      <SiteFooter />
    </div>
  );
}
