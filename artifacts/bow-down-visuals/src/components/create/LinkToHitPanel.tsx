import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link2, Loader2, Sparkles, Upload, Film, Music2, Plus, X, Check, Copy } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { OutOfCredits } from "@/components/OutOfCredits";

/* ── Link-to-Hit ──────────────────────────────────────────────────────────
   Create hub panel. COMEDY feature: paste a social link and/or upload the
   video, paste the comments — get a funny music-video package.

   Two SEPARATE pipelines (never blended):
   (1) VISUALS: actual source clips intercut with AI-GENERATED comedic roast
       inserts (exaggerated reactions, absurd scenarios, comic-book pop-ups).
   (2) SONG: a FUNNY song — hook + full lyrics written FROM THE COMMENTS
       themes, in the user's chosen genre (preset chips + free text).

   Honest sourcing: upload = primary reliable path; link = whatever oEmbed
   publicly exposes (never faked); neither = fully AI-generated from the
   description + comments. 3 VB per package. */

const COST = 3;

const GENRE_PRESETS = [
  "Hip-Hop", "Pop", "Country", "Rock", "EDM", "R&B", "Gospel",
  "Reggaeton", "Afrobeats", "Comedy Pop", "Novelty", "Punk",
];

interface Segment {
  type: "source" | "generated";
  description: string;
  prompt?: string;
}

