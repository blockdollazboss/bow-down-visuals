import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { Switch } from "@/components/ui/switch";
import { Sparkles, AlertTriangle, RotateCcw, Scissors, ImagePlus, X, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

/* ── Second Life settings (UPGRADE #161, on Viral Spike Watch) ─────────
   Two controls for the back-catalog watch:
   1. THE OFF-SWITCH — catalog watching on/off per account
      (GET/PATCH /api/second-life/prefs; no row = ON, the shipped
      default). Off means the watch skips this catalog entirely: no
      spike alerts, no revival proposals.
   2. THE REVIVAL QUEUE — when an old track or video starts spiking,
      the watch records a PROPOSAL with the alert: re-cut it as a
      short + a fresh cover, as pre-loaded Create links carrying the
      spike's real numbers. Approving posts NOTHING — it just unlocks
      the plan's Create links, and the creator publishes from Create.
      Dismissing closes the proposal for good. */

interface SecondLifePrefs {
  watch_enabled: boolean;
}

interface RevivalStep {
  action: "recut_short" | "fresh_cover";
  createLink: string;
}

interface Revival {
  id: string;
  kind: "track" | "video";
  mediaId: string;
  currentPlays: number;
  baselineDaily: number;
  plan: { steps: RevivalStep[] };
  createdAt: string;
}

export function SecondLifeSettings() {
  const isLight = useIsLightTheme();
  const { t } = useTranslation();
  const { user, getAccessToken } = useAuth();
  const { toast } = useToast();
  const [prefs, setPrefs] = useState<SecondLifePrefs | null>(null);
  const [revivals, setRevivals] = useState<Revival[] | null>(null);
  const [approvedIds, setApprovedIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [deciding, setDeciding] = useState<string | null>(null);
  /* Honesty rule (same as the sound card): a failed load is NOT
     "everything on, queue empty" — failures get an error state with
     a retry, and the controls render only after a successful load. */
  const [loadError, setLoadError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoadError(false);
      try {
        const token = await getAccessToken();
        const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
        const [prefsRes, queueRes] = await Promise.all([
          fetch("/api/second-life/prefs", { headers }),
          fetch("/api/second-life/revivals?status=proposed", { headers }),
        ]);
        if (!prefsRes.ok || !queueRes.ok) throw new Error("load failed");
        const p = (await prefsRes.json()) as Partial<SecondLifePrefs>;
        const q = (await queueRes.json()) as { revivals?: Revival[] };
        if (cancelled) return;
        setPrefs({ watch_enabled: p.watch_enabled ?? true });
        setRevivals(Array.isArray(q.revivals) ? q.revivals : []);
      } catch {
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, getAccessToken, retryNonce]);

  async function toggleWatch(nextValue: boolean) {
    if (!prefs || saving) return;
    const prev = prefs.watch_enabled;
    setPrefs({ watch_enabled: nextValue }); // optimistic
    setSaving(true);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/second-life/prefs", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ watch_enabled: nextValue }),
      });
      if (!res.ok) throw new Error("save failed");
      const d = (await res.json()) as Partial<SecondLifePrefs>;
      setPrefs({ watch_enabled: d.watch_enabled ?? nextValue });
      toast({ title: t("settings.secondLife.saved") });
    } catch {
      setPrefs({ watch_enabled: prev }); // revert on failure
      toast({ title: t("settings.secondLife.saveFailed"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function decide(revival: Revival, status: "approved" | "dismissed") {
    if (deciding) return;
    setDeciding(revival.id);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/second-life/revivals/${revival.id}/decision`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("decision failed");
      if (status === "approved") {
        /* The plan unlocks in place: its Create links render under
           the proposal. Publishing stays the creator's act in Create. */
        setApprovedIds((s) => new Set(s).add(revival.id));
        toast({ title: t("settings.secondLife.approved") });
      } else {
        setRevivals((rows) => (rows ?? []).filter((r) => r.id !== revival.id));
        toast({ title: t("settings.secondLife.dismissed") });
      }
    } catch {
      toast({ title: t("settings.secondLife.decisionFailed"), variant: "destructive" });
    } finally {
      setDeciding(null);
    }
  }

  const watchOn = prefs?.watch_enabled ?? true;

  return (
    <section
      id="second-life"
      className={`rounded-3xl border p-5 md:p-6 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}
      data-testid="second-life-settings"
    >
      <div className="flex items-center gap-3 mb-1">
        <div className="h-10 w-10 rounded-xl bg-primary/[0.12] border border-primary/25 flex items-center justify-center shrink-0">
          <Sparkles className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className="text-base font-black text-white">{t("settings.secondLife.title")}</h2>
          <p className="text-xs text-white/40 mt-0.5">{t("settings.secondLife.subtitle")}</p>
        </div>
      </div>
      {loadError ? (
        <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/[0.06] p-4 text-sm text-red-200/80 flex items-center gap-3">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {t("settings.secondLife.loadError")}
          <button
            type="button"
            onClick={() => setRetryNonce((n) => n + 1)}
            className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-bold text-white/80 hover:bg-white/5"
          >
            <RotateCcw className="h-3.5 w-3.5" /> {t("settings.secondLife.retry")}
          </button>
        </div>
      ) : (
        <div className="mt-4">
          <div className="flex items-center gap-4 py-3.5 border-b border-white/[0.08]">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-white">{t("settings.secondLife.watch.title")}</p>
              <p className="text-[11px] text-white/35 mt-0.5 leading-relaxed">{t("settings.secondLife.watch.desc")}</p>
            </div>
            <Switch
              checked={watchOn}
              disabled={!prefs || saving}
              onCheckedChange={(v: boolean) => toggleWatch(v)}
              aria-label={t("settings.secondLife.watch.title")}
            />
          </div>

          <div className={watchOn ? "" : "opacity-50"}>
            <p className="text-sm font-bold text-white mt-4">{t("settings.secondLife.queueTitle")}</p>
            {revivals === null ? (
              <p className="text-[11px] text-white/35 mt-1.5">{t("settings.secondLife.queueLoading")}</p>
            ) : revivals.length === 0 ? (
              <p className="text-[11px] text-white/35 mt-1.5 leading-relaxed">{t("settings.secondLife.queueEmpty")}</p>
            ) : (
              <div className="divide-y divide-white/[0.05]">
                {revivals.map((r) => {
                  const approved = approvedIds.has(r.id);
                  return (
                    <div key={r.id} className="py-3.5" data-testid="second-life-revival">
                      <p className="text-sm font-bold text-white">
                        {t(r.kind === "video" ? "settings.secondLife.spikingVideo" : "settings.secondLife.spikingTrack")}
                      </p>
                      <p className="text-[11px] text-white/35 mt-0.5 leading-relaxed">
                        {t("settings.secondLife.spikeNumbers", {
                          current: r.currentPlays,
                          baseline: r.baselineDaily,
                        })}
                      </p>
                      {approved ? (
                        <div className="mt-2.5 flex flex-wrap gap-2">
                          {r.plan.steps.map((step) => (
                            <Link
                              key={step.action}
                              href={step.createLink}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-black transition hover:brightness-110"
                            >
                              {step.action === "recut_short" ? (
                                <Scissors className="h-3.5 w-3.5" />
                              ) : (
                                <ImagePlus className="h-3.5 w-3.5" />
                              )}
                              {t(step.action === "recut_short" ? "settings.secondLife.recut" : "settings.secondLife.freshCover")}
                            </Link>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-2.5 flex gap-2">
                          <button
                            type="button"
                            disabled={deciding !== null}
                            onClick={() => decide(r, "approved")}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-black transition hover:brightness-110 disabled:opacity-50"
                          >
                            <Check className="h-3.5 w-3.5" /> {t("settings.secondLife.approve")}
                          </button>
                          <button
                            type="button"
                            disabled={deciding !== null}
                            onClick={() => decide(r, "dismissed")}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-bold text-white/80 transition hover:bg-white/5 disabled:opacity-50"
                          >
                            <X className="h-3.5 w-3.5" /> {t("settings.secondLife.dismiss")}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <p className="mt-3 text-[11px] text-white/35 leading-relaxed">{t("settings.secondLife.neverAutoPost")}</p>
          </div>
        </div>
      )}
    </section>
  );
}
