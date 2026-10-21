import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Timer, Loader2, Sparkles, Trophy, Upload, X, Clapperboard } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useFileUpload } from "@/hooks/use-file-upload";
import { OutOfCredits } from "@/components/OutOfCredits";

/* ── 3-Second Lab ─────────────────────────────────────────────────────────
   Visual Vibes editor rail tab. Describe the video (prefilled from the
   timeline's opening when available); AI writes 5 alternate opening hooks
   — spoken/visual text + visual direction — and SCORES each 0-100 for
   scroll-stopping power with one-line reasoning. Text-model analysis only;
   no extra generation cost beyond the 2 VB analysis. */

const COST = 2;

interface Opening {
  text: string;
  visual: string;
  score: number;
  reasoning: string;
}

interface ThreeSecondLabSectionProps {
  openingHint: string;
  /** When true, skips the internal header (a shell provides it). */
  bare?: boolean;
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-white/25 focus:border-primary/60 focus:outline-none";

function scoreColor(score: number): string {
  if (score >= 80) return "text-green-400";
  if (score >= 60) return "text-primary";
  return "text-white/50";
}

export function ThreeSecondLabSection({ openingHint, bare }: ThreeSecondLabSectionProps) {
  const { t } = useTranslation();
  const { getAccessToken, refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();

  const [description, setDescription] = useState(openingHint);
  const [niche, setNiche] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [openings, setOpenings] = useState<Opening[]>([]);

  /* ── Custom clip upload — analyze your own clip instead of the timeline opening ── */
  const { upload, uploading: clipUploading, error: clipError, clearError: clearClipError } = useFileUpload();
  const [clipUrl, setClipUrl] = useState<string | null>(null);
  const [clipName, setClipName] = useState("");
  const [clipLocalError, setClipLocalError] = useState<string | null>(null);
  const clipInputRef = useRef<HTMLInputElement | null>(null);

  async function handleClipFile(file: File) {
    clearClipError();
    setClipLocalError(null);
    if (!file.type.startsWith("video/")) {
      setClipLocalError("Please choose a video file (MP4, MOV, WebM).");
      return;
    }
    if (file.size > 80 * 1024 * 1024) {
      setClipLocalError("Video must be 80 MB or smaller.");
      return;
    }
    const url = await upload(file);
    if (url) {
      setClipUrl(url);
      setClipName(file.name);
      setOpenings([]);
    }
  }

  function removeClip() {
    setClipUrl(null);
    setClipName("");
    if (clipInputRef.current) clipInputRef.current.value = "";
  }

  async function generate() {
    if (!description.trim() || loading) return;
    setLoading(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const token = await getAccessToken();
      const res = await confirmedFetch("/api/three-second-lab/openings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        overrideCost: COST,
        overrideFeature: "3-Second Lab",
        body: JSON.stringify({ videoDescription: description.trim(), niche: niche.trim() }),
      });
      if (!res) return;
      const data = (await res.json().catch(() => ({}))) as {
        openings?: Opening[]; error?: string; message?: string;
      };
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !data.openings?.length) throw new Error(data.message || "Lab failed.");
      setOpenings([...data.openings].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)));
      refreshProfile();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lab failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      {!bare && (
      <div>
        <h3 className="text-sm font-black text-white flex items-center gap-2">
          <Timer className="h-4 w-4 text-primary" />
          {t("videoEditor.labTitle", { defaultValue: "3-Second Lab" })}
        </h3>
        <p className="text-[11px] text-white/50 mt-1 leading-relaxed">
          {t("videoEditor.labDesc", {
            defaultValue: "Win the first 3 seconds. AI writes 5 alternate openings for your video and scores each for scroll-stopping power. 2 VB.",
          })}
        </p>
      </div>
      )}