interface HitPackage {
  source: { title?: string; author?: string; thumbnail?: string } | null;
  comedyConcept: string;
  segments: Segment[];
  songTitle: string;
  hook: string;
  songLyrics: string;
  musicPrompt: string;
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-white/25 focus:border-primary/60 focus:outline-none";

export default function LinkToHitPanel() {
  const { t } = useTranslation();
  const { getAccessToken, refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();

  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [hasUpload, setHasUpload] = useState(false);
  const [fileName, setFileName] = useState("");
  const [commentInput, setCommentInput] = useState("");
  const [comments, setComments] = useState<string[]>([]);
  const [genre, setGenre] = useState("Comedy Pop");
  const [customGenre, setCustomGenre] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [pkg, setPkg] = useState<HitPackage | null>(null);
  const [copied, setCopied] = useState(false);

  const finalGenre = customGenre.trim() || genre;

  function addComment() {
    const c = commentInput.trim();
    if (!c || comments.length >= 20) return;
    setComments((prev) => [...prev, c]);
    setCommentInput("");
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) {
      setHasUpload(true);
      setFileName(f.name);
    }
  }

  async function generate() {
    if ((!description.trim() && !url.trim() && !hasUpload) || loading) return;
    setLoading(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const token = await getAccessToken();
      const res = await confirmedFetch("/api/link-to-hit/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        overrideCost: COST,
        overrideFeature: "Link-to-Hit",
        body: JSON.stringify({
          url: url.trim(),
          description: description.trim() || (hasUpload ? `Uploaded video: ${fileName}` : ""),
          comments,
          genre: finalGenre,
        }),
      });
      if (!res) return;
      const data = (await res.json().catch(() => ({}))) as HitPackage & {
        error?: string; message?: string;
      };
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !data.comedyConcept) throw new Error(data.message || "Package failed.");
      setPkg(data);
      refreshProfile();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Package failed.");
    } finally {
      setLoading(false);
    }
  }

  function copySong() {
    if (!pkg) return;
    navigator.clipboard.writeText(`${pkg.songTitle}\n\nHOOK:\n${pkg.hook}\n\n${pkg.songLyrics}`).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-8">
        <div className="flex items-center gap-2 mb-1">
          <Link2 className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-black text-white">{t("linkToHit.title", { defaultValue: "Link-to-Hit" })}</h3>
          <span className="ml-auto rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 text-[11px] font-bold text-primary">
            {t("linkToHit.cost", { defaultValue: "3 VB" })}
          </span>
        </div>
        <p className="text-sm text-white/50 mb-6">
          {t("linkToHit.desc", {
            defaultValue: "A comedy music-video package from any viral moment. Your real clips + AI roast inserts, and a genuinely funny song written from the comments — in ANY genre you pick.",
          })}
        </p>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="text-[11px] font-bold uppercase tracking-widest text-white/40">
              {t("linkToHit.urlLabel", { defaultValue: "Social link (TikTok / IG / YouTube)" })}
            </label>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className={`${inputClass} mt-1.5`} maxLength={500} />
            <p className="text-[11px] text-white/35 mt-1">
              {t("linkToHit.urlNote", { defaultValue: "We use whatever the link publicly exposes — never faked." })}
            </p>
          </div>
          <div>
            <label className="text-[11px] font-bold uppercase tracking-widest text-white/40">
              {t("linkToHit.uploadLabel", { defaultValue: "Or upload the video (most reliable)" })}
            </label>
            <label className={`mt-1.5 flex cursor-pointer items-center gap-2 rounded-xl border border-dashed px-4 py-3 text-sm transition ${hasUpload ? "border-primary/60 text-primary" : "border-white/15 text-white/55 hover:border-white/30"}`}>
              <Upload className="h-4 w-4" />
              {hasUpload ? fileName : t("linkToHit.uploadCta", { defaultValue: "Choose video file…" })}
              <input type="file" accept="video/*" className="hidden" onChange={handleFile} />
            </label>
          </div>
          <div className="md:col-span-2">
            <label className="text-[11px] font-bold uppercase tracking-widest text-white/40">
              {t("linkToHit.descLabel", { defaultValue: "Describe the video" })}
            </label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder={t("linkToHit.descPh", { defaultValue: "What's happening in it? What's funny/absurd about it?" })}
              className={`${inputClass} mt-1.5 min-h-[80px] resize-y`} maxLength={1000} />
          </div>
          <div className="md:col-span-2">
            <label className="text-[11px] font-bold uppercase tracking-widest text-white/40">
              {t("linkToHit.commentsLabel", { defaultValue: "Paste the comments (the song is written from these)" })}
            </label>
            <div className="flex gap-2 mt-1.5 mb-2">
              <input value={commentInput} onChange={(e) => setCommentInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addComment()}
                placeholder={t("linkToHit.commentsPh", { defaultValue: "Paste a comment, hit Enter…" })}
                className={inputClass} maxLength={500} />
              <button type="button" onClick={addComment} disabled={!commentInput.trim() || comments.length >= 20}
                className="shrink-0 rounded-xl bg-white/10 px-4 text-white hover:bg-white/15 disabled:opacity-40">
                <Plus className="h-4 w-4" />
              </button>
            </div>
            {comments.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {comments.map((c, i) => (
                  <span key={i} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/75">
                    <span className="truncate max-w-[280px]">“{c}”</span>
                    <button type="button" onClick={() => setComments((prev) => prev.filter((_, idx) => idx !== i))} className="text-white/40 hover:text-white" aria-label="Remove">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="md:col-span-2">
            <label className="text-[11px] font-bold uppercase tracking-widest text-white/40">
              {t("linkToHit.genreLabel", { defaultValue: "Song genre — your call" })}
            </label>
            <div className="flex flex-wrap gap-2 mt-1.5">
              {GENRE_PRESETS.map((g) => (
                <button key={g} type="button" onClick={() => { setGenre(g); setCustomGenre(""); }}
                  className={`rounded-full border px-3.5 py-1.5 text-xs font-bold transition ${genre === g && !customGenre ? "border-primary bg-primary/15 text-primary" : "border-white/10 text-white/55 hover:text-white"}`}>
                  {g}
                </button>
              ))}
            </div>
            <input value={customGenre} onChange={(e) => setCustomGenre(e.target.value)}
              placeholder={t("linkToHit.genreCustomPh", { defaultValue: "Or type ANY genre…" })}
              className={`${inputClass} mt-2`} maxLength={60} />
          </div>
        </div>

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
        {outOfCredits && <div className="mt-4"><OutOfCredits /></div>}

        <button type="button" onClick={generate}
          disabled={loading || (!description.trim() && !url.trim() && !hasUpload)}
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-[#f7dd7f] to-[#C9A84C] px-6 py-3 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-40">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {t("linkToHit.generate", { defaultValue: "Build My Comedy Package" })}
        </button>
      </div>

      {pkg && (
        <div className="space-y-6">
          {/* Source (if oEmbed worked) */}
          {pkg.source && (pkg.source.title || pkg.source.thumbnail) && (
            <div className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
              {pkg.source.thumbnail && <img src={pkg.source.thumbnail} alt="" className="h-16 w-16 rounded-xl object-cover" />}
              <div>
                <p className="text-sm font-bold text-white">{pkg.source.title}</p>
                {pkg.source.author && <p className="text-xs text-white/45">{pkg.source.author}</p>}
              </div>
            </div>
          )}

          {/* Comedy concept */}
          <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-6 md:p-8">
            <p className="text-[11px] font-bold uppercase tracking-widest text-primary mb-2 flex items-center gap-1.5">
              <Film className="h-3.5 w-3.5" /> {t("linkToHit.concept", { defaultValue: "The comedy concept" })}
            </p>
            <p className="text-sm text-white/85 whitespace-pre-wrap leading-relaxed">{pkg.comedyConcept}</p>
          </div>

          {/* Segments: source vs generated */}
          <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-6 md:p-8">
            <p className="text-[11px] font-bold uppercase tracking-widest text-primary mb-3">
              {t("linkToHit.segments", { defaultValue: "The cut: your clips + roast inserts" })}
            </p>
            <div className="space-y-2.5">
              {pkg.segments.map((seg, i) => (
                <div key={i} className={`rounded-xl border p-4 ${seg.type === "generated" ? "border-primary/40 bg-primary/[0.05]" : "border-white/10 bg-black/40"}`}>
                  <p className={`text-[10px] font-black uppercase tracking-widest mb-1 ${seg.type === "generated" ? "text-primary" : "text-white/45"}`}>
                    {seg.type === "generated"
                      ? t("linkToHit.segGenerated", { defaultValue: "AI roast insert" })
                      : t("linkToHit.segSource", { defaultValue: "Your clip" })}
                  </p>
                  <p className="text-sm text-white/80">{seg.description}</p>
                  {seg.prompt && <p className="mt-2 rounded-lg bg-black/50 px-3 py-2 text-[11px] text-white/55 leading-relaxed">{seg.prompt}</p>}
                </div>
              ))}
            </div>
          </div>

          {/* Funny song (from comments) */}
          <div className="rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-8">
            <div className="flex items-start justify-between gap-2 mb-2">
              <p className="text-[11px] font-bold uppercase tracking-widest text-primary flex items-center gap-1.5">
                <Music2 className="h-3.5 w-3.5" /> {t("linkToHit.song", { defaultValue: "The funny song" })} · {finalGenre}
              </p>
              <button type="button" onClick={copySong} className="text-white/50 hover:text-white" aria-label="Copy song">
                {copied ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-lg font-black text-white mb-3">“{pkg.songTitle}”</p>
            <p className="text-[11px] font-bold uppercase tracking-widest text-white/40 mb-1">{t("linkToHit.hook", { defaultValue: "Hook" })}</p>
            <p className="text-sm font-bold text-primary mb-4">{pkg.hook}</p>
            <p className="text-sm text-white/80 whitespace-pre-wrap leading-relaxed">{pkg.songLyrics}</p>
            <p className="mt-4 rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-[11px] text-white/50 leading-relaxed">
              <span className="text-white/70 font-bold">{t("linkToHit.musicPrompt", { defaultValue: "Music prompt:" })}</span> {pkg.musicPrompt}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
