import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { AlertTriangle, ArrowRight, Flame, RotateCcw } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";

/* ─── Viral-spike response kit — Promote surface (orphan wave) ─────────
   Asks the server for a fresh check (GET /api/viral-spike-kits) and
   renders what comes back — and ONLY what comes back:

   - a kit's headline and numbers are built server-side from MEASURED
     view velocity; this panel never computes or invents a figure.
   - every step is a LINK to an existing tool in CREATE → BRAND →
     PROMOTE → MONEY order. The kit never posts, pins, or acts —
     the creator opens each step themselves.
   - honest empty states: while the view history is still being
     measured the panel says exactly that; when the creator has
     opted out in Settings it says so and points there. */

interface KitStepWire {
  stage: "create" | "brand" | "promote" | "money";
  action: string;
  title: string;
  detail: string;
  href: string;
  tool: string;
  requires_creator_action: true;
}

interface KitWire {
  content: { kind: string; id: string; title: string; slug?: string | null };
  headline: string;
  basis: string;
  steps: KitStepWire[];
  auto_actions_taken: 0;
}

type CheckWire =
  | { status: "disabled"; sampled: 0; kits: KitWire[]; measuring: 0 }
  | { status: "ok"; sampled: number; kits: KitWire[]; measuring: number };

const STAGE_ORDER: KitStepWire["stage"][] = ["create", "brand", "promote", "money"];

export function ViralSpikeKitPanel() {
  const isLight = useIsLightTheme();
  const { t } = useTranslation();
  const { user, getAccessToken } = useAuth();
  const [result, setResult] = useState<CheckWire | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoadError(false);
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/viral-spike-kits", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error("load failed");
        const d = (await res.json()) as CheckWire;
        if (!cancelled) setResult(d);
      } catch {
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => { cancelled = true; };
  }, [user, getAccessToken, retryNonce]);

  if (!user) return null;

  const cardClass = `rounded-2xl border p-6 md:p-8 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-white/[0.05] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-white/[0.05] to-[#0d0a04]"}`;
  const headingClass = `text-base font-black ${isLight ? "text-[#2A1E07]" : "text-white"}`;
  const subClass = `mt-0.5 text-xs ${isLight ? "text-[#5c5138]" : "text-white/40"}`;

  return (
    <section className={cardClass} data-testid="viral-spike-kit-panel">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/[0.12]">
          <Flame className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className={headingClass}>{t("promote.viralSpike.title")}</h2>
          <p className={subClass}>{t("promote.viralSpike.subtitle")}</p>
        </div>
      </div>

      {loadError ? (
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/[0.06] p-4 text-sm text-red-200/80">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {t("promote.viralSpike.loadError")}
          <button
            type="button"
            onClick={() => setRetryNonce((n) => n + 1)}
            className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-bold text-white/80 hover:bg-white/5"
          >
            <RotateCcw className="h-3.5 w-3.5" /> {t("promote.viralSpike.retry")}
          </button>
        </div>
      ) : result === null ? (
        <p className={`mt-4 text-sm ${isLight ? "text-[#5c5138]" : "text-white/45"}`}>
          {t("promote.viralSpike.loading")}
        </p>
      ) : result.status === "disabled" ? (
        <div className="mt-4">
          <p className={`text-sm font-bold ${isLight ? "text-[#2A1E07]" : "text-white"}`}>
            {t("promote.viralSpike.disabledTitle")}
          </p>
          <p className={`mt-1 text-xs leading-relaxed ${isLight ? "text-[#5c5138]" : "text-white/40"}`}>
            {t("promote.viralSpike.disabledDesc")}
          </p>
          <Link
            href="/settings"
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-bold text-primary transition hover:gap-2.5"
          >
            {t("promote.viralSpike.settingsCta")} <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      ) : result.kits.length === 0 ? (
        <div className="mt-4">
          <p className={`text-sm font-bold ${isLight ? "text-[#2A1E07]" : "text-white"}`}>
            {t(
              result.sampled === 0
                ? "promote.viralSpike.noContentTitle"
                : result.measuring > 0
                  ? "promote.viralSpike.measuringTitle"
                  : "promote.viralSpike.quietTitle",
            )}
          </p>
          <p className={`mt-1 text-xs leading-relaxed ${isLight ? "text-[#5c5138]" : "text-white/40"}`}>
            {t(
              result.sampled === 0
                ? "promote.viralSpike.noContentDesc"
                : result.measuring > 0
                  ? "promote.viralSpike.measuringDesc"
                  : "promote.viralSpike.quietDesc",
              { count: result.measuring },
            )}
          </p>
        </div>
      ) : (
        <div className="mt-5 space-y-6">
          {result.kits.map((kit) => (
            <article
              key={`${kit.content.kind}-${kit.content.id}`}
              className={`rounded-xl border p-5 ${isLight ? "border-[#C9A84C]/30 bg-[#F7ECD2]/70" : "border-white/10 bg-black/50"}`}
            >
              <p className={`text-[15px] font-bold leading-relaxed ${isLight ? "text-[#2A1E07]" : "text-white/90"}`}>
                {kit.headline}
              </p>
              <div className="mt-4 space-y-1.5">
                {STAGE_ORDER.flatMap((stage) =>
                  kit.steps
                    .filter((s) => s.stage === stage)
                    .map((step) => (
                      <Link
                        key={step.action}
                        href={step.href}
                        className="group flex items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-white/5"
                      >
                        <span className="inline-flex w-20 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/[0.08] px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-primary">
                          {t(`promote.viralSpike.stage.${stage}`)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className={`block text-sm font-bold ${isLight ? "text-[#2A1E07]" : "text-white"}`}>
                            {step.title}
                          </span>
                          <span className={`block text-xs leading-relaxed ${isLight ? "text-[#5c5138]" : "text-white/45"}`}>
                            {step.detail} · {step.tool}
                          </span>
                        </span>
                        <ArrowRight className="h-4 w-4 shrink-0 text-primary transition group-hover:translate-x-0.5" />
                      </Link>
                    )),
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
