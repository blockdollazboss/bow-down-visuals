import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import {
  Home, Loader2, CheckCircle2, CircleDashed, Sparkles, Store, Newspaper,
  Mail, Megaphone, UserRound, ArrowRight, Ban, RotateCcw, PartyPopper, Library,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { usePageTitle } from "@/hooks/use-page-title";

/* ─── Move Home — the concierge onboarding ──────────────────────────────
   Platforms give a creator an audience but no home. This flow drafts
   the whole home in one pass — Grand Stage profile, starter store,
   press kit, email list + welcome, launch posts — from the creator's
   answers, their existing on-platform content, and their ALREADY-
   connected social accounts. Everything lands as a draft; each piece
   goes live only through its own Approve button. Free, resumable. */

type StepKey = "profile" | "store" | "press_kit" | "email_list" | "launch_posts";
type StepStatus = "pending" | "drafted" | "approved" | "skipped";

interface StepState {
  key: StepKey;
  title: string;
  blurb: string;
  status: StepStatus;
  blockedReason?: "no_connected_accounts" | "needs_media" | "needs_profile";
  appliedRef?: string;
}

interface MoveHomeData {
  answers: Record<string, unknown>;
  drafts: {
    copySource?: "ai" | "assembled";
    profile?: { slug: string; displayName: string; vertical: string; bio: string; socialLinks: Record<string, string>; updatesExisting: boolean };
    store?: { products: Array<{ kind: string; title: string; description: string; priceCents: number; suggestedPrice: boolean; sourceTrackId?: string }> };
    press_kit?: { handle: string; artistName: string; tagline: string; bio: string; topTracks: Array<{ title: string; url: string }> };
    email_list?: { name: string; handle: string; description: string; welcomeSubject: string; welcomeBody: string; updatesExisting: boolean };
    launch_posts?: { posts: Array<{ platform: string; accountId: string; accountLabel: string; caption: string; hashtags: string; mediaUrl: string | null; mediaType: "video" | "image" }> };
  };
  steps: StepState[];
  completedAt: string | null;
  context: {
    hasProfile: boolean;
    profileSlug: string | null;
    connectedPlatforms: Array<{ platform: string; label: string }>;
    trackCount: number;
    videoCount: number;
  };
}

const VERTICALS = [
  ["music", "moveHome.verticalMusic"], ["video", "moveHome.verticalVideo"], ["gaming", "moveHome.verticalGaming"],
  ["podcast", "moveHome.verticalPodcast"], ["film", "moveHome.verticalFilm"], ["tv", "moveHome.verticalTv"],
  ["influencer", "moveHome.verticalInfluencer"], ["education", "moveHome.verticalEducation"], ["other", "moveHome.verticalOther"],
] as const;

const STEP_ICON: Record<StepKey, React.ReactNode> = {
  profile: <UserRound className="h-5 w-5" />,
  store: <Store className="h-5 w-5" />,
  press_kit: <Newspaper className="h-5 w-5" />,
  email_list: <Mail className="h-5 w-5" />,
  launch_posts: <Megaphone className="h-5 w-5" />,
};

const BLOCKED_COPY: Record<string, string> = {
  no_connected_accounts: "moveHome.blockedNoAccounts",
  needs_media: "moveHome.blockedNeedsMedia",
  needs_profile: "moveHome.blockedNeedsProfile",
};

export default function MoveHome() {
  const { t } = useTranslation();
  usePageTitle(
    t("moveHome.title"),
    t("moveHome.pageDescription"),
  );
  const isLight = useIsLightTheme();
  const { user, getAccessToken } = useAuth();
  const [data, setData] = useState<MoveHomeData | null>(null);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string>("");

  /* intake form */
  const [form, setForm] = useState({
    displayName: "", handle: "", vertical: "music", genre: "",
    location: "", tagline: "", bioSeed: "", starterProductTitle: "",
  });
  /* per-step edit state */
  const [profileEdit, setProfileEdit] = useState({ displayName: "", bio: "" });
  const [storeEdit, setStoreEdit] = useState<Array<{ title: string; priceDollars: string }>>([]);
  const [launchMedia, setLaunchMedia] = useState<Array<{ mediaUrl: string; mediaType: "video" | "image" }>>([]);

  const syncFrom = useCallback((d: MoveHomeData) => {
    setData(d);
    const a = d.answers as Record<string, string | undefined>;
    setForm((f) => ({
      displayName: a.displayName ?? f.displayName,
      handle: a.handle ?? f.handle,
      vertical: a.vertical ?? f.vertical,
      genre: a.genre ?? f.genre,
      location: a.location ?? f.location,
      tagline: a.tagline ?? f.tagline,
      bioSeed: a.bioSeed ?? f.bioSeed,
      starterProductTitle: a.starterProductTitle ?? f.starterProductTitle,
    }));
    if (d.drafts.profile) {
      setProfileEdit({ displayName: d.drafts.profile.displayName, bio: d.drafts.profile.bio });
    }
    if (d.drafts.store) {
      setStoreEdit(d.drafts.store.products.map((p) => ({
        title: p.title,
        priceDollars: (p.priceCents / 100).toFixed(2),
      })));
    }
    if (d.drafts.launch_posts) {
      setLaunchMedia(d.drafts.launch_posts.posts.map((p) => ({
        mediaUrl: p.mediaUrl ?? "",
        mediaType: p.mediaType,
      })));
    }
  }, []);

  const call = useCallback(
    async (method: string, path: string, body?: unknown): Promise<MoveHomeData | null> => {
      const token = await getAccessToken();
      const res = await fetch(path, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as { moveHome?: MoveHomeData; error?: string };
      if (!res.ok) throw new Error(json.error ?? t("moveHome.genericError"));
      return json.moveHome ?? null;
    },
    [getAccessToken, t],
  );

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const d = await call("GET", "/api/move-home");
        if (!cancelled && d) syncFrom(d);
      } catch {
        if (!cancelled) setLoadError(t("moveHome.loadError"));
      }
    })();
    return () => { cancelled = true; };
  }, [user, call, syncFrom]);

  const run = async (label: string, fn: () => Promise<MoveHomeData | null>, success: string) => {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      const d = await fn();
      if (d) syncFrom(d);
      setNotice(success);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("moveHome.genericError"));
    } finally {
      setBusy("");
    }
  };

  const card = isLight
    ? "rounded-2xl border border-[#C9A84C]/50 bg-[#F7ECD2]"
    : "rounded-2xl border border-primary/25 bg-zinc-950";
  const sub = isLight ? "text-zinc-600" : "text-zinc-400";
  const head = isLight ? "text-zinc-900" : "text-white";
  const input =
    "w-full rounded-xl border px-3 py-2 text-sm outline-none transition-colors " +
    (isLight
      ? "border-[#C9A84C]/40 bg-white/70 text-zinc-900 placeholder:text-zinc-400 focus:border-[#C9A84C]"
      : "border-white/10 bg-white/[0.04] text-white placeholder:text-zinc-500 focus:border-primary/50");

  if (!user) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-16 text-center">
        <Home className="mx-auto h-10 w-10 text-primary" />
        <h1 className={`mt-4 text-2xl font-black ${head}`}>{t("moveHome.title")}</h1>
        <p className={`mt-2 text-sm ${sub}`}>{t("moveHome.signInPrompt")}</p>
        <Link href="/login?next=/move-home" className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-black">
          {t("moveHome.signIn")} <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-16 text-center">
        <p className={`text-sm font-semibold ${head}`}>{loadError}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const drafted = data.steps.some((s) => s.status !== "pending");
  const doneCount = data.steps.filter((s) => s.status === "approved" || s.status === "skipped").length;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-8 md:px-6">
      {/* ── Header ── */}
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 border border-primary/25">
          <Home className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className={`text-2xl font-black md:text-3xl ${head}`}>{t("moveHome.title")}</h1>
          <p className={`mt-1 max-w-xl text-sm ${sub}`}>
            {t("moveHome.introBefore")}{" "}
            <span className="font-semibold text-primary">{t("moveHome.introEmphasis")}</span>{" "}
            {t("moveHome.introAfter")}
          </p>
        </div>
      </div>

      {/* ── Context strip ── */}
      <div className={`mt-5 flex flex-wrap items-center gap-2 text-xs font-semibold ${sub}`}>
        <span className={`rounded-full border px-3 py-1 ${isLight ? "border-[#C9A84C]/40" : "border-white/10"}`}>
          {data.context.hasProfile ? t("moveHome.profileLive", { slug: data.context.profileSlug }) : t("moveHome.noProfileYet")}
        </span>
        {data.context.connectedPlatforms.map((p) => (
          <span key={p.platform} className="rounded-full border border-primary/30 bg-primary/[0.07] px-3 py-1 text-primary">
            {t("moveHome.connected", { label: p.label })}
          </span>
        ))}
        {data.context.connectedPlatforms.length === 0 && (
          <span className={`rounded-full border px-3 py-1 ${isLight ? "border-[#C9A84C]/40" : "border-white/10"}`}>
            {t("moveHome.noSocials")}
          </span>
        )}
        <span className={`rounded-full border px-3 py-1 ${isLight ? "border-[#C9A84C]/40" : "border-white/10"}`}>
          {t("moveHome.countsLine", { tracks: data.context.trackCount, videos: data.context.videoCount })}
        </span>
      </div>

      {/* ── Sibling door: the back-catalog migration assistant ── */}
      <Link href="/catalog-import" className={`mt-5 flex items-start gap-3 p-5 ${card} transition-colors hover:border-primary/50`}>
        <Library className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <span className="text-sm">
          <span className={`font-black ${head}`}>{t("moveHome.siblingTitle")}</span>
          <span className={`mt-1 block ${sub}`}>
            {t("moveHome.siblingBody")}{" "}
            <span className="font-semibold text-primary">{t("moveHome.siblingCta")}</span>
          </span>
        </span>
      </Link>

      {data.completedAt && (
        <div className={`mt-6 flex items-start gap-3 p-5 ${card}`}>
          <PartyPopper className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div className="text-sm">
            <p className={`font-black ${head}`}>{t("moveHome.homeLive")}</p>
            <p className={`mt-1 ${sub}`}>
              {t("moveHome.completedBody")}
              {data.context.profileSlug && (
                <> <Link className="font-semibold text-primary underline underline-offset-2" href={`/artist/${data.context.profileSlug}`}>{t("moveHome.yourProfile")}</Link> ·</>
              )}{" "}
              <Link className="font-semibold text-primary underline underline-offset-2" href="/storefronts">{t("moveHome.yourStore")}</Link> ·{" "}
              <Link className="font-semibold text-primary underline underline-offset-2" href="/email-list">{t("moveHome.yourEmailList")}</Link> ·{" "}
              <Link className="font-semibold text-primary underline underline-offset-2" href="/scheduler">{t("moveHome.postScheduler")}</Link>
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-5 rounded-2xl border border-red-500/30 bg-red-500/[0.08] px-4 py-3 text-sm font-semibold text-red-300">
          {error}
        </div>
      )}
      {notice && !error && (
        <div className="mt-5 rounded-2xl border border-primary/30 bg-primary/[0.07] px-4 py-3 text-sm font-semibold text-primary">
          {notice}
        </div>
      )}

      {/* ── Intake ── */}
      <section className={`mt-6 p-5 ${card}`}>
        <h2 className={`flex items-center gap-2 text-base font-black ${head}`}>
          <Sparkles className="h-4 w-4 text-primary" /> {t("moveHome.intakeTitle")}
        </h2>
        <p className={`mt-1 text-xs ${sub}`}>
          {t("moveHome.intakeNote")}
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="block">
            <span className={`mb-1 block text-xs font-bold ${sub}`}>{t("moveHome.displayNameLabel")}</span>
            <input data-testid="mh-display-name" className={input} value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })} placeholder={t("moveHome.displayNamePh")} />
          </label>
          <label className="block">
            <span className={`mb-1 block text-xs font-bold ${sub}`}>{t("moveHome.handleLabel")}</span>
            <input data-testid="mh-handle" className={input} value={form.handle}
              onChange={(e) => setForm({ ...form, handle: e.target.value })} placeholder={t("moveHome.handlePh")} />
          </label>
          <label className="block">
            <span className={`mb-1 block text-xs font-bold ${sub}`}>{t("moveHome.verticalLabel")}</span>
            <select data-testid="mh-vertical" className={input} value={form.vertical}
              onChange={(e) => setForm({ ...form, vertical: e.target.value })}>
              {VERTICALS.map(([v, label]) => (<option key={v} value={v}>{t(label)}</option>))}
            </select>
          </label>
          <label className="block">
            <span className={`mb-1 block text-xs font-bold ${sub}`}>{t("moveHome.genreLabel")}</span>
            <input className={input} value={form.genre}
              onChange={(e) => setForm({ ...form, genre: e.target.value })} placeholder={t("moveHome.genrePh")} />
          </label>
          <label className="block">
            <span className={`mb-1 block text-xs font-bold ${sub}`}>{t("moveHome.locationLabel")}</span>
            <input className={input} value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder={t("moveHome.locationPh")} />
          </label>
          <label className="block">
            <span className={`mb-1 block text-xs font-bold ${sub}`}>{t("moveHome.taglineLabel")}</span>
            <input className={input} value={form.tagline}
              onChange={(e) => setForm({ ...form, tagline: e.target.value })} placeholder={t("moveHome.taglinePh")} />
          </label>
        </div>
        <label className="mt-3 block">
          <span className={`mb-1 block text-xs font-bold ${sub}`}>{t("moveHome.bioSeedLabel")}</span>
          <textarea data-testid="mh-bio-seed" className={input} rows={2} value={form.bioSeed}
            onChange={(e) => setForm({ ...form, bioSeed: e.target.value })}
            placeholder={t("moveHome.bioSeedPh")} />
        </label>
        <label className="mt-3 block">
          <span className={`mb-1 block text-xs font-bold ${sub}`}>{t("moveHome.starterProductLabel")}</span>
          <input className={input} value={form.starterProductTitle}
            onChange={(e) => setForm({ ...form, starterProductTitle: e.target.value })} placeholder={t("moveHome.starterProductPh")} />
        </label>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            data-testid="mh-save-answers"
            disabled={busy !== ""}
            onClick={() => run("answers", () => call("PUT", "/api/move-home/answers", {
              displayName: form.displayName || undefined,
              handle: form.handle || undefined,
              vertical: form.vertical,
              genre: form.genre || undefined,
              location: form.location || undefined,
              tagline: form.tagline || undefined,
              bioSeed: form.bioSeed || undefined,
              starterProductTitle: form.starterProductTitle || undefined,
            }), t("moveHome.answersSaved"))}
            className="rounded-xl border border-primary/40 px-4 py-2 text-sm font-bold text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
          >
            {busy === "answers" ? <Loader2 className="h-4 w-4 animate-spin" /> : t("moveHome.saveAnswers")}
          </button>
          <button
            type="button"
            data-testid="mh-draft"
            disabled={busy !== ""}
            onClick={() => run("draft", () => call("POST", "/api/move-home/draft"), drafted ? t("moveHome.draftsRefreshed") : t("moveHome.homeDrafted"))}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-black transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy === "draft" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {drafted ? t("moveHome.redraftHome") : t("moveHome.draftHome")}
          </button>
          {data.drafts.copySource && (
            <span className={`self-center text-xs ${sub}`}>
              {data.drafts.copySource === "ai"
                ? t("moveHome.copyAi")
                : t("moveHome.copyAssembled")}
            </span>
          )}
        </div>
      </section>

      {/* ── Steps ── */}
      <div className="mt-6 space-y-4">
        {data.steps.map((step) => (
          <section key={step.key} data-testid={`mh-step-${step.key}`} className={`p-5 ${card}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 border border-primary/25 text-primary">
                  {STEP_ICON[step.key]}
                </div>
                <div>
                  <h3 className={`text-base font-black ${head}`}>{step.title}</h3>
                  <p className={`mt-0.5 max-w-lg text-xs ${sub}`}>{step.blurb}</p>
                </div>
              </div>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${
                  step.status === "approved"
                    ? "bg-emerald-500/15 text-emerald-400"
                    : step.status === "drafted"
                      ? "bg-primary/15 text-primary"
                      : isLight ? "bg-zinc-500/10 text-zinc-500" : "bg-white/[0.05] text-zinc-400"
                }`}
              >
                {step.status === "approved" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <CircleDashed className="h-3.5 w-3.5" />}
                {step.status === "approved" ? t("moveHome.statusLive") : step.status === "drafted" ? t("moveHome.statusDraftReady") : step.status === "skipped" ? t("moveHome.statusSkipped") : t("moveHome.statusWaiting")}
              </span>
            </div>

            {step.blockedReason && step.status !== "approved" && (
              <p className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] px-3 py-2 text-xs font-medium text-amber-300">
                {t(BLOCKED_COPY[step.blockedReason])}
              </p>
            )}

            {/* per-step draft previews */}
            {step.key === "profile" && data.drafts.profile && step.status !== "approved" && (
              <div className="mt-4 space-y-3">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <label className="block">
                    <span className={`mb-1 block text-xs font-bold ${sub}`}>{t("moveHome.nameLabel")}</span>
                    <input className={input} value={profileEdit.displayName}
                      onChange={(e) => setProfileEdit({ ...profileEdit, displayName: e.target.value })} />
                  </label>
                  <div>
                    <span className={`mb-1 block text-xs font-bold ${sub}`}>{t("moveHome.homeAddressLabel")}</span>
                    <p className={`rounded-xl border px-3 py-2 text-sm ${isLight ? "border-[#C9A84C]/40 text-zinc-700" : "border-white/10 text-zinc-300"}`}>
                      /artist/{data.drafts.profile.slug}
                      {data.drafts.profile.updatesExisting ? ` ${t("moveHome.updatesExistingNote")}` : ""}
                    </p>
                  </div>
                </div>
                <label className="block">
                  <span className={`mb-1 block text-xs font-bold ${sub}`}>{t("moveHome.bioLabel")}</span>
                  <textarea className={input} rows={3} value={profileEdit.bio}
                    onChange={(e) => setProfileEdit({ ...profileEdit, bio: e.target.value })} />
                </label>
                {Object.keys(data.drafts.profile.socialLinks).length > 0 && (
                  <p className={`text-xs ${sub}`}>
                    {t("moveHome.linksGoing", { links: Object.entries(data.drafts.profile.socialLinks).map(([k, v]) => `${k}: ${v}`).join(" · ") })}
                  </p>
                )}
                <button type="button" disabled={busy !== ""}
                  onClick={() => run("edit-profile", () => call("PATCH", "/api/move-home/drafts/profile", profileEdit), t("moveHome.profileDraftUpdated"))}
                  className="rounded-lg border border-primary/40 px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary/10 disabled:opacity-50">
                  {t("moveHome.saveDraftEdits")}
                </button>
              </div>
            )}

            {step.key === "store" && data.drafts.store && step.status !== "approved" && (
              <div className="mt-4 space-y-3">
                {data.drafts.store.products.map((p, i) => (
                  <div key={i} className={`rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/30" : "border-white/[0.07]"}`}>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_120px]">
                      <input aria-label={t("moveHome.productTitleAria")} className={input} value={storeEdit[i]?.title ?? p.title}
                        onChange={(e) => setStoreEdit(storeEdit.map((s, j) => (j === i ? { ...s, title: e.target.value } : s)))} />
                      <input aria-label={t("moveHome.priceAria")} className={input} inputMode="decimal" value={storeEdit[i]?.priceDollars ?? ""}
                        onChange={(e) => setStoreEdit(storeEdit.map((s, j) => (j === i ? { ...s, priceDollars: e.target.value } : s)))} />
                    </div>
                    <p className={`mt-2 text-xs ${sub}`}>{p.description}</p>
                    {p.suggestedPrice && (
                      <p className="mt-1 text-xs font-semibold text-amber-400">
                        {t("moveHome.suggestedPriceNote")}
                      </p>
                    )}
                    {p.sourceTrackId && <p className={`mt-1 text-xs ${sub}`}>{t("moveHome.fromCatalogNote")}</p>}
                  </div>
                ))}
                <button type="button" disabled={busy !== ""}
                  onClick={() => run("edit-store", () => call("PATCH", "/api/move-home/drafts/store", {
                    products: (data.drafts.store?.products ?? []).map((p, i) => ({
                      ...p,
                      title: storeEdit[i]?.title ?? p.title,
                      priceCents: Math.max(1, Math.round(parseFloat(storeEdit[i]?.priceDollars || "0") * 100)),
                    })),
                  }), t("moveHome.storeDraftUpdated"))}
                  className="rounded-lg border border-primary/40 px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary/10 disabled:opacity-50">
                  {t("moveHome.saveDraftEdits")}
                </button>
              </div>
            )}

            {step.key === "press_kit" && data.drafts.press_kit && step.status !== "approved" && (
              <div className={`mt-4 rounded-xl border p-3 text-sm ${isLight ? "border-[#C9A84C]/30" : "border-white/[0.07]"}`}>
                <p className={`font-bold ${head}`}>{data.drafts.press_kit.artistName}</p>
                <p className={`text-xs italic ${sub}`}>{data.drafts.press_kit.tagline}</p>
                <p className={`mt-2 text-xs ${sub}`}>{data.drafts.press_kit.bio}</p>
                <p className={`mt-2 text-xs ${sub}`}>
                  {t("moveHome.publishesAt", { handle: data.drafts.press_kit.handle, count: data.drafts.press_kit.topTracks.length })}
                </p>
              </div>
            )}

            {step.key === "email_list" && data.drafts.email_list && step.status !== "approved" && (
              <div className={`mt-4 rounded-xl border p-3 text-sm ${isLight ? "border-[#C9A84C]/30" : "border-white/[0.07]"}`}>
                <p className={`font-bold ${head}`}>{data.drafts.email_list.name}</p>
                <p className={`text-xs ${sub}`}>{t("moveHome.fansJoinAt", { handle: data.drafts.email_list.handle })}{data.drafts.email_list.updatesExisting ? ` ${t("moveHome.fansJoinUpdates")}` : ""}</p>
                <p className={`mt-2 text-xs ${sub}`}>{t("moveHome.welcomeSubject")} <span className="font-semibold">{data.drafts.email_list.welcomeSubject}</span></p>
                <p className={`mt-1 whitespace-pre-line text-xs ${sub}`}>{data.drafts.email_list.welcomeBody}</p>
              </div>
            )}

            {step.key === "launch_posts" && data.drafts.launch_posts && step.status !== "approved" && (
              <div className="mt-4 space-y-3">
                {data.drafts.launch_posts.posts.length === 0 && (
                  <p className={`text-xs ${sub}`}>{t("moveHome.noLaunchDrafts")}</p>
                )}
                {data.drafts.launch_posts.posts.map((p, i) => (
                  <div key={i} className={`rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/30" : "border-white/[0.07]"}`}>
                    <p className="text-xs font-bold text-primary">{p.accountLabel}</p>
                    <p className={`mt-1 text-sm ${head}`}>{p.caption}</p>
                    <p className={`mt-1 text-xs ${sub}`}>{p.hashtags}</p>
                    <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-[1fr_130px]">
                      <input aria-label={t("moveHome.mediaUrlAria")} className={input} placeholder={t("moveHome.mediaUrlPh")}
                        value={launchMedia[i]?.mediaUrl ?? ""}
                        onChange={(e) => setLaunchMedia(launchMedia.map((m, j) => (j === i ? { ...m, mediaUrl: e.target.value } : m)))} />
                      <select aria-label={t("moveHome.mediaTypeAria")} className={input} value={launchMedia[i]?.mediaType ?? "image"}
                        onChange={(e) => setLaunchMedia(launchMedia.map((m, j) => (j === i ? { ...m, mediaType: e.target.value as "video" | "image" } : m)))}>
                        <option value="image">{t("moveHome.mediaImage")}</option>
                        <option value="video">{t("moveHome.mediaVideo")}</option>
                      </select>
                    </div>
                    <p className={`mt-1 text-xs ${sub}`}>{t("moveHome.schedulerNote")}</p>
                  </div>
                ))}
                {data.drafts.launch_posts.posts.length > 0 && (
                  <button type="button" disabled={busy !== ""}
                    onClick={() => run("edit-launch", () => call("PATCH", "/api/move-home/drafts/launch_posts", {
                      posts: (data.drafts.launch_posts?.posts ?? []).map((p, i) => ({
                        ...p,
                        mediaUrl: launchMedia[i]?.mediaUrl ? launchMedia[i].mediaUrl : null,
                        mediaType: launchMedia[i]?.mediaType ?? p.mediaType,
                      })),
                    }), t("moveHome.launchDraftsUpdated"))}
                    className="rounded-lg border border-primary/40 px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary/10 disabled:opacity-50">
                    {t("moveHome.saveDraftEdits")}
                  </button>
                )}
              </div>
            )}

            {/* actions */}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {step.status === "drafted" && (
                <button
                  type="button"
                  data-testid={`mh-approve-${step.key}`}
                  disabled={busy !== ""}
                  onClick={() => run(`approve-${step.key}`, () => call("POST", `/api/move-home/steps/${step.key}/approve`), t("moveHome.approveSuccess", { title: step.title, done: doneCount + 1, total: data.steps.length }))}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-black transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {busy === `approve-${step.key}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  {t("moveHome.approveLive")}
                </button>
              )}
              {step.status === "approved" && (
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" /> {t("moveHome.liveApprovedByYou")}
                </span>
              )}
              {(step.status === "drafted" || step.status === "pending") && (
                <button type="button" disabled={busy !== ""}
                  onClick={() => run(`skip-${step.key}`, () => call("POST", `/api/move-home/steps/${step.key}/skip`), t("moveHome.skippedMsg"))}
                  className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition-colors disabled:opacity-50 ${isLight ? "border-zinc-300 text-zinc-600 hover:bg-zinc-100" : "border-white/10 text-zinc-300 hover:bg-white/[0.05]"}`}>
                  <Ban className="h-3.5 w-3.5" /> {t("moveHome.skipForNow")}
                </button>
              )}
              {step.status === "skipped" && (
                <button type="button" disabled={busy !== ""}
                  onClick={() => run(`reopen-${step.key}`, () => call("POST", `/api/move-home/steps/${step.key}/reopen`), t("moveHome.reopenedMsg"))}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-primary/40 px-3 py-2 text-xs font-bold text-primary hover:bg-primary/10 disabled:opacity-50">
                  <RotateCcw className="h-3.5 w-3.5" /> {t("moveHome.reopen")}
                </button>
              )}
            </div>
          </section>
        ))}
      </div>

      <p className={`mt-6 text-center text-xs ${sub}`}>
        {t("moveHome.stepsDoneFooter", { done: doneCount, total: data.steps.length })}
      </p>
    </div>
  );
}
