import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Droplets, Loader2, Plus, Check, Music2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

/* ── Vault Drip ───────────────────────────────────────────────────────────
   Plan hub (/scheduler) tab. Drip unreleased audio to fans over time.
   Pick songs from the vault, set a cadence — Vault Drip lays out the drop
   calendar and creates DRAFT posts in the scheduler (free, pure UI).
   Scheduling the drafts to auto-publish uses the normal scheduler flow.
   Snippet asset generation (if needed) uses normal rates elsewhere. */

interface SongRecord {
  id: string;
  title?: string;
  audioUrl?: string;
  url?: string;
}

interface DripItem {
  songId: string;
  title: string;
  audioUrl: string;
  dropDate: Date;
  caption: string;
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-white/25 focus:border-primary/60 focus:outline-none";

const DRIP_CAPTIONS = [
  "Vault drip 💧 unreleased snippet — full drop soon.",
  "From the vault 🔓 let me know if this one needs a full release.",
  "Snippet SZN 🎧 rate this 1-10 in the comments.",
  "Unreleased heat 🔥 should I finish this one?",
];

export default function VaultDripSection() {
  const { t } = useTranslation();
  const { getAccessToken } = useAuth();
  const { toast } = useToast();

  const [songs, setSongs] = useState<SongRecord[]>([]);
  const [loadingSongs, setLoadingSongs] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [cadenceDays, setCadenceDays] = useState("3");
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [plan, setPlan] = useState<DripItem[]>([]);
  const [creating, setCreating] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/songs", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const data = (await res.json().catch(() => ({}))) as { songs?: SongRecord[] };
        setSongs(data.songs ?? []);
      } catch {
        /* empty state */
      } finally {
        setLoadingSongs(false);
      }
    })();
  }, [getAccessToken]);

  function togglePick(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setDone(false);
  }

  function buildPlan() {
    const days = Math.max(1, Math.min(30, parseInt(cadenceDays, 10) || 3));
    const start = new Date(`${startDate}T12:00:00`);
    const chosen = songs.filter((s) => picked.has(s.id));
    const items: DripItem[] = chosen.map((s, i) => {
      const dropDate = new Date(start);
      dropDate.setDate(dropDate.getDate() + i * days);
      const audioUrl = s.audioUrl ?? s.url ?? "";
      return {
        songId: s.id,
        title: s.title ?? `Snippet ${i + 1}`,
        audioUrl,
        dropDate,
        caption: `${DRIP_CAPTIONS[i % DRIP_CAPTIONS.length]} 🗓️ Drop ${i + 1}/${chosen.length}`,
      };
    });
    setPlan(items);
    setDone(false);
  }

  async function createDrafts() {
    if (plan.length === 0 || creating) return;
    setCreating(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };
      for (const item of plan) {
        const res = await fetch("/api/scheduler/posts", {
          method: "POST",
          headers,
          body: JSON.stringify({
            mediaUrl: item.audioUrl,
            mediaType: "audio",
            caption: item.caption,
            hashtags: ["vaultdrip", "unreleased", "snippet"],
            platforms: ["tiktok", "instagram"],
            accountIds: [],
            scheduledAt: null, // drafts are free; user schedules from the drafts tab
          }),
        });
        if (!res.ok) throw new Error(`Draft failed for "${item.title}"`);
      }
      setDone(true);
      toast({
        title: t("vaultDrip.draftsCreated", { defaultValue: "Drip drafts created" }),
        description: t("vaultDrip.draftsCreatedDesc", { defaultValue: "Find them in the Drafts tab — schedule each to its drop date." }),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create drafts.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-8">
        <div className="flex items-center gap-2 mb-1">
          <Droplets className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-black text-white">{t("vaultDrip.title", { defaultValue: "Vault Drip" })}</h3>
          <span className="ml-auto rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 text-[11px] font-bold text-primary">
            {t("vaultDrip.cost", { defaultValue: "Free" })}
          </span>
        </div>
        <p className="text-sm text-white/50 mb-6">
          {t("vaultDrip.desc", { defaultValue: "Drip unreleased snippets to fans on a schedule. Pick tracks, set the cadence — Vault Drip builds the drop calendar and saves free drafts. Free, pure planning." })}
        </p>

        {loadingSongs ? (
          <div className="flex items-center gap-2 text-white/40 text-sm py-8">
            <Loader2 className="h-4 w-4 animate-spin" /> {t("vaultDrip.loading", { defaultValue: "Loading your vault…" })}
          </div>
        ) : songs.length === 0 ? (
          <p className="text-sm text-white/45 py-8 text-center">
            {t("vaultDrip.empty", { defaultValue: "No songs in your vault yet — make one first, then drip it." })}
          </p>
        ) : (
          <>
            <p className="text-[11px] font-bold uppercase tracking-widest text-white/40 mb-2">
              {t("vaultDrip.pick", { defaultValue: "Pick snippets to drip" })}
            </p>
            <div className="grid gap-2 md:grid-cols-2 mb-5 max-h-64 overflow-y-auto pr-1">
              {songs.map((s) => {
                const active = picked.has(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => togglePick(s.id)}
                    className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition ${active ? "border-primary bg-primary/10" : "border-white/10 hover:border-white/30"}`}
                  >
                    <Music2 className={`h-4 w-4 shrink-0 ${active ? "text-primary" : "text-white/40"}`} />
                    <span className={`text-sm font-semibold truncate ${active ? "text-white" : "text-white/70"}`}>
                      {s.title ?? "Untitled"}
                    </span>
                    {active && <Check className="ml-auto h-4 w-4 shrink-0 text-primary" />}
                  </button>
                );
              })}
            </div>

            <div className="grid gap-4 md:grid-cols-2 mb-2">
              <div>
                <label className="text-[11px] font-bold uppercase tracking-widest text-white/40">
                  {t("vaultDrip.cadence", { defaultValue: "Days between drops" })}
                </label>
                <input type="number" min={1} max={30} value={cadenceDays} onChange={(e) => setCadenceDays(e.target.value)} className={`${inputClass} mt-1.5`} />
              </div>
              <div>
                <label className="text-[11px] font-bold uppercase tracking-widest text-white/40">
                  {t("vaultDrip.start", { defaultValue: "First drop" })}
                </label>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={`${inputClass} mt-1.5`} />
              </div>
            </div>

            <button
              type="button"
              onClick={buildPlan}
              disabled={picked.size === 0}
              className="mt-4 inline-flex items-center gap-2 rounded-xl border border-primary/50 bg-primary/10 px-6 py-3 text-sm font-black text-primary transition hover:bg-primary/20 disabled:opacity-40"
            >
              <Plus className="h-4 w-4" />
              {t("vaultDrip.buildPlan", { defaultValue: "Build Drip Plan" })}
            </button>
          </>
        )}
      </div>

      {plan.length > 0 && (
        <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-6 md:p-8">
          <h4 className="text-base font-black text-white mb-4">{t("vaultDrip.plan", { defaultValue: "Your drip calendar" })}</h4>
          <div className="space-y-2.5 mb-6">
            {plan.map((item, i) => (
              <div key={i} className="flex items-center gap-4 rounded-xl border border-white/10 bg-black/40 px-4 py-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-sm font-black text-primary">
                  {i + 1}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-white truncate">{item.title}</p>
                  <p className="text-xs text-white/45">
                    {item.dropDate.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                  </p>
                </div>
              </div>
            ))}
          </div>
          {error && <p className="mb-4 text-sm text-red-400">{error}</p>}
          <button
            type="button"
            onClick={createDrafts}
            disabled={creating || done}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-[#f7dd7f] to-[#C9A84C] px-6 py-3 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-40"
          >
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : done ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {done
              ? t("vaultDrip.draftsDone", { defaultValue: "Drafts created" })
              : t("vaultDrip.createDrafts", { defaultValue: "Create Free Drafts" })}
          </button>
        </div>
      )}
    </div>
  );
}
