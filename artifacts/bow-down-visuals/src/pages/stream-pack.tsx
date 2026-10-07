import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  Clapperboard, Loader2, Download, AlertTriangle, CheckCircle2,
  ArrowLeft, Sparkles, RefreshCw, Image as ImageIcon, Layers,
  MonitorPlay, Bell, LayoutPanelTop, Tv,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { OutOfCredits } from "@/components/OutOfCredits";
import { usePageTitle } from "@/hooks/use-page-title";
import { useTranslation } from "react-i18next";

/* ─── Stream Pack Generator ───────────────────────────────────────────────
   One-click branded asset bundles for streamers: overlay frames, alert
   graphics, info panels, and stream screens — all AI-generated in your
   channel's theme. 1 credit per asset (it burns GPU, so it charges).
   Honest framing: these are static graphics — alerts pop, they don't
   animate — and AI can't render true transparency, so layer the frames
   over your scene in OBS. */

interface ThemeInfo {
  id: string;
  name: string;
  blurb: string;
  swatches: [string, string, string];
}

interface AssetInfo {
  key: string;
  label: string;
  group: "Overlays" | "Alerts" | "Panels" | "Screens";
  blurb: string;
  size: string;
}

interface GeneratedAsset {
  key: string;
  label: string;
  url: string;
  path: string | null;
}

type AssetState = "pending" | "working" | "done" | "failed";

const GROUP_ICONS: Record<AssetInfo["group"], typeof Layers> = {
  Overlays: Layers,
  Alerts: Bell,
  Panels: LayoutPanelTop,
  Screens: Tv,
};

const GROUP_ORDER: Array<AssetInfo["group"]> = ["Overlays", "Alerts", "Panels", "Screens"];

/* Fallback catalog if the API is unreachable — mirrors the server list. */
const FALLBACK_CREDIT_COST = 1;

