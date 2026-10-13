import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { User, AlertCircle, Loader2, CheckCircle2 } from "lucide-react";

/* ─── AvatarPresenterPanel ────────────────────────────────────────────
   AI avatar / talking-head presenter option, docked inside the video
   creation flow (make-video Step 3 — Video Direction). NOT a standalone
   page: the presenter choice travels with the video plan as part of the
   form values and can later drive scene-level presenter shots.

   Provider: HeyGen or Hedra (chosen via server env). No key is configured
   yet — the panel gates with a clear disabled message and never charges. */

export interface AvatarPresenterConfig {
  mode: "none" | "ai-avatar";
  avatarId: string;
  script: string;
  voiceId: string;
}

export const EMPTY_PRESENTER: AvatarPresenterConfig = {
  mode: "none",
  avatarId: "",
  script: "",
  voiceId: "",
};

interface StatusResponse {
  configured?: boolean;
  provider?: string | null;
  catalog?: Array<{ id: string; name: string; style: string }>;
  creditCost?: number;
  pricePlaceholder?: boolean;
}

interface AvatarPresenterPanelProps {
  value: AvatarPresenterConfig;
  onChange: (next: AvatarPresenterConfig) => void;
}

export function AvatarPresenterPanel({ value, onChange }: AvatarPresenterPanelProps) {
  const isLight = useIsLightTheme();
  const { t } = useTranslation();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/avatar-presenter/status");
        if (res.ok) {
          const data = (await res.json()) as StatusResponse;
          if (alive) setStatus(data);
        }
      } catch {
        /* gate stays closed on network error */
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const configured = status?.configured === true;
  const catalog = status?.catalog ?? [];
  const cost = status?.creditCost;

  function set(patch: Partial<AvatarPresenterConfig>) {
    onChange({ ...value, ...patch });
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-5 space-y-4" data-testid="avatar-presenter-panel">
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
          <User className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-black text-white uppercase tracking-wider">
            {t("avatarPresenter.title", { defaultValue: "AI Avatar Presenter" })}
          </h3>
          <p className="text-xs text-white/40 mt-0.5">
            {t("avatarPresenter.subtitle", { defaultValue: "A talking-head host that presents your video." })}
          </p>
        </div>
        {cost != null && (
          <span className="text-[10px] font-black text-primary/80 uppercase tracking-widest border border-primary/30 bg-primary/10 rounded-full px-2.5 py-1 shrink-0">
            {t("avatarPresenter.costBadge", { defaultValue: "{{cost}} VB", cost })}
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-white/40">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t("avatarPresenter.checking", { defaultValue: "Checking avatar provider…" })}
        </div>
      ) : !configured ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3">
          <AlertCircle className="h-4 w-4 text-amber-300/80 shrink-0 mt-0.5" />
          <p className="text-xs text-white/60 leading-relaxed">
            {t("avatarPresenter.notConfigured", {
              defaultValue:
                "AI avatars aren't connected yet — the site owner needs to add a HeyGen or Hedra API key before talking-head presenters can generate. Your video plan will note the presenter choice for later.",
            })}
          </p>
        </div>
      ) : (
        <div className="flex items-start gap-2.5 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] px-4 py-3">
          <CheckCircle2 className="h-4 w-4 text-emerald-300/80 shrink-0 mt-0.5" />
          <p className="text-xs text-white/60 leading-relaxed">
            {t("avatarPresenter.ready", {
              defaultValue: "Avatar provider connected ({{provider}}).",
              provider: status?.provider ?? "—",
            })}
          </p>
        </div>
      )}

      {/* Mode choice */}
      <div className="grid grid-cols-2 gap-2">
        {(
          [
            { mode: "none", labelKey: "avatarPresenter.modeNone", fallback: "No presenter" },
            { mode: "ai-avatar", labelKey: "avatarPresenter.modeAvatar", fallback: "AI avatar presenter" },
          ] as const
        ).map((m) => (
          <button
            key={m.mode}
            type="button"
            onClick={() => set({ mode: m.mode })}
            className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
              value.mode === m.mode
                ? "border-primary/50 bg-primary/[0.07]"
                : "border-white/10 bg-white/[0.02] hover:border-white/25"
            }`}
          >
            <p className="text-xs font-bold text-white">{t(m.labelKey, { defaultValue: m.fallback })}</p>
          </button>
        ))}
      </div>

      {value.mode === "ai-avatar" && (
        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-white/60 uppercase tracking-wider">
              {t("avatarPresenter.avatarLabel", { defaultValue: "Avatar" })}
            </label>
            <select
              value={value.avatarId}
              onChange={(e) => set({ avatarId: e.target.value })}
              className="mt-1.5 h-11 w-full rounded-xl bg-white/[0.04] border border-white/[0.08] text-white px-3 text-sm focus:outline-none focus:border-primary/50 transition-colors appearance-none cursor-pointer"
              style={{ colorScheme: "dark" }}
            >
              <option value="" disabled style={{ background: isLight ? "#FAF6ED" : "#111" }}>
                {t("avatarPresenter.avatarPlaceholder", { defaultValue: "Choose an avatar…" })}
              </option>
              {catalog.map((a) => (
                <option key={a.id} value={a.id} style={{ background: isLight ? "#FAF6ED" : "#111" }}>
                  {a.name} — {a.style}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-white/60 uppercase tracking-wider">
              {t("avatarPresenter.scriptLabel", { defaultValue: "Presenter script" })}
            </label>
            <textarea
              value={value.script}
              onChange={(e) => set({ script: e.target.value.slice(0, 4000) })}
              placeholder={t("avatarPresenter.scriptPlaceholder", { defaultValue: "What should the presenter say? (saved with your plan — generation unlocks when the provider is connected)" })}
              className="mt-1.5 w-full min-h-[90px] bg-white/[0.04] border border-white/[0.08] text-white placeholder:text-white/25 focus:border-primary/50 transition-colors rounded-xl resize-none p-3 text-sm"
            />
          </div>
          {!configured && (
            <p className="text-[11px] text-white/35 leading-relaxed">
              {t("avatarPresenter.savedNote", {
                defaultValue: "Your presenter choice is saved with the video plan. Generation itself stays disabled until the provider key is added — you won't be charged.",
              })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