      {/* ── Upload your own clip ── */}
      <div className="rounded-xl border border-primary/25 bg-primary/[0.05] p-3.5">
        <p className="text-[11px] font-bold uppercase tracking-widest text-primary mb-2 flex items-center gap-1.5">
          <Upload className="h-3.5 w-3.5" />
          {t("videoEditor.labUploadTitle", { defaultValue: "Upload your clip" })}
        </p>
        {clipUrl ? (
          <div className="flex items-center gap-3">
            <video
              src={clipUrl}
              className="h-16 w-24 rounded-lg border border-primary/30 object-cover shrink-0 bg-black"
              muted
              playsInline
            />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-white truncate">{clipName}</p>
              <p className="text-[10px] text-white/40 mt-0.5">
                {t("videoEditor.labClipActive", { defaultValue: "Describe this clip below — the lab scores openings for it." })}
              </p>
            </div>
            <button
              type="button"
              onClick={() => clipInputRef.current?.click()}
              className="shrink-0 rounded-lg border border-white/15 px-2.5 py-1.5 text-[11px] font-bold text-white/70 hover:border-primary/50 hover:text-white transition"
            >
              {t("videoEditor.labReplace", { defaultValue: "Replace" })}
            </button>
            <button
              type="button"
              onClick={removeClip}
              className="shrink-0 rounded-lg border border-white/15 p-1.5 text-white/50 hover:border-red-400/50 hover:text-red-300 transition"
              title={t("videoEditor.labRemove", { defaultValue: "Remove clip" })}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => clipInputRef.current?.click()}
            disabled={clipUploading}
            className="w-full flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary/30 bg-black/30 px-4 py-5 text-sm text-white/60 hover:border-primary/60 hover:text-white transition disabled:opacity-50"
          >
            {clipUploading ? (
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            ) : (
              <Clapperboard className="h-4 w-4 text-primary" />
            )}
            {clipUploading
              ? t("videoEditor.labUploading", { defaultValue: "Uploading…" })
              : t("videoEditor.labUploadCta", { defaultValue: "Choose a video clip (MP4/MOV, ≤ 80 MB) — or analyze the timeline opening below" })}
          </button>
        )}
        <input
          ref={clipInputRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleClipFile(f);
          }}
        />
        {(clipError || clipLocalError) && (
          <p className="text-xs text-red-400 mt-2">{clipError ?? clipLocalError}</p>
        )}
      </div>

      <div>
        <label className="text-[11px] font-bold uppercase tracking-widest text-white/40">
          {clipUrl
            ? t("videoEditor.labVideoLabelClip", { defaultValue: "Describe your uploaded clip *" })
            : t("videoEditor.labVideoLabel", { defaultValue: "What is the video about? *" })}
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("videoEditor.labVideoPh", { defaultValue: "e.g. A luxury lifestyle montage from my latest single…" })}
          className={`${inputClass} mt-1 min-h-[80px] resize-y`}
          maxLength={1000}
        />
      </div>
      <div>
        <label className="text-[11px] font-bold uppercase tracking-widest text-white/40">
          {t("videoEditor.labNiche", { defaultValue: "Niche (optional)" })}
        </label>
        <input value={niche} onChange={(e) => setNiche(e.target.value)} className={`${inputClass} mt-1`} maxLength={120} />
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
      {outOfCredits && <OutOfCredits />}

      <button
        type="button"
        onClick={generate}
        disabled={loading || !description.trim()}
        className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-[#f7dd7f] to-[#C9A84C] px-4 py-2.5 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-40"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        {t("videoEditor.labGenerate", { defaultValue: "Test 5 Openings" })}
      </button>

      {openings.length > 0 && (
        <div className="space-y-2.5">
          <p className="text-[11px] font-bold uppercase tracking-widest text-primary">
            {t("videoEditor.labResults", { defaultValue: "Ranked by scroll-stopping score" })}
          </p>
          {openings.map((o, i) => (
            <div key={i} className={`rounded-xl border p-3.5 ${i === 0 ? "border-primary/60 bg-primary/[0.07]" : "border-white/10 bg-white/[0.02]"}`}>
              <div className="flex items-center gap-2 mb-1.5">
                {i === 0 && <Trophy className="h-3.5 w-3.5 text-primary" />}
                <span className={`text-lg font-black ${scoreColor(o.score)}`}>{o.score}</span>
                <span className="text-[10px] text-white/35 uppercase tracking-widest">/ 100</span>
              </div>
              <p className="text-sm font-bold text-white leading-snug">“{o.text}”</p>
              <p className="text-[11px] text-white/50 mt-1">{o.visual}</p>
              <p className="text-[11px] text-white/35 mt-1 italic">{o.reasoning}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
