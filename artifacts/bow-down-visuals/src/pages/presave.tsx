import { useEffect, useMemo, useRef, useState } from "react";
import { useRoute } from "wouter";
import { useTranslation } from "react-i18next";
import {
  Disc3, Loader2, AlertTriangle, CalendarDays, Image as ImageIcon, Share2,
  Mail, CheckCircle2, ExternalLink, Lock, Gift, Users, Timer,
  PartyPopper, Copy, Check, BellRing, RotateCcw,
} from "lucide-react";
import { platformLabel } from "@/lib/distribution";
import { injectSmartlinkPixels, type SmartlinkPixels } from "@/lib/smartlink-pixels";
import { usePageTitle } from "@/hooks/use-page-title";
import { useAuth } from "@/contexts/AuthContext";

/* ─── Public pre-save landing page (/presave/:slug) ─────────────────────────
   HyperFollow-level: no auth required — this page is meant to be shared
   with fans. Reads GET /api/distribution/presave/:slug (public) and renders
   the full campaign experience:
   - live countdown to release date (auto-flips to "stream now" on release)
   - email capture (fans join the artist's email list server-side)
   - multi-platform link block (artist-pasted URLs)
   - share-to-unlock bonus content + follower/share counters
   - virality: shared links carry "Made with Bow Down Visuals" + ?ref=CODE */

interface PresaveRelease {
  title: string;
  artistName: string;
  artworkUrl: string | null;
  releaseDate: string | null;
  releaseType: string;
  genre: string | null;
  platforms: string[];
  headline: string | null;
  platformLinks: Record<string, string>;
  bonusUrl: string | null;
  followerCount: number;
  shareCount: number;
  /* Stack 11: the page persists post-release as the smartlink, and the
     headline action can be a real account save where supported. */
  released?: boolean;
  persistsAfterRelease?: boolean;
  landing?: { videoUrl: string | null; storeUrl: string | null; socialLinks: Record<string, string> };
  /* Migration 0186: the creator's own retargeting pixels for this
     release (all null when none are configured — nothing fires). */
  pixels?: SmartlinkPixels;
  accountPresave?: { platform: string; supported: boolean; itemKind?: string; actionLabel: string | null; accountSaveCount?: number; reason?: string };
}

