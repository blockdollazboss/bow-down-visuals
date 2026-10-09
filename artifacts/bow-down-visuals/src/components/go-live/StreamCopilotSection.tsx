import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Radio, Loader2, Sparkles, ClipboardCheck, Scissors } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { OutOfCredits } from "@/components/OutOfCredits";

/* ── Stream Copilot ───────────────────────────────────────────────────────
   Live hub (/go-live) tab. HONEST SCOPE: no real-time co-hosting.
   (1) Pre-stream: AI generates a setup checklist, talking points/segment
       plan, and "clip watch-fors" — moment types to watch for that make
       good clips. 1 VB.
   (2) Post-stream: paste a recap with timestamps; AI identifies the most
       clip-worthy moments with titles + descriptions. 1 VB. */

const PREP_COST = 1;
const CLIP_COST = 1;

interface PrepResult {
  checklist: string[];
  talkingPoints: string[];
  clipWatchFors: string[];
}

interface ClipMoment {
  timestampHint: string;
  title: string;
  description: string;
  whyItWorks: string;
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-white/25 focus:border-primary/60 focus:outline-none";

export default function StreamCopilotSection() {
  const { t } = useTranslation();
  const { getAccessToken, refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();

  const [mode, setMode] = useState<"prep" | "clips">("prep");
  const [streamTitle, setStreamTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [platform, setPlatform] = useState("TikTok");
  const [recap, setRecap] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [prep, setPrep] = useState<PrepResult | null>(null);
  const [moments, setMoments] = useState<ClipMoment[]>([]);

  async function post<T>(url: string, body: object, cost: number, feature: string): Promise<T | null> {
    const token = await getAccessToken();
    const res = await confirmedFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      overrideCost: cost,
      overrideFeature: feature,
      body: JSON.stringify(body),
    });
    if (!res) return null;
    const data = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string };
    if (res.status === 402 || data.error === "out_of_credits") {
      setOutOfCredits(true);
      refreshProfile();
      return null;
    }
    if (!res.ok) throw new Error(data.message || "Request failed.");
    refreshProfile();
    return data;
  }

