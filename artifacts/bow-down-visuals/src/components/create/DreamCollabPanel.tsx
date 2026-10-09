import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Users, Loader2, Sparkles, Copy, Check } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { OutOfCredits } from "@/components/OutOfCredits";

/* ── Dream Collab ─────────────────────────────────────────────────────────
   Create hub panel. "What if I collabed with X?" — AI generates a style-blend
   video concept: logline, full concept, prompt-level video generation
   prompts for the existing video pipeline, and a song concept. 2 credits. */

const COST = 2;

interface CollabConcept {
  logline: string;
  concept: string;
  styleBlend: string;
  videoPrompts: string[];
  songConcept: string;
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-white/25 focus:border-primary/60 focus:outline-none";

export default function DreamCollabPanel() {
  const { t } = useTranslation();
  const { getAccessToken, refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();

  const [collaborator, setCollaborator] = useState("");
  const [userStyle, setUserStyle] = useState("");
  const [songTheme, setSongTheme] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [concept, setConcept] = useState<CollabConcept | null>(null);
  const [copied, setCopied] = useState(false);

  async function generate() {
    if (!collaborator.trim() || !userStyle.trim() || loading) return;
    setLoading(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const token = await getAccessToken();
      const res = await confirmedFetch("/api/dream-collab/concept", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        overrideCost: COST,
        overrideFeature: "Dream Collab",
        body: JSON.stringify({
          collaborator: collaborator.trim(),
          userStyle: userStyle.trim(),
          songTheme: songTheme.trim(),
        }),
      });
      if (!res) return;
      const data = (await res.json().catch(() => ({}))) as CollabConcept & {
        error?: string; message?: string;
      };
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !data.logline) throw new Error(data.message || "Concept failed.");
      setConcept(data);
      refreshProfile();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Concept failed.");
    } finally {
      setLoading(false);
    }
  }

  function copyAll() {
    if (!concept) return;
    const text = `${concept.logline}\n\n${concept.concept}\n\nSTYLE BLEND: ${concept.styleBlend}\n\nVIDEO PROMPTS:\n${concept.videoPrompts.map((p, i) => `${i + 1}. ${p}`).join("\n")}\n\nSONG CONCEPT: ${concept.songConcept}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-8">
        <div className="flex items-center gap-2 mb-1">
          <Users className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-black text-white">{t("dreamCollab.title", { defaultValue: "Dream Collab" })}</h3>
          <span className="ml-auto rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 text-[11px] font-bold text-primary">
            {t("dreamCollab.cost", { defaultValue: "2 VB" })}
          </span>
        </div>
        <p className="text-sm text-white/50 mb-6">
          {t("dreamCollab.desc", { defaultValue: "What if you collabed with your dream artist? AI blends your styles into a video concept with ready-to-use generation prompts." })}
        </p>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="text-[11px] font-bold uppercase tracking-widest text-white/40">
              {t("dreamCollab.collabLabel", { defaultValue: "Dream collaborator *" })}
            </label>
            <input value={collaborator} onChange={(e) => setCollaborator(e.target.value)} placeholder={t("dreamCollab.collabPh", { defaultValue: "e.g. Doja Cat" })} className={`${inputClass} mt-1.5`} maxLength={120} />
          </div>
          <div>
            <label className="text-[11px] font-bold uppercase tracking-widest text-white/40">
              {t("dreamCollab.styleLabel", { defaultValue: "Your style *" })}
            </label>
            <input value={userStyle} onChange={(e) => setUserStyle(e.target.value)} placeholder={t("dreamCollab.stylePh", { defaultValue: "e.g. dark drill with luxury visuals" })} className={`${inputClass} mt-1.5`} maxLength={200} />
          </div>
          <div className="md:col-span-2">
            <label className="text-[11px] font-bold uppercase tracking-widest text-white/40">
              {t("dreamCollab.themeLabel", { defaultValue: "Song theme (optional)" })}
            </label>
            <input value={songTheme} onChange={(e) => setSongTheme(e.target.value)} placeholder={t("dreamCollab.themePh", { defaultValue: "e.g. late-night ambition" })} className={`${inputClass} mt-1.5`} maxLength={300} />
          </div>
        </div>

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
        {outOfCredits && <div className="mt-4"><OutOfCredits /></div>}

        <button
          type="button"
          onClick={generate}
          disabled={loading || !collaborator.trim() || !userStyle.trim()}
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-[#f7dd7f] to-[#C9A84C] px-6 py-3 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-40"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {t("dreamCollab.generate", { defaultValue: "Imagine the Collab" })}
        </button>
      </div>

      {concept && (
        <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-6 md:p-8 space-y-5">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xl font-black text-primary leading-snug">“{concept.logline}”</p>
            <button type="button" onClick={copyAll} className="shrink-0 text-white/50 hover:text-white" aria-label="Copy">
              {copied ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
          <p className="text-sm text-white/80 whitespace-pre-wrap leading-relaxed">{concept.concept}</p>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-primary mb-1">{t("dreamCollab.styleBlend", { defaultValue: "Style blend" })}</p>
            <p className="text-sm text-white/70">{concept.styleBlend}</p>
          </div>
          {concept.videoPrompts.length > 0 && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-primary mb-2">{t("dreamCollab.videoPrompts", { defaultValue: "Video prompts (paste into video pipeline)" })}</p>
              <div className="space-y-2">
                {concept.videoPrompts.map((p, i) => (
                  <p key={i} className="rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-xs text-white/75 leading-relaxed">{p}</p>
                ))}
              </div>
            </div>
          )}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-primary mb-1">{t("dreamCollab.songConcept", { defaultValue: "Song concept" })}</p>
            <p className="text-sm text-white/70 whitespace-pre-wrap">{concept.songConcept}</p>
          </div>
        </div>
      )}
    </div>
  );
}
