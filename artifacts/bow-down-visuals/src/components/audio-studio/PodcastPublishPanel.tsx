/* ─── Podcast Publish Panel — your hosted RSS feed ──────────────────────
   Docks under Podcast Studio in the Audio Studio podcast tab. A creator
   whose episodes live on their creator profile (profile_tracks) gets ONE
   permanent RSS 2.0 + iTunes feed at /api/podcast-feed/<slug>, rendered
   from the live rows on every request — publish or unpublish an episode
   and the feed follows automatically.

   Honesty rule (owner law): the directories' submission is the creator's
   ONE-TIME MANUAL step in their own Apple / Spotify accounts. We host
   and maintain the feed; we never claim to submit it for them. */

import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import {
  Rss, Copy, Check, Loader2, AlertTriangle, ExternalLink, Save,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

interface FeedSettings {
  title?: string;
  description?: string;
  author?: string;
  category?: string;
  subcategory?: string;
  explicit?: boolean;
  artworkUrl?: string;
  language?: string;
}

interface MeResponse {
  hasProfile: boolean;
  slug?: string;
  feedUrl?: string;
  profilePublic?: boolean;
  episodeCount?: number;
  settings?: FeedSettings;
  defaults?: {
    title?: string | null;
    description?: string | null;
    author?: string | null;
    artworkUrl?: string | null;
  };
  categories?: Record<string, readonly string[]>;
}

const APPLE_URL = "https://podcasters.apple.com";
const SPOTIFY_URL = "https://podcasters.spotify.com";

export function PodcastPublishPanel() {
  const { t } = useTranslation();
  const { getAccessToken } = useAuth();
  const isLight = useIsLightTheme();

  const [me, setMe] = useState<MeResponse | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [copied, setCopied] = useState(false);
  const [form, setForm] = useState<FeedSettings>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(false);

  const load = useCallback(async () => {
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/podcast-feed/me", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as MeResponse;
      setMe(data);
      setForm(data.settings ?? {});
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [getAccessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const set = (key: keyof FeedSettings, value: string | boolean | undefined) => {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  };

  const copyFeedUrl = async () => {
    if (!me?.feedUrl) return;
    try {
      await navigator.clipboard.writeText(me.feedUrl);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = me.feedUrl;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const save = async () => {
    setSaving(true);
    setSaveError(false);
    try {
      const token = await getAccessToken();
      const body: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(form)) {
        body[k] = v === "" || v === undefined ? null : v;
      }
      const res = await fetch("/api/podcast-feed/me/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { settings?: FeedSettings };
      setForm(data.settings ?? {});
      setSaved(true);
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-2.5 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";
  const labelClass = "block text-xs font-bold uppercase tracking-wider text-white/45 mb-1.5";
  const shell = isLight
    ? "border-[#C9A84C]/40 bg-[#FFFDF6]"
    : "border-white/[0.08] bg-black/30";

  return (
    <section className={`rounded-3xl border p-5 sm:p-6 ${shell}`}>
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/15 text-primary">
          <Rss className="h-5 w-5" />
        </span>
        <div>
          <h3 className={`text-lg font-black ${isLight ? "text-[#3d2f06]" : "text-white"}`}>
            {t("podcast.publish.heading")}
          </h3>
          <p className={`text-xs ${isLight ? "text-[#6b5510]" : "text-white/45"}`}>
            {t("podcast.publish.intro")}
          </p>
        </div>
      </div>

      {me === null && !loadError && (
        <div className="mt-6 flex items-center gap-2 text-sm text-white/50">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("podcast.publish.loading")}
        </div>
      )}

      {loadError && (
        <div className="mt-6 flex items-start gap-2 rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{t("podcast.publish.loadError")}</span>
        </div>
      )}

      {me && !me.hasProfile && (
        <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-4 text-sm text-white/70">
          {t("podcast.publish.noProfile")}{" "}
          <Link href="/artist-setup" className="font-bold text-primary underline underline-offset-2">
            {t("podcast.publish.noProfileCta")}
          </Link>
        </div>
      )}

      {me?.hasProfile && (
        <div className="mt-6 space-y-6">
          {/* ── The feed URL ── */}
          <div>
            <label className={labelClass} htmlFor="podcast-feed-url">
              {t("podcast.publish.feedUrlLabel")}
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                id="podcast-feed-url"
                readOnly
                value={me.feedUrl ?? ""}
                onFocus={(e) => e.target.select()}
                className={`${inputClass} font-mono text-xs sm:flex-1`}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={copyFeedUrl}
                  className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-black transition hover:brightness-110"
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? t("podcast.publish.copied") : t("podcast.publish.copy")}
                </button>
                <a
                  href={me.feedUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 rounded-xl border border-white/15 px-4 py-2.5 text-sm font-bold text-white/80 transition hover:border-white/35 hover:text-white"
                >
                  <ExternalLink className="h-4 w-4" />
                  {t("podcast.publish.openFeed")}
                </a>
              </div>
            </div>
            <p className="mt-2 text-xs text-white/40">
              {t("podcast.publish.episodeCount", { count: me.episodeCount ?? 0 })}
            </p>
            {(me.episodeCount ?? 0) === 0 && (
              <p className="mt-1 text-xs text-amber-200/80">{t("podcast.publish.noEpisodes")}</p>
            )}
            {!me.profilePublic && (
              <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{t("podcast.publish.profilePrivate")}</span>
              </div>
            )}
          </div>

          {/* ── Show settings ── */}
          <div>
            <h4 className={`text-sm font-black ${isLight ? "text-[#3d2f06]" : "text-white"}`}>
              {t("podcast.publish.settingsHeading")}
            </h4>
            <p className="mt-1 text-xs text-white/40">{t("podcast.publish.defaultsNote")}</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="pf-title">{t("podcast.publish.fieldTitle")}</label>
                <input
                  id="pf-title"
                  className={inputClass}
                  value={form.title ?? ""}
                  placeholder={me.defaults?.title ?? ""}
                  onChange={(e) => set("title", e.target.value)}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="pf-author">{t("podcast.publish.fieldAuthor")}</label>
                <input
                  id="pf-author"
                  className={inputClass}
                  value={form.author ?? ""}
                  placeholder={me.defaults?.author ?? ""}
                  onChange={(e) => set("author", e.target.value)}
                />
              </div>
              <div className="sm:col-span-2">
                <label className={labelClass} htmlFor="pf-desc">{t("podcast.publish.fieldDescription")}</label>
                <textarea
                  id="pf-desc"
                  className={inputClass}
                  rows={3}
                  value={form.description ?? ""}
                  placeholder={me.defaults?.description ?? ""}
                  onChange={(e) => set("description", e.target.value)}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="pf-category">{t("podcast.publish.fieldCategory")}</label>
                <select
                  id="pf-category"
                  className={inputClass}
                  value={form.category ?? ""}
                  onChange={(e) => {
                    set("category", e.target.value || undefined);
                    set("subcategory", undefined);
                  }}
                >
                  <option value="">{t("podcast.publish.noneOption")}</option>
                  {Object.keys(me.categories ?? {}).map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass} htmlFor="pf-subcategory">{t("podcast.publish.fieldSubcategory")}</label>
                <select
                  id="pf-subcategory"
                  className={inputClass}
                  value={form.subcategory ?? ""}
                  disabled={!form.category || (me.categories?.[form.category]?.length ?? 0) === 0}
                  onChange={(e) => set("subcategory", e.target.value || undefined)}
                >
                  <option value="">{t("podcast.publish.noneOption")}</option>
                  {(form.category ? me.categories?.[form.category] ?? [] : []).map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass} htmlFor="pf-artwork">{t("podcast.publish.fieldArtwork")}</label>
                <input
                  id="pf-artwork"
                  className={inputClass}
                  value={form.artworkUrl ?? ""}
                  placeholder={me.defaults?.artworkUrl ?? "https://…"}
                  onChange={(e) => set("artworkUrl", e.target.value)}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="pf-language">{t("podcast.publish.fieldLanguage")}</label>
                <input
                  id="pf-language"
                  className={inputClass}
                  value={form.language ?? ""}
                  placeholder="en"
                  onChange={(e) => set("language", e.target.value)}
                />
              </div>
              <label className="flex cursor-pointer items-center gap-2.5 text-sm text-white/75 sm:col-span-2">
                <input
                  type="checkbox"
                  checked={form.explicit ?? false}
                  onChange={(e) => set("explicit", e.target.checked)}
                  className="h-4 w-4 accent-[#d4af37]"
                />
                {t("podcast.publish.fieldExplicit")}
              </label>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {saving ? t("podcast.publish.saving") : t("podcast.publish.save")}
              </button>
              {saved && (
                <span className="flex items-center gap-1 text-sm text-emerald-300">
                  <Check className="h-4 w-4" /> {t("podcast.publish.saved")}
                </span>
              )}
              {saveError && <span className="text-sm text-red-300">{t("podcast.publish.saveError")}</span>}
            </div>
          </div>

          {/* ── Submission steps — the honest part ── */}
          <div>
            <h4 className={`text-sm font-black ${isLight ? "text-[#3d2f06]" : "text-white"}`}>
              {t("podcast.publish.submitHeading")}
            </h4>
            <div className="mt-2 flex items-start gap-2 rounded-xl border border-primary/25 bg-primary/[0.07] px-4 py-3 text-sm text-white/80">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>{t("podcast.publish.honestNote")}</span>
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                <div className="flex items-center justify-between gap-2">
                  <h5 className="text-sm font-black text-white">{t("podcast.publish.appleHeading")}</h5>
                  <a
                    href={APPLE_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-xs font-bold text-primary hover:underline"
                  >
                    {t("podcast.publish.openSite")} <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
                <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-white/65">
                  <li>{t("podcast.publish.appleStep1")}</li>
                  <li>{t("podcast.publish.appleStep2")}</li>
                  <li>{t("podcast.publish.appleStep3")}</li>
                </ol>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                <div className="flex items-center justify-between gap-2">
                  <h5 className="text-sm font-black text-white">{t("podcast.publish.spotifyHeading")}</h5>
                  <a
                    href={SPOTIFY_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-xs font-bold text-primary hover:underline"
                  >
                    {t("podcast.publish.openSite")} <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
                <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-white/65">
                  <li>{t("podcast.publish.spotifyStep1")}</li>
                  <li>{t("podcast.publish.spotifyStep2")}</li>
                  <li>{t("podcast.publish.spotifyStep3")}</li>
                </ol>
              </div>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-white/40">{t("podcast.publish.afterNote")}</p>
          </div>
        </div>
      )}
    </section>
  );
}

export default PodcastPublishPanel;