  async function generatePrep() {
    if (!streamTitle.trim() || !topic.trim() || loading) return;
    setLoading(true); setError(null); setOutOfCredits(false);
    try {
      const data = await post<PrepResult>("/api/stream-copilot/prep",
        { streamTitle: streamTitle.trim(), topic: topic.trim(), platform }, PREP_COST, "Stream Copilot");
      if (data && data.checklist) setPrep(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Prep failed.");
    } finally {
      setLoading(false);
    }
  }

  async function generateClipPlan() {
    if (!recap.trim() || loading) return;
    setLoading(true); setError(null); setOutOfCredits(false);
    try {
      const data = await post<{ moments: ClipMoment[] }>("/api/stream-copilot/clip-plan",
        { recap: recap.trim(), topic: topic.trim() }, CLIP_COST, "Stream Copilot");
      if (data && data.moments) setMoments(data.moments);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Clip plan failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-8">
        <div className="flex items-center gap-2 mb-1">
          <Radio className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-black text-white">{t("streamCopilot.title", { defaultValue: "Stream Copilot" })}</h3>
        </div>
        <p className="text-sm text-white/50 mb-6">
          {t("streamCopilot.desc", { defaultValue: "Your pre-stream prepper and post-stream clip spotter. No fake real-time co-hosting — just sharp prep and sharp clips." })}
        </p>

        <div className="inline-flex rounded-xl border border-white/10 bg-white/[0.03] p-1 mb-6">
          {([
            { key: "prep", label: t("streamCopilot.prepTab", { defaultValue: "Pre-Stream Prep" }), icon: ClipboardCheck },
            { key: "clips", label: t("streamCopilot.clipsTab", { defaultValue: "Post-Stream Clips" }), icon: Scissors },
          ] as const).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setMode(key)}
              className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-bold transition ${mode === key ? "bg-primary text-black" : "text-white/55 hover:text-white"}`}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>

        {mode === "prep" ? (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-[11px] font-bold uppercase tracking-widest text-white/40">{t("streamCopilot.titleLabel", { defaultValue: "Stream title *" })}</label>
                <input value={streamTitle} onChange={(e) => setStreamTitle(e.target.value)} className={`${inputClass} mt-1.5`} maxLength={200} />
              </div>
              <div>
                <label className="text-[11px] font-bold uppercase tracking-widest text-white/40">{t("streamCopilot.topicLabel", { defaultValue: "Topic / game *" })}</label>
                <input value={topic} onChange={(e) => setTopic(e.target.value)} className={`${inputClass} mt-1.5`} maxLength={300} />
              </div>
            </div>
            <div>
              <label className="text-[11px] font-bold uppercase tracking-widest text-white/40">{t("streamCopilot.platformLabel", { defaultValue: "Platform" })}</label>
              <div className="flex gap-2 mt-1.5">
                {["TikTok", "YouTube", "Twitch", "Instagram"].map((p) => (
                  <button key={p} type="button" onClick={() => setPlatform(p)}
                    className={`rounded-full border px-4 py-1.5 text-xs font-bold transition ${platform === p ? "border-primary bg-primary/15 text-primary" : "border-white/10 text-white/55 hover:text-white"}`}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <button type="button" onClick={generatePrep} disabled={loading || !streamTitle.trim() || !topic.trim()}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-[#f7dd7f] to-[#C9A84C] px-6 py-3 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-40">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {t("streamCopilot.prepGo", { defaultValue: "Build My Prep (1 VB)" })}
            </button>

            {prep && (
              <div className="grid gap-4 md:grid-cols-3 pt-2">
                {([
                  [t("streamCopilot.checklist", { defaultValue: "Setup checklist" }), prep.checklist],
                  [t("streamCopilot.talking", { defaultValue: "Talking points" }), prep.talkingPoints],
                  [t("streamCopilot.watchfors", { defaultValue: "Clip watch-fors" }), prep.clipWatchFors],
                ] as [string, string[]][]).map(([label, items], gi) => (
                  <div key={gi} className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
                    <p className="text-[11px] font-bold uppercase tracking-widest text-primary mb-2">{label}</p>
                    <ul className="space-y-1.5 text-sm text-white/75">
                      {items.map((it, i) => <li key={i} className="flex gap-2"><span className="text-primary">•</span>{it}</li>)}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="text-[11px] font-bold uppercase tracking-widest text-white/40">
                {t("streamCopilot.recapLabel", { defaultValue: "Post-stream recap with timestamps *" })}
              </label>
              <textarea value={recap} onChange={(e) => setRecap(e.target.value)}
                placeholder={t("streamCopilot.recapPh", { defaultValue: "e.g. 12:40 — insane clutch comeback, chat went wild… 38:15 — funny mic fail…" })}
                className={`${inputClass} mt-1.5 min-h-[120px] resize-y`} maxLength={3000} />
            </div>
            <button type="button" onClick={generateClipPlan} disabled={loading || !recap.trim()}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-[#f7dd7f] to-[#C9A84C] px-6 py-3 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-40">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {t("streamCopilot.clipsGo", { defaultValue: "Spot the Clips (1 VB)" })}
            </button>

            {moments.length > 0 && (
              <div className="grid gap-3 md:grid-cols-2 pt-2">
                {moments.map((m, i) => (
                  <div key={i} className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
                    <p className="text-[11px] font-bold text-primary uppercase tracking-widest">{m.timestampHint}</p>
                    <p className="text-sm font-black text-white mt-1">{m.title}</p>
                    <p className="text-sm text-white/70 mt-1.5">{m.description}</p>
                    <p className="text-xs text-white/40 mt-1.5 italic">{m.whyItWorks}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
        {outOfCredits && <div className="mt-4"><OutOfCredits /></div>}
      </div>
    </div>
  );
}