const PLATFORM_ORDER = [
  "spotify", "apple_music", "youtube_music", "tiktok",
  "amazon_music", "deezer", "tidal",
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function releaseTarget(releaseDate: string | null): number | null {
  if (!releaseDate) return null;
  /* release_date is stored as YYYY-MM-DD (UTC midnight) or a full ISO string. */
  const d = /^\d{4}-\d{2}-\d{2}$/.test(releaseDate.trim())
    ? new Date(`${releaseDate.trim()}T00:00:00Z`)
    : new Date(releaseDate);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

export default function PresaveLanding() {
  const { t } = useTranslation();
  const { user, getAccessToken } = useAuth();
  const [, params] = useRoute("/presave/:slug");
  const slug = params?.slug ?? "";
  const [accountSaveState, setAccountSaveState] = useState<"idle" | "working" | "saved" | "error">("idle");
  const [accountSaveMsg, setAccountSaveMsg] = useState<string | null>(null);

  /* Real account pre-save: the server calls the platform's library API
     with the fan's own connected account and records the save ONLY when
     the platform confirms. No confirmation → no "saved" claim here. */
  async function doAccountPresave() {
    if (accountSaveState === "working" || accountSaveState === "saved") return;
    if (!user) {
      window.location.href = `/login?next=${encodeURIComponent(`/presave/${slug}`)}`;
      return;
    }
    setAccountSaveState("working");
    setAccountSaveMsg(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/distribution/presave/${encodeURIComponent(slug)}/account-presave`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({}),
      });
      const json = (await res.json().catch(() => ({}))) as { saved?: boolean; error?: string; message?: string };
      if (res.status === 409 && json.error === "spotify_not_connected") {
        const authRes = await fetch(`/api/distribution/spotify/auth-url?returnTo=${encodeURIComponent(slug)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const authJson = (await authRes.json().catch(() => ({}))) as { authUrl?: string; message?: string };
        if (authRes.ok && authJson.authUrl) { window.location.href = authJson.authUrl; return; }
        throw new Error(authJson.message || json.message || "Account pre-save isn't available right now.");
      }
      if (!res.ok || !json.saved) throw new Error(json.message || "The save wasn't confirmed — nothing was recorded.");
      setAccountSaveState("saved");
      setAccountSaveMsg("Saved to your library — it's yours the moment it drops.");
    } catch (err) {
      setAccountSaveState("error");
      setAccountSaveMsg(err instanceof Error ? err.message : "The save wasn't confirmed — nothing was recorded.");
    }
  }

  const [data, setData] = useState<PresaveRelease | null>(null);
  usePageTitle(data?.title ? `${data.title} — Presave` : "Presave", "Pre-save the upcoming release on Bow Down Visuals.");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  /* fan engagement state */
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [followState, setFollowState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [followMsg, setFollowMsg] = useState<string | null>(null);
  const [followerCount, setFollowerCount] = useState(0);
  const [shareCount, setShareCount] = useState(0);
  const [copied, setCopied] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/distribution/presave/${encodeURIComponent(slug)}`);
        const json = (await res.json().catch(() => ({}))) as {
          error?: string; message?: string; presave?: PresaveRelease;
        } & Partial<PresaveRelease>;
        /* Server nests the payload under `presave`; accept both shapes. */
        const release = json.presave ?? (json.title ? (json as PresaveRelease) : undefined);
        if (!res.ok || !release?.title) {
          throw new Error(json.message || json.error || t("presave.errors.notFound"));
        }
        if (!cancelled) {
          setData(release);
          setFollowerCount(release.followerCount ?? 0);
          setShareCount(release.shareCount ?? 0);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : t("presave.errors.loadFailed"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [slug, t, retryNonce]);

  const now = useNow(1000);
  const target = useMemo(() => releaseTarget(data?.releaseDate ?? null), [data?.releaseDate]);
  const released = target !== null && now >= target;

  /* Referral pass-through: keep ?ref=CODE on shared links. */
  const refCode = useMemo(() => {
    try {
      return new URLSearchParams(window.location.search).get("ref") ?? "";
    } catch { return ""; }
  }, []);

  /* Campaign channel (?src= or utm_source): rides into the smartlink
     analytics so the creator sees which post drove each tap. */
  const channel = useMemo(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      return (p.get("src") ?? p.get("utm_source") ?? "").slice(0, 40);
    } catch { return ""; }
  }, []);

  /* Smartlink analytics + retargeting pixels (migration 0186): once
     per page load — record the view and fire the creator's own pixels,
     but only the ones this release actually carries. */
  const viewTrackedRef = useRef(false);
  useEffect(() => {
    if (!data || viewTrackedRef.current) return;
    viewTrackedRef.current = true;
    injectSmartlinkPixels(data.pixels);
    void fetch(`/api/distribution/presave/${encodeURIComponent(slug)}/view`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channel }),
      keepalive: true,
    }).catch(() => undefined);
  }, [data, slug, channel]);

  /* Fire-and-forget outbound tap recording; the server resolves the
     key against the links really on this page — the anchor's own
     navigation is never delayed or blocked by it. */
  const trackClick = (kind: "platform" | "video" | "store" | "social" | "bonus", key = "") => {
    void fetch(`/api/distribution/presave/${encodeURIComponent(slug)}/click`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, key, channel }),
      keepalive: true,
    }).catch(() => undefined);
  };

  const shareUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    try {
      const u = new URL(window.location.href);
      if (refCode && !u.searchParams.get("ref")) u.searchParams.set("ref", refCode);
      return u.toString();
    } catch { return window.location.href; }
  }, [refCode]);

  const shareText = useMemo(() => {
    if (!data) return "";
    const when = released
      ? t("presave.shareTextOut", { title: data.title, artist: data.artistName })
      : t("presave.shareText", { title: data.title, artist: data.artistName });
    return `${when} 🎵 Made with Bow Down Visuals`;
  }, [data, released, t]);

  async function submitFollow() {
    if (followState === "saving" || followState === "done" || !data) return;
    const clean = email.trim().toLowerCase();
    if (!EMAIL_RE.test(clean)) {
      setFollowMsg(t("presave.invalidEmail"));
      setFollowState("error");
      return;
    }
    setFollowState("saving");
    setFollowMsg(null);
    try {
      const res = await fetch(`/api/distribution/presave/${encodeURIComponent(slug)}/follow`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: clean, name: name.trim() }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        followerCount?: number; alreadyFollowing?: boolean; error?: string; message?: string;
      };
      if (!res.ok) throw new Error(json.message || json.error || t("presave.followFailed"));
      setFollowerCount(json.followerCount ?? followerCount + 1);
      setFollowState("done");
      setFollowMsg(
        json.alreadyFollowing
          ? t("presave.alreadyFollowing", { artist: data.artistName })
          : t("presave.followed", { artist: data.artistName }),
      );
    } catch (err) {
      setFollowState("error");
      setFollowMsg(err instanceof Error ? err.message : t("presave.followFailed"));
    }
  }

  async function recordShare(channel: string): Promise<void> {
    /* Records the share server-side; unlocks bonus content when the artist set one. */
    try {
      const res = await fetch(`/api/distribution/presave/${encodeURIComponent(slug)}/share`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channel }),
      });
      const json = (await res.json().catch(() => ({}))) as { shareCount?: number; bonusUrl?: string | null };
      if (res.ok) {
        if (typeof json.shareCount === "number") setShareCount(json.shareCount);
        if (json.bonusUrl) setUnlocked(true);
      }
    } catch { /* non-fatal */ }
  }

  async function doNativeShare() {
    if (sharing) return;
    setSharing(true);
    try {
      if (navigator.share) {
        await navigator.share({ title: data ? `${data.title} — ${data.artistName}` : "Bow Down Visuals", text: shareText, url: shareUrl });
      } else {
        await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
      await recordShare("native");
    } catch { /* user dismissed — not an error */ }
    finally { setSharing(false); }
  }

  async function doCopyLink() {
    try {
      await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      await recordShare("copy");
    } catch { /* clipboard denied */ }
  }

  const platformEntries = useMemo(() => {
    if (!data) return [];
    return PLATFORM_ORDER
      .filter((k) => data.platformLinks?.[k])
      .map((k) => ({ key: k, url: data.platformLinks[k] }));
  }, [data]);

  const remaining = target !== null ? Math.max(0, target - now) : null;
  const parts = remaining !== null ? {
    d: Math.floor(remaining / 86_400_000),
    h: Math.floor((remaining / 3_600_000) % 24),
    m: Math.floor((remaining / 60_000) % 60),
    s: Math.floor((remaining / 1000) % 60),
  } : null;

  const cardCls = "relative overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04] p-8 text-center md:p-12";

  return (
    <div className="min-h-screen bg-black text-white">
      <main className="relative mx-auto max-w-xl px-5 pb-24 pt-14 md:pt-20">
        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center" aria-hidden="true">
          <div className="h-[240px] w-[480px] rounded-full bg-yellow-600/10 blur-[110px]" />
        </div>

        {loading ? (
          <p className="relative py-20 text-center text-sm text-white/40">
            <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-primary" />
            {t("presave.loading")}
          </p>
        ) : error || !data ? (
          <div className="relative mx-auto mt-10 rounded-3xl border border-red-500/30 bg-red-500/10 p-10 text-center">
            <AlertTriangle className="mx-auto h-10 w-10 text-red-300" />
            <p className="mt-4 text-sm text-red-200">{error ?? t("presave.errors.notFound")}</p>
            <button
              onClick={() => setRetryNonce((n) => n + 1)}
              className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 font-bold text-black hover:brightness-110"
            >
              <RotateCcw className="h-4 w-4" /> Try again
            </button>
          </div>
        ) : (
          <div className={cardCls}>
            {/* ── hero ── */}
            <p className="mb-5 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-primary">
              {released
                ? (<><PartyPopper className="h-3 w-3" aria-hidden="true" /> {t("presave.badgeOut")}</>)
                : (<><Disc3 className="h-3 w-3" aria-hidden="true" /> {t("presave.badge")}</>)}
            </p>
            {data.artworkUrl ? (
              <img
                src={data.artworkUrl}
                alt={t("presave.artworkAlt", { title: data.title })}
                className="mx-auto h-56 w-56 rounded-3xl border border-white/10 object-cover shadow-2xl shadow-primary/20"
              />
            ) : (
              <div className="mx-auto flex h-56 w-56 items-center justify-center rounded-3xl border border-white/10 bg-white/[0.03]">
                <ImageIcon className="h-16 w-16 text-white/20" />
              </div>
            )}
            <h1 className="mt-6 font-display text-3xl font-black">{data.title}</h1>
            <p className="mt-1 text-white/55">{data.artistName}</p>
            {data.headline && (
              <p className="mx-auto mt-3 max-w-md text-sm italic text-primary/90">“{data.headline}”</p>
            )}

            {/* ── countdown / release status ── */}
            {released ? (
              <div className="mx-auto mt-6 flex items-center justify-center gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-6 py-4">
                <PartyPopper className="h-6 w-6 text-emerald-300" />
                <p className="text-lg font-black text-emerald-200">{t("presave.outNow")}</p>
              </div>
            ) : parts ? (
              <div className="mt-6">
                <p className="mb-3 inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-white/40">
                  <Timer className="h-3.5 w-3.5 text-primary" />
                  {data.releaseDate
                    ? t("presave.drops", { date: data.releaseDate })
                    : t("presave.dropsSoon")}
                </p>
                <div className="mx-auto grid max-w-sm grid-cols-4 gap-2" role="timer" aria-live="off">
                  {[
                    { v: parts.d, l: t("presave.cdDays") },
                    { v: parts.h, l: t("presave.cdHours") },
                    { v: parts.m, l: t("presave.cdMins") },
                    { v: parts.s, l: t("presave.cdSecs") },
                  ].map(({ v, l }) => (
                    <div key={l} className="rounded-2xl border border-primary/25 bg-primary/[0.06] px-2 py-3">
                      <p className="font-display text-2xl font-black tabular-nums text-primary md:text-3xl">
                        {String(v).padStart(2, "0")}
                      </p>
                      <p className="mt-0.5 text-[10px] font-bold uppercase tracking-widest text-white/40">{l}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-4 py-1.5 text-sm text-white/60">
                <CalendarDays className="h-4 w-4 text-primary" /> {t("presave.dropsSoon")}
              </p>
            )}

            {/* ── fan counters ── */}
            <div className="mt-6 flex items-center justify-center gap-5 text-sm text-white/50">
              <span className="inline-flex items-center gap-1.5">
                <Users className="h-4 w-4 text-primary" />
                <strong className="font-black text-white">{followerCount.toLocaleString()}</strong>
                {t("presave.fansCount")}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Share2 className="h-4 w-4 text-primary" />
                <strong className="font-black text-white">{shareCount.toLocaleString()}</strong>
                {t("presave.sharesCount")}
              </span>
            </div>

            {/* ── Stack 11 #2: real account pre-save (headline action when
                the platform API can actually save this release) ── */}
            {data.accountPresave?.supported && (
              <div className="mx-auto mt-6 max-w-md rounded-2xl border border-primary/30 bg-primary/[0.07] p-5">
                <p className="text-sm font-black text-white">{released ? "Add it to your library" : "Pre-save it to your library"}</p>
                <p className="mt-1 text-xs text-white/50">
                  {user
                    ? "One tap saves it with your connected account — confirmed by the platform, not just recorded here."
                    : "Sign in and connect your account — the save lands in your own library, confirmed by the platform."}
                  {typeof data.accountPresave.accountSaveCount === "number" && data.accountPresave.accountSaveCount > 0
                    ? ` ${data.accountPresave.accountSaveCount.toLocaleString()} fans already saved it this way.`
                    : ""}
                </p>
                <button
                  onClick={doAccountPresave}
                  disabled={accountSaveState === "working" || accountSaveState === "saved"}
                  className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-60"
                >
                  {accountSaveState === "working" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  {accountSaveState === "saved" ? "Saved to your library" : (data.accountPresave.actionLabel ?? "Save on Spotify")}
                </button>
                {accountSaveMsg && <p className={`mt-2 text-xs ${accountSaveState === "error" ? "text-red-300" : "text-emerald-300"}`}>{accountSaveMsg}</p>}
                <p className="mt-2 text-[11px] text-white/35">Prefer email? The pre-save below still joins the artist&apos;s list.</p>
              </div>
            )}

            {/* ── email capture (joins the artist's email list) ── */}
            {followState === "done" ? (
              <div className="mx-auto mt-6 max-w-md rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5">
                <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-300" />
                <p className="mt-2 text-sm font-bold text-emerald-200">{followMsg}</p>
                <p className="mt-1 text-xs text-white/50">
                  <BellRing className="mr-1 inline h-3.5 w-3.5" />
                  {t("presave.notifyNote")}
                </p>
              </div>
            ) : (
              <div className="mx-auto mt-6 max-w-md rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <p className="text-sm font-black text-white">
                  {released ? t("presave.followCtaOut") : t("presave.followCta")}
                </p>
                <p className="mt-1 text-xs text-white/50">{t("presave.followBlurb")}</p>
                <div className="mt-4 space-y-2">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); if (followState === "error") setFollowState("idle"); }}
                    placeholder={t("presave.emailPlaceholder")}
                    className="w-full rounded-xl border border-white/15 bg-black/60 px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-primary focus:outline-none"
                    aria-label={t("presave.emailPlaceholder")}
                  />
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t("presave.namePlaceholder")}
                    maxLength={120}
                    className="w-full rounded-xl border border-white/15 bg-black/60 px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-primary focus:outline-none"
                    aria-label={t("presave.namePlaceholder")}
                  />
                  <button
                    onClick={submitFollow}
                    disabled={followState === "saving"}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-60"
                  >
                    {followState === "saving"
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <Mail className="h-4 w-4" />}
                    {followState === "saving" ? t("presave.saving") : (released ? t("presave.followBtnOut") : t("presave.followBtn"))}
                  </button>
                  {followMsg && followState === "error" && (
                    <p className="text-xs text-red-300">{followMsg}</p>
                  )}
                </div>
              </div>
            )}

            {/* ── platform link block ── */}
            {platformEntries.length > 0 ? (
              <div className="mt-6">
                <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40">
                  {released ? t("presave.streamNowOn") : t("presave.platformsCta")}
                </p>
                <div className="grid gap-2">
                  {platformEntries.map(({ key, url }) => (
                    <a
                      key={key}
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() => trackClick("platform", key)}
                      className={`inline-flex items-center justify-between gap-2 rounded-xl border px-4 py-3 text-sm font-bold transition ${
                        released
                          ? "border-primary/50 bg-primary/15 text-primary hover:bg-primary/25"
                          : "border-white/15 bg-white/[0.04] text-white/85 hover:border-primary/50 hover:text-primary"
                      }`}
                    >
                      <span className="inline-flex items-center gap-2">
                        {released ? <PartyPopper className="h-4 w-4" /> : <Disc3 className="h-4 w-4" />}
                        {released
                          ? t("presave.streamOn", { platform: platformLabel(key) })
                          : t("presave.followOn", { platform: platformLabel(key) })}
                      </span>
                      <ExternalLink className="h-4 w-4 opacity-60" />
                    </a>
                  ))}
                </div>
              </div>
            ) : data.platforms.length > 0 && (
              <div className="mt-6">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-white/40">
                  {t("presave.platformsTitle")}
                </p>
                <div className="flex flex-wrap justify-center gap-1.5">
                  {data.platforms.map((p) => (
                    <span key={p} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/60">
                      {platformLabel(p)}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* ── Stack 11 #1: persistent smartlink — video / store / socials.
                This page is the release's home link after release day. ── */}
            {data.landing && (data.landing.videoUrl || data.landing.storeUrl || Object.keys(data.landing.socialLinks ?? {}).length > 0) && (
              <div className="mt-6">
                <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40">
                  {released ? "Everything for this release, in one place" : "More from this release"}
                </p>
                <div className="grid gap-2">
                  {data.landing.videoUrl && (
                    <a href={data.landing.videoUrl} target="_blank" rel="noreferrer" onClick={() => trackClick("video")} className="inline-flex items-center justify-between gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-4 py-3 text-sm font-bold text-white/85 transition hover:border-primary/50 hover:text-primary">
                      <span>Watch the video</span><ExternalLink className="h-4 w-4 opacity-60" />
                    </a>
                  )}
                  {data.landing.storeUrl && (
                    <a href={data.landing.storeUrl} target="_blank" rel="noreferrer" onClick={() => trackClick("store")} className="inline-flex items-center justify-between gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-4 py-3 text-sm font-bold text-white/85 transition hover:border-primary/50 hover:text-primary">
                      <span>Get it in the store</span><ExternalLink className="h-4 w-4 opacity-60" />
                    </a>
                  )}
                  {Object.entries(data.landing.socialLinks ?? {}).map(([k, url]) => (
                    <a key={k} href={url} target="_blank" rel="noreferrer" onClick={() => trackClick("social", k)} className="inline-flex items-center justify-between gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-4 py-3 text-sm font-bold text-white/85 transition hover:border-primary/50 hover:text-primary">
                      <span>{k === "x" ? "X" : k === "website" ? "Website" : k[0]!.toUpperCase() + k.slice(1)}</span><ExternalLink className="h-4 w-4 opacity-60" />
                    </a>
                  ))}
                </div>
                {released && <p className="mt-2 text-[11px] text-white/35">This page stays live — it&apos;s the release&apos;s home link, not a countdown that expired.</p>}
              </div>
            )}

            {/* ── share to unlock ── */}
            <div className="mt-6 rounded-2xl border border-primary/25 bg-primary/[0.05] p-5">
              <p className="inline-flex items-center gap-1.5 text-sm font-black text-white">
                {data.bonusUrl && !unlocked
                  ? <><Lock className="h-4 w-4 text-primary" /> {t("presave.shareToUnlock")}</>
                  : <><Gift className="h-4 w-4 text-primary" /> {t("presave.shareTitle")}</>}
              </p>
              {data.bonusUrl && !unlocked && (
                <p className="mt-1 text-xs text-white/50">{t("presave.unlockBlurb")}</p>
              )}
              {data.bonusUrl && unlocked ? (
                <a
                  href={data.bonusUrl}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => trackClick("bonus")}
                  className="mt-3 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-black text-black transition hover:brightness-110"
                >
                  <Gift className="h-4 w-4" /> {t("presave.openBonus")}
                </a>
              ) : (
                <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                  <button
                    onClick={doNativeShare}
                    disabled={sharing}
                    className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-60"
                  >
                    {sharing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
                    {t("presave.shareRelease", { defaultValue: "Share this release" })}
                  </button>
                  <button
                    onClick={doCopyLink}
                    className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-4 py-2.5 text-sm font-bold text-white/70 transition hover:border-primary/50 hover:text-primary"
                  >
                    {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                    {copied ? t("presave.copied") : t("presave.copyLink")}
                  </button>
                  <a
                    href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`}
                    target="_blank" rel="noreferrer"
                    onClick={() => { void recordShare("x"); }}
                    className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-4 py-2.5 text-sm font-bold text-white/70 transition hover:border-primary/50 hover:text-primary"
                  >
                    {t("presave.postToX", { defaultValue: "Post to X" })}
                  </a>
                  <a
                    href={`https://wa.me/?text=${encodeURIComponent(`${shareText}\n${shareUrl}`)}`}
                    target="_blank" rel="noreferrer"
                    onClick={() => { void recordShare("whatsapp"); }}
                    className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-4 py-2.5 text-sm font-bold text-white/70 transition hover:border-primary/50 hover:text-primary"
                  >
                    WhatsApp
                  </a>
                </div>
              )}
            </div>

            <p className="mt-8 text-xs text-white/30">
              {t("presave.footer")}
            </p>
            {/* Artist handoff: the release owner can build promo cards for this release. */}
            <p className="mt-3 text-xs text-white/40">
              {t("presave.artistCta", { defaultValue: "Are you the artist?" })}{" "}
              <a href="/promote#promo-cards" className="font-bold text-primary underline-offset-2 hover:underline">
                {t("presave.promoteRelease", { defaultValue: "Promote this release →" })}
              </a>
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