export function StreamPackTool() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const [channelName, setChannelName] = useState("");
  const [themes, setThemes] = useState<ThemeInfo[]>([]);
  const [assets, setAssets] = useState<AssetInfo[]>([]);
  const [creditCost, setCreditCost] = useState(FALLBACK_CREDIT_COST);
  const [themeId, setThemeId] = useState("gold-luxury");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [states, setStates] = useState<Record<string, AssetState>>({});
  const [results, setResults] = useState<Record<string, GeneratedAsset>>({});
  const [failedMsg, setFailedMsg] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [doneCount, setDoneCount] = useState(0);

  /* Load the catalog (free endpoint) — themes + assets + price. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/stream-pack/catalog");
        if (!res.ok) return;
        const data = await res.json() as {
          themes?: ThemeInfo[]; assets?: AssetInfo[]; creditCostPerImage?: number;
        };
        if (cancelled) return;
        if (data.themes?.length) setThemes(data.themes);
        if (data.assets?.length) {
          setAssets(data.assets);
          setSelected(new Set(data.assets.map((a) => a.key)));
        }
        if (typeof data.creditCostPerImage === "number") setCreditCost(data.creditCostPerImage);
      } catch { /* fallback: page still renders, generation will surface errors */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const selectedAssets = assets.filter((a) => selected.has(a.key));
  const totalCost = selectedAssets.length * creditCost;
  const activeTheme = themes.find((theme) => theme.id === themeId);

  function toggleAsset(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleGroup(group: AssetInfo["group"]) {
    const groupKeys = assets.filter((a) => a.group === group).map((a) => a.key);
    setSelected((prev) => {
      const next = new Set(prev);
      const allOn = groupKeys.every((k) => next.has(k));
      for (const k of groupKeys) {
        if (allOn) next.delete(k);
        else next.add(k);
      }
      return next;
    });
  }

  async function generateOne(assetKey: string): Promise<boolean> {
    setStates((s) => ({ ...s, [assetKey]: "working" }));
    setFailedMsg((f) => {
      const next = { ...f };
      delete next[assetKey];
      return next;
    });
    try {
      const res = await confirmedFetch("/api/stream-pack/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelName: channelName.trim(), theme: themeId, asset: assetKey }),
      });
      if (!res) {
        setStates((s) => ({ ...s, [assetKey]: "pending" }));
        return false;
      }
      const data = await res.json() as {
        url?: string; path?: string | null; label?: string; error?: string; message?: string;
      };
      if (res.status === 402) {
        setOutOfCredits(true);
        setStates((s) => ({ ...s, [assetKey]: "failed" }));
        setFailedMsg((f) => ({ ...f, [assetKey]: t("streamPack.errorOutOfCredits") }));
        return false;
      }
      if (!res.ok || !data.url) {
        setStates((s) => ({ ...s, [assetKey]: "failed" }));
        setFailedMsg((f) => ({ ...f, [assetKey]: data.message || data.error || t("streamPack.errorGenerationFailed") }));
        return false;
      }
      const label = assets.find((a) => a.key === assetKey)?.label ?? assetKey;
      setResults((r) => ({ ...r, [assetKey]: { key: assetKey, label, url: data.url!, path: data.path ?? null } }));
      setStates((s) => ({ ...s, [assetKey]: "done" }));
      setDoneCount((c) => c + 1);
      return true;
    } catch {
      setStates((s) => ({ ...s, [assetKey]: "failed" }));
      setFailedMsg((f) => ({ ...f, [assetKey]: t("streamPack.errorNetwork") }));
      return false;
    }
  }

  /* One click → generate every selected asset, sequentially, with progress. */
  async function generatePack() {
    if (!channelName.trim() || !user || generating || selectedAssets.length === 0) return;
    setGenerating(true);
    setError(null);
    setOutOfCredits(false);
    setDoneCount(0);
    for (const asset of selectedAssets) {
      // eslint-disable-next-line no-await-in-loop
      const ok = await generateOne(asset.key);
      if (!ok && outOfCredits) break;
    }
    setGenerating(false);
  }

  function downloadUrl(url: string, filename: string) {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  /* Download All: sequential individual downloads (no zip dep needed). */
  function downloadAll() {
    const done = selectedAssets.filter((a) => results[a.key]);
    done.forEach((a, i) => {
      window.setTimeout(() => {
        const r = results[a.key]!;
        downloadUrl(r.url, `stream-pack-${a.key}.png`);
      }, i * 600);
    });
  }

  const generatedList = selectedAssets.filter((a) => results[a.key]);
  const busy = generating;

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-white/40 hover:text-white/70 mb-6">
          <ArrowLeft className="h-4 w-4" /> {t("streamPack.back")}
        </Link>

        <div className="flex items-center gap-3 mb-2">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Clapperboard className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-black">{t("streamPack.pageTitle")}</h1>
            <p className="text-sm text-white/45">
              {t("streamPack.pageSubtitle", { cost: creditCost })}
            </p>
          </div>
        </div>

        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
          <Sparkles className="h-4 w-4 text-primary/70 shrink-0 mt-0.5" />
          <p className="text-xs text-white/55 leading-relaxed">
            {t("streamPack.infoBoxA")} <span className="text-white/80 font-semibold">{t("streamPack.infoBoxStatic")}</span> {t("streamPack.infoBoxB")}
          </p>
        </div>

        {outOfCredits && (
          <div className="mt-4"><OutOfCredits /></div>
        )}

        {error && (
          <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-red-500/25 bg-red-500/5 px-4 py-3">
            <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-sm text-red-200/80">{error}</p>
          </div>
        )}

        {/* ── Setup ── */}
        <div className="mt-6 space-y-6">
          <div>
            <label htmlFor="sp-channel" className="text-xs font-bold text-white/40 uppercase tracking-wider">
              {t("streamPack.channelNameLabel")}
            </label>
            <input
              id="sp-channel"
              value={channelName}
              onChange={(e) => setChannelName(e.target.value.slice(0, 40))}
              placeholder={t("streamPack.channelNamePlaceholder")}
              maxLength={40}
              className="mt-2 w-full rounded-xl border border-white/[0.12] bg-white/[0.03] px-4 py-3 text-white placeholder:text-white/25 outline-none focus:border-primary/60"
            />
          </div>

          <div data-min-stars="2">
            <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-2">{t("streamPack.themeLabel")}</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {themes.map((theme) => (
                <button
                  key={theme.id}
                  type="button"
                  onClick={() => setThemeId(theme.id)}
                  className={`rounded-xl border px-4 py-3.5 text-left transition ${
                    themeId === theme.id
                      ? "border-primary/60 bg-primary/[0.08]"
                      : "border-white/[0.08] bg-white/[0.02] hover:border-white/20"
                  }`}
                >
                  <span className="flex gap-1.5 mb-2">
                    {theme.swatches.map((c) => (
                      <span
                        key={c}
                        className="h-5 w-5 rounded-full border border-white/20"
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </span>
                  <p className="font-bold text-white text-sm">{theme.name}</p>
                  <p className="text-xs text-white/40 mt-0.5">{theme.blurb}</p>
                </button>
              ))}
            </div>
          </div>

          <div data-min-stars="5">
            <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-2">
              {t("streamPack.assetsTitle", { count: selectedAssets.length, cost: totalCost })}
            </p>
            <div className="space-y-4">
              {GROUP_ORDER.map((group) => {
                const groupAssets = assets.filter((a) => a.group === group);
                if (!groupAssets.length) return null;
                const Icon = GROUP_ICONS[group];
                const allOn = groupAssets.every((a) => selected.has(a.key));
                return (
                  <div key={group} className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
                    <button
                      type="button"
                      onClick={() => toggleGroup(group)}
                      className="flex w-full items-center gap-2 text-left"
                    >
                      <Icon className="h-4 w-4 text-primary/70" />
                      <span className="font-bold text-white text-sm">{group}</span>
                      <span className="ml-auto text-xs text-white/35">
                        {allOn ? t("streamPack.allOn") : `${groupAssets.filter((a) => selected.has(a.key)).length}/${groupAssets.length}`}
                      </span>
                    </button>
                    <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {groupAssets.map((a) => {
                        const st = states[a.key] ?? "pending";
                        return (
                          <label
                            key={a.key}
                            className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 transition ${
                              selected.has(a.key)
                                ? "border-primary/40 bg-primary/[0.06]"
                                : "border-white/[0.06] opacity-50"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={selected.has(a.key)}
                              onChange={() => toggleAsset(a.key)}
                              className="h-4 w-4 accent-yellow-500"
                            />
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-semibold text-white">{a.label}</span>
                              <span className="block truncate text-xs text-white/35">{a.blurb}</span>
                            </span>
                            {st === "working" && <Loader2 className="ml-auto h-4 w-4 animate-spin text-primary shrink-0" />}
                            {st === "done" && <CheckCircle2 className="ml-auto h-4 w-4 text-green-400 shrink-0" />}
                            {st === "failed" && <AlertTriangle className="ml-auto h-4 w-4 text-red-400 shrink-0" />}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <button
            onClick={generatePack}
            disabled={!channelName.trim() || !user || busy || selectedAssets.length === 0}
            className="w-full rounded-2xl bg-primary px-6 py-4 font-bold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-5 w-5 animate-spin" />
                {t("streamPack.generating", { done: doneCount, total: selectedAssets.length })}
              </span>
            ) : (
              <>{t("streamPack.generatePack", { cost: totalCost })}</>
            )}
          </button>

          {busy && (
            <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${selectedAssets.length ? (doneCount / selectedAssets.length) * 100 : 0}%` }}
              />
            </div>
          )}
        </div>

        {/* ── Gallery ── */}
        {generatedList.length > 0 && (
          <div className="mt-10">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-black text-white">
                {t("streamPack.yourPack")} {activeTheme ? <span className="text-white/40 font-semibold">· {activeTheme.name}</span> : null}
              </h2>
              <button
                onClick={downloadAll}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-black transition hover:brightness-110"
              >
                <Download className="h-4 w-4" /> {t("streamPack.downloadAll")}
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {generatedList.map((a) => {
                const r = results[a.key]!;
                return (
                  <div key={a.key} className="overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.02]">
                    <img src={r.url} alt={r.label} className="aspect-video w-full object-cover bg-black" loading="lazy" />
                    <div className="flex items-center gap-2 px-4 py-3">
                      <ImageIcon className="h-4 w-4 text-primary/70 shrink-0" />
                      <p className="truncate text-sm font-semibold text-white">{r.label}</p>
                      <span className="ml-auto flex gap-1.5 shrink-0">
                        <button
                          onClick={() => generateOne(a.key)}
                          title={t("streamPack.regenerate", { cost: creditCost * 100 })}
                          data-min-stars="3"
                          className="rounded-lg border border-white/[0.12] p-2 text-white/60 hover:border-white/25 hover:text-white transition"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => downloadUrl(r.url, `stream-pack-${a.key}.png`)}
                          title={t("streamPack.download")}
                          className="rounded-lg bg-primary p-2 text-black hover:brightness-110 transition"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
              <MonitorPlay className="h-4 w-4 text-primary/70 shrink-0 mt-0.5" />
              <p className="text-xs text-white/55 leading-relaxed">
                {t("streamPack.obsNote")}
              </p>
            </div>
          </div>
        )}

        {/* Failed assets with retry */}
        {Object.keys(failedMsg).length > 0 && !busy && (
          <div className="mt-6 space-y-2">
            {Object.entries(failedMsg).map(([key, msg]) => (
              <div key={key} className="flex items-center gap-2.5 rounded-xl border border-red-500/25 bg-red-500/5 px-4 py-3">
                <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
                <p className="text-sm text-red-200/80">
                  {assets.find((a) => a.key === key)?.label ?? key}: {msg}
                </p>
                <button
                  onClick={() => generateOne(key)}
                  className="ml-auto shrink-0 rounded-lg border border-white/[0.12] px-3 py-1.5 text-xs font-semibold text-white/70 hover:border-white/25 transition"
                >
                  {t("streamPack.retry")}
                </button>
              </div>
            ))}
          </div>
        )}
    </main>
  );
}

export default function StreamPack() {
  const { t } = useTranslation();
  usePageTitle(t("streamPack.pageTitle"), t("streamPack.pageDescription"));
  return (
    <div className="min-h-screen bg-black text-white">
      <StreamPackTool />

    </div>
  );
}
