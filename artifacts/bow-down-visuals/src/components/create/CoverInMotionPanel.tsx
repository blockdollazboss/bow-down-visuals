import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Play, Loader2, Sparkles, Upload, Check, Download, CalendarClock } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { OutOfCredits } from "@/components/OutOfCredits";
import { useHubProject } from "@/lib/hub-project";

/* ── Cover in Motion ──────────────────────────────────────────────────────
   Create hub panel. Animates cover art into a looping Spotify-canvas-style
   visualizer via the existing image-to-video pipeline. 4 VB for a 5s loop. */

const COST = 4;

const inputClass =
  "w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-white/25 focus:border-primary/60 focus:outline-none";

export default function CoverInMotionPanel() {
  const isLight = useIsLightTheme();
  const { t } = useTranslation();
  const { getAccessToken, refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const { addAsset } = useHubProject();

  const [imageUrl, setImageUrl] = useState("");
  const [style, setStyle] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  async function animate() {
    if (!imageUrl.trim() || loading) return;
    setLoading(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const token = await getAccessToken();
      const res = await confirmedFetch("/api/cover-in-motion/animate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        overrideCost: COST,
        overrideFeature: "Cover in Motion",
        body: JSON.stringify({ imageUrl: imageUrl.trim(), style: style.trim(), durationSec: 5 }),
      });
      if (!res) return;
      const data = (await res.json().catch(() => ({}))) as {
        videoUrl?: string; error?: string; message?: string;
      };
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !data.videoUrl) throw new Error(data.message || "Animation failed.");
      setVideoUrl(data.videoUrl);
      /* Hub project spine (Stack 4 #2): the animated cover reports into the
         active hub project so the video desk can pick it up. */
      try { addAsset({ kind: "video", url: data.videoUrl, label: "Cover in Motion", detail: "Animated cover art" }); } catch { /* non-fatal */ }
      refreshProfile();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Animation failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className={`${isLight ? "rounded-3xl border border-primary/25 bg-gradient-to-b from-[#F7ECD2] to-[#FCF7EA] p-6 md:p-8" : "rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04] p-6 md:p-8"}`}>
        <div className="flex items-center gap-2 mb-1">
          <Play className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-black text-white">{t("coverInMotion.title", { defaultValue: "Cover in Motion" })}</h3>
          <span className="ml-auto rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 text-[11px] font-bold text-primary">
            {t("coverInMotion.cost", { defaultValue: "400 VB" })}
          </span>
        </div>
        <p className="text-sm text-white/50 mb-6">
          {t("coverInMotion.desc", { defaultValue: "Turn your cover art into a looping canvas-style visualizer — made for Spotify Canvas, profiles, and posts." })}
        </p>

        <div className="grid gap-4 md:grid-cols-2">
          {imageUrl && (
            <div className="md:col-span-2 flex justify-center">
              <img src={imageUrl} alt="Cover" className="h-40 w-40 rounded-2xl border border-white/10 object-cover" />
            </div>
          )}
          <div className="md:col-span-2">
            <label className="text-[11px] font-bold uppercase tracking-widest text-white/40">
              {t("coverInMotion.urlLabel", { defaultValue: "Cover art image URL *" })}
            </label>
            <input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://…" className={`${inputClass} mt-1.5`} maxLength={2000} />
          </div>
          <div className="md:col-span-2">
            <label className="text-[11px] font-bold uppercase tracking-widest text-white/40">
              {t("coverInMotion.styleLabel", { defaultValue: "Motion style (optional)" })}
            </label>
            <input value={style} onChange={(e) => setStyle(e.target.value)}
              placeholder={t("coverInMotion.stylePh", { defaultValue: "e.g. slow cinematic zoom, floating particles…" })}
              className={`${inputClass} mt-1.5`} maxLength={120} />
          </div>
        </div>

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
        {outOfCredits && <div className="mt-4"><OutOfCredits /></div>}

        <button type="button" onClick={animate} disabled={loading || !imageUrl.trim()}
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-[#f7dd7f] to-[#C9A84C] px-6 py-3 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-40">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {t("coverInMotion.go", { defaultValue: "Animate My Cover" })}
        </button>
        {loading && (
          <p className="mt-3 text-xs text-white/40">{t("coverInMotion.working", { defaultValue: "Animating — video takes a minute or two…" })}</p>
        )}
      </div>

      {videoUrl && (
        <div className={`rounded-3xl border p-6 md:p-8 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
          <p className="text-[11px] font-bold uppercase tracking-widest text-primary mb-3">
            {t("coverInMotion.result", { defaultValue: "Your looping visualizer" })}
          </p>
          <video src={videoUrl} controls loop muted playsInline className="mx-auto aspect-square max-h-[420px] rounded-2xl border border-white/10" />
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <a
              href={videoUrl}
              download="cover-in-motion.mp4"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-primary/40 bg-primary/[0.06] px-5 py-3 text-sm font-bold text-primary hover:bg-primary/10 transition-all"
            >
              <Download className="h-4 w-4" />
              {t("coverInMotion.download", { defaultValue: "Download" })}
            </a>
            <a
              href={`/scheduler?schedule=1&media=${encodeURIComponent(videoUrl)}&caption=${encodeURIComponent(t("coverInMotion.scheduleCaption", { defaultValue: "My cover visualizer" }))}`}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-[#f7dd7f] to-[#C9A84C] px-5 py-3 text-sm font-black text-black transition hover:brightness-110"
            >
              <CalendarClock className="h-4 w-4" />
              {t("coverInMotion.schedule", { defaultValue: "Post it →" })}
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
