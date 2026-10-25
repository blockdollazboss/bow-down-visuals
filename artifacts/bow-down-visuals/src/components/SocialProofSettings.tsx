import { useEffect, useState, type ComponentType } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { BadgeCheck, Loader2, RefreshCw, AlertTriangle, RotateCcw } from "lucide-react";
import { InstagramIcon } from "@/components/ui/instagram-icon";
import { TikTokIcon } from "@/components/ui/tiktok-icon";
import { FacebookIcon } from "@/components/ui/facebook-icon";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/contexts/AuthContext";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";

/* ─── Social proof settings (C5) — the creator's control panel for the
   verified audience figures on their public profile. Every figure here
   came from a connected account's own platform rail; each carries its
   source account and the moment it was measured, and each has its own
   off switch (house law: promotional surfaces ship with one). Hidden
   figures vanish from the profile for everyone, instantly. ── */

interface OwnerFigure {
  key: string;
  platform: string;
  accountId: string;
  accountLabel: string;
  label: string;
  value: number;
  fetchedAt: string;
  visible: boolean;
  connected: boolean;
}

interface ProofState {
  hasProfile: boolean;
  figures: OwnerFigure[];
  hiddenKeys: string[];
  refreshedAt: string | null;
  stale: boolean;
  connectedPlatforms: string[];
}

const PLATFORM_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  instagram: InstagramIcon,
  tiktok: TikTokIcon,
  facebook: FacebookIcon,
};

function dateLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function SocialProofSettings() {
  const { t } = useTranslation();
  const isLight = useIsLightTheme();
  const { getAccessToken } = useAuth();
  const [state, setState] = useState<ProofState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  /* 503 social_proof_not_ready (a backing table isn't on this database
     yet — migration 0241) is an honest "isn't switched on yet" state,
     rendered plainly — never the broken error card. */
  const [unavailable, setUnavailable] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
    const token = await getAccessToken();
    return fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
  }

  async function load() {
    setLoading(true);
    try {
      const res = await authedFetch("/api/social-proof/me");
      if (res.status === 503) {
        setUnavailable(true);
        setLoadError(false);
        return;
      }
      if (!res.ok) throw new Error("load failed");
      setState((await res.json()) as ProofState);
      setLoadError(false);
      setUnavailable(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/social-proof/me", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!cancelled && res.status === 503) {
          setUnavailable(true);
          setLoadError(false);
          return;
        }
        if (!res.ok) throw new Error("load failed");
        const data = (await res.json()) as ProofState;
        if (!cancelled) {
          setState(data);
          setLoadError(false);
          setUnavailable(false);
        }
      } catch {
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh() {
    setRefreshing(true);
    setActionError(null);
    try {
      const res = await authedFetch("/api/social-proof/refresh", { method: "POST" });
      if (!res.ok) throw new Error("refresh failed");
      setState((await res.json()) as ProofState);
    } catch {
      setActionError(t("social-proof.refreshError"));
    } finally {
      setRefreshing(false);
    }
  }

  async function toggle(figure: OwnerFigure, show: boolean) {
    if (!state) return;
    setSavingKey(figure.key);
    setActionError(null);
    const hiddenKeys = show
      ? state.hiddenKeys.filter((k) => k !== figure.key)
      : [...new Set([...state.hiddenKeys, figure.key])];
    /* Optimistic: flip now, revert if the save refuses. */
    setState({
      ...state,
      hiddenKeys,
      figures: state.figures.map((f) => (f.key === figure.key ? { ...f, visible: show } : f)),
    });
    try {
      const res = await authedFetch("/api/social-proof/visibility", {
        method: "PUT",
        body: JSON.stringify({ hiddenKeys }),
      });
      if (!res.ok) throw new Error("save failed");
      setState((await res.json()) as ProofState);
    } catch {
      setActionError(t("social-proof.saveError"));
      setState(state);
    } finally {
      setSavingKey(null);
    }
  }

  const card = isLight
    ? "rounded-2xl border border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3] p-6"
    : "rounded-2xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04] p-6";
  const sub = isLight ? "text-[#6B5B36]" : "text-white/50";
  const head = isLight ? "text-zinc-900" : "text-white";

  return (
    <section className={card} data-testid="social-proof-settings">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-primary/30 bg-primary/10">
            <BadgeCheck className="h-4 w-4 text-primary" />
          </span>
          <div>
            <h2 className={`text-lg font-black tracking-tight ${head}`}>{t("social-proof.title")}</h2>
            <p className={`text-xs ${sub}`}>{t("social-proof.description")}</p>
          </div>
        </div>
        {state?.hasProfile && state.connectedPlatforms.length > 0 && (
          <button
            type="button"
            onClick={() => { void refresh(); }}
            disabled={refreshing}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-primary/40 bg-primary/10 px-3.5 py-2 text-xs font-bold text-primary transition hover:bg-primary/20 disabled:opacity-50"
          >
            {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {refreshing ? t("social-proof.refreshing") : t("social-proof.refresh")}
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : unavailable ? (
        <p className={`mt-4 text-sm ${sub}`}>{t("social-proof.notReady")}</p>
      ) : loadError ? (
        <div className="py-6 text-center">
          <AlertTriangle className="mx-auto h-6 w-6 text-amber-400" />
          <p className={`mt-2 text-sm ${sub}`}>{t("social-proof.loadError")}</p>
          <button
            type="button"
            onClick={() => { void load(); }}
            className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-primary/40 bg-primary/10 px-4 py-2 text-xs font-bold text-primary transition hover:bg-primary/20"
          >
            <RotateCcw className="h-3.5 w-3.5" /> {t("social-proof.retry")}
          </button>
        </div>
      ) : !state?.hasProfile ? (
        <p className={`mt-4 text-sm ${sub}`}>
          {t("social-proof.noProfile")}{" "}
          <Link href="/artist-setup" className="font-bold text-primary underline underline-offset-2">
            {t("social-proof.noProfileCta")}
          </Link>
        </p>
      ) : state.connectedPlatforms.length === 0 ? (
        <p className={`mt-4 text-sm ${sub}`}>{t("social-proof.noAccounts")}</p>
      ) : state.figures.length === 0 ? (
        <p className={`mt-4 text-sm ${sub}`}>{t("social-proof.noFigures")}</p>
      ) : (
        <>
          <div className="mt-5 space-y-3">
            {state.figures.map((f) => {
              const Icon = PLATFORM_ICONS[f.platform];
              return (
                <div
                  key={f.key}
                  className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${
                    isLight ? "border-[#C9A84C]/30 bg-white/50" : "border-white/10 bg-white/[0.03]"
                  } ${!f.connected ? "opacity-55" : ""}`}
                >
                  {Icon ? <Icon className="h-5 w-5 shrink-0" /> : null}
                  <div className="min-w-0 flex-1 leading-tight">
                    <div className={`text-sm font-black tabular-nums ${head}`}>
                      {new Intl.NumberFormat("en-US").format(f.value)}
                      <span className={`ml-1.5 text-xs font-semibold ${sub}`}>{f.label}</span>
                    </div>
                    <div className={`truncate text-[11px] ${sub}`}>
                      {f.accountLabel ? `@${f.accountLabel.replace(/^@/, "")} · ` : ""}
                      {t("social-proof.updated", { date: dateLabel(f.fetchedAt) })}
                      {!f.connected && <> · {t("social-proof.disconnected")}</>}
                    </div>
                  </div>
                  <Switch
                    checked={f.visible && f.connected}
                    disabled={!f.connected || savingKey === f.key}
                    onCheckedChange={(show) => { void toggle(f, show); }}
                    aria-label={f.label}
                  />
                </div>
              );
            })}
          </div>
          {state.refreshedAt && (
            <p className={`mt-4 text-[11px] ${sub}`}>
              {t("social-proof.lastSync", { date: dateLabel(state.refreshedAt) })}
            </p>
          )}
        </>
      )}

      {actionError && <p className="mt-4 text-sm text-red-400">{actionError}</p>}
    </section>
  );
}
