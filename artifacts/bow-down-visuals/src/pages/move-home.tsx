import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import {
  Home, Loader2, CheckCircle2, CircleDashed, Sparkles, Store, Newspaper,
  Mail, Megaphone, UserRound, ArrowRight, Ban, RotateCcw, PartyPopper, Library,
} from "lucide-react";
import { useTranslation } from "react-i18next";
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
  ["music", "Music"], ["video", "Video"], ["gaming", "Gaming / Streaming"],
  ["podcast", "Podcast"], ["film", "Film"], ["tv", "TV / Series"],
  ["influencer", "Influencer"], ["education", "Education"], ["other", "Other"],
] as const;

const STEP_ICON: Record<StepKey, React.ReactNode> = {
  profile: <UserRound className="h-5 w-5" />,
  store: <Store className="h-5 w-5" />,
  press_kit: <Newspaper className="h-5 w-5" />,
  email_list: <Mail className="h-5 w-5" />,
  launch_posts: <Megaphone className="h-5 w-5" />,
};

const BLOCKED_COPY: Record<string, string> = {
  no_connected_accounts:
    "Connect Instagram, TikTok, or Facebook first (your profile's connected accounts), then re-draft — launch posts only ever go to accounts you've actually connected.",
  needs_media:
    "A launch post needs one of your own images or videos. Add a media link from your uploads below — nothing is ever fabricated.",
  needs_profile:
    "Approve your profile step first — your store hangs on your profile.",
};

export default function MoveHome() {
  usePageTitle(
    "Move Home",
    "Move Home drafts your whole creator home in one pass — Grand Stage profile, starter store, press kit, email list and launch posts — from your answers, your existing content, and the social accounts you've already connected. Everything lands as a draft and goes live only when you approve it.",
  );
  const isLight = useIsLightTheme();
  const { i18n } = useTranslation();
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

  /* Every call carries the current language as ?locale= — the server
     composes step titles/blurbs and new drafts in it (server-side
     catalogs); stored drafts keep the language they were made in. */
  const call = useCallback(
    async (method: string, path: string, body?: unknown): Promise<MoveHomeData | null> => {
      const token = await getAccessToken();
      const sep = path.includes("?") ? "&" : "?";
      const res = await fetch(`${path}${sep}locale=${encodeURIComponent(i18n.language)}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as { moveHome?: MoveHomeData; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Something went wrong. Try again.");
      return json.moveHome ?? null;
    },
    [getAccessToken, i18n.language],
  );

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const d = await call("GET", "/api/move-home");
        if (!cancelled && d) syncFrom(d);
      } catch {
        if (!cancelled) setLoadError("Your move wouldn't load. Refresh to try again.");
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
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
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
        <h1 className={`mt-4 text-2xl font-black ${head}`}>Move Home</h1>
        <p className={`mt-2 text-sm ${sub}`}>Sign in to start your move — your business lives here.</p>
        <Link href="/login?next=/move-home" className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-black">
          Sign in <ArrowRight className="h-4 w-4" />
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
          <h1 className={`text-2xl font-black md:text-3xl ${head}`}>Move Home</h1>
          <p className={`mt-1 max-w-xl text-sm ${sub}`}>
            The socials gave you an audience. This is the home it lives in. Thy Cheat Code drafts your
            profile, store, press kit, email list, and launch posts in one pass —{" "}
            <span className="font-semibold text-primary">nothing goes live until you approve each piece.</span>{" "}
            Free, and it remembers where you left off.
          </p>
        </div>
      </div>

      {/* ── Context strip ── */}
      <div className={`mt-5 flex flex-wrap items-center gap-2 text-xs font-semibold ${sub}`}>
        <span className={`rounded-full border px-3 py-1 ${isLight ? "border-[#C9A84C]/40" : "border-white/10"}`}>
          {data.context.hasProfile ? `Profile live: /artist/${data.context.profileSlug}` : "No profile yet — step 1 builds it"}
        </span>
        {data.context.connectedPlatforms.map((p) => (
          <span key={p.platform} className="rounded-full border border-primary/30 bg-primary/[0.07] px-3 py-1 text-primary">
            Connected: {p.label}
          </span>
        ))}
        {data.context.connectedPlatforms.length === 0 && (
          <span className={`rounded-full border px-3 py-1 ${isLight ? "border-[#C9A84C]/40" : "border-white/10"}`}>
            No socials connected yet — launch posts unlock when you connect one
          </span>
        )}
        <span className={`rounded-full border px-3 py-1 ${isLight ? "border-[#C9A84C]/40" : "border-white/10"}`}>
          {data.context.trackCount} tracks · {data.context.videoCount} videos already home
        </span>
      </div>

      {/* ── Sibling door: the back-catalog migration assistant ── */}
      <Link href="/catalog-import" className={`mt-5 flex items-start gap-3 p-5 ${card} transition-colors hover:border-primary/50`}>
        <Library className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <span className="text-sm">
          <span className={`font-black ${head}`}>Your body of work is still on the socials?</span>
          <span className={`mt-1 block ${sub}`}>
            Bring your catalog home — pick from your connected accounts or bulk-upload your files, and
            Thy Cheat Code rebuilds the titles, captions and chapters re-uploading would cost you.{" "}
            <span className="font-semibold text-primary">Open the catalog move →</span>
          </span>
        </span>
      </Link>

      {data.completedAt && (
        <div className={`mt-6 flex items-start gap-3 p-5 ${card}`}>
          <PartyPopper className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div className="text-sm">
            <p className={`font-black ${head}`}>Your home is live. 🏠</p>
            <p className={`mt-1 ${sub}`}>
              Every piece you approved is in its real home now — keep building from there:
              {data.context.profileSlug && (
                <> <Link className="font-semibold text-primary underline underline-offset-2" href={`/artist/${data.context.profileSlug}`}>your profile</Link> ·</>
              )}{" "}
              <Link className="font-semibold text-primary underline underline-offset-2" href="/storefronts">your store</Link> ·{" "}
              <Link className="font-semibold text-primary underline underline-offset-2" href="/email-list">your email list</Link> ·{" "}
              <Link className="font-semibold text-primary underline underline-offset-2" href="/scheduler">post scheduler</Link>
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
          <Sparkles className="h-4 w-4 text-primary" /> Tell Thy Cheat Code about you
        </h2>
        <p className={`mt-1 text-xs ${sub}`}>
          Your words are the source — drafts are built from these answers, your existing work, and your
          connected accounts only. Nothing is imported from a platform you haven't connected.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="block">
            <span className={`mb-1 block text-xs font-bold ${sub}`}>Creator / stage name</span>
            <input data-testid="mh-display-name" className={input} value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })} placeholder="Nova Reign" />
          </label>
          <label className="block">
            <span className={`mb-1 block text-xs font-bold ${sub}`}>Your handle (your home's address)</span>
            <input data-testid="mh-handle" className={input} value={form.handle}
              onChange={(e) => setForm({ ...form, handle: e.target.value })} placeholder="nova-reign" />
          </label>
          <label className="block">
            <span className={`mb-1 block text-xs font-bold ${sub}`}>What you create</span>
            <select data-testid="mh-vertical" className={input} value={form.vertical}
              onChange={(e) => setForm({ ...form, vertical: e.target.value })}>
              {VERTICALS.map(([v, label]) => (<option key={v} value={v}>{label}</option>))}
            </select>
          </label>
          <label className="block">
            <span className={`mb-1 block text-xs font-bold ${sub}`}>Genre / niche</span>
            <input className={input} value={form.genre}
              onChange={(e) => setForm({ ...form, genre: e.target.value })} placeholder="soul trap" />
          </label>
          <label className="block">
            <span className={`mb-1 block text-xs font-bold ${sub}`}>Based in</span>
            <input className={input} value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Atlanta" />
          </label>
          <label className="block">
            <span className={`mb-1 block text-xs font-bold ${sub}`}>Tagline</span>
            <input className={input} value={form.tagline}
              onChange={(e) => setForm({ ...form, tagline: e.target.value })} placeholder="Late-night soul for heavy hearts" />
          </label>
        </div>
        <label className="mt-3 block">
          <span className={`mb-1 block text-xs font-bold ${sub}`}>Describe yourself in a sentence or two (your bio seed)</span>
          <textarea data-testid="mh-bio-seed" className={input} rows={2} value={form.bioSeed}
            onChange={(e) => setForm({ ...form, bioSeed: e.target.value })}
            placeholder="I make soul trap for late-night drivers." />
        </label>
        <label className="mt-3 block">
          <span className={`mb-1 block text-xs font-bold ${sub}`}>Starter product name (only if your catalog has nothing priced yet)</span>
          <input className={input} value={form.starterProductTitle}
            onChange={(e) => setForm({ ...form, starterProductTitle: e.target.value })} placeholder="Supporter Pack" />
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
            }), "Answers saved — they'll shape your drafts.")}
            className="rounded-xl border border-primary/40 px-4 py-2 text-sm font-bold text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
          >
            {busy === "answers" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save answers"}
          </button>
          <button
            type="button"
            data-testid="mh-draft"
            disabled={busy !== ""}
            onClick={() => run("draft", () => call("POST", "/api/move-home/draft"), drafted ? "Drafts refreshed — review each piece below." : "Your home is drafted — review each piece below. Nothing is live yet.")}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-black transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy === "draft" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {drafted ? "Re-draft my home" : "Draft my home"}
          </button>
          {data.drafts.copySource && (
            <span className={`self-center text-xs ${sub}`}>
              {data.drafts.copySource === "ai"
                ? "Copy polished by Thy Cheat Code."
                : "Copy assembled from your answers."}
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
                {step.status === "approved" ? "Live" : step.status === "drafted" ? "Draft ready" : step.status === "skipped" ? "Skipped" : "Waiting"}
              </span>
            </div>

            {step.blockedReason && step.status !== "approved" && (
              <p className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] px-3 py-2 text-xs font-medium text-amber-300">
                {BLOCKED_COPY[step.blockedReason]}
              </p>
            )}

            {/* per-step draft previews */}
            {step.key === "profile" && data.drafts.profile && step.status !== "approved" && (
              <div className="mt-4 space-y-3">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <label className="block">
                    <span className={`mb-1 block text-xs font-bold ${sub}`}>Name</span>
                    <input className={input} value={profileEdit.displayName}
                      onChange={(e) => setProfileEdit({ ...profileEdit, displayName: e.target.value })} />
                  </label>
                  <div>
                    <span className={`mb-1 block text-xs font-bold ${sub}`}>Home address</span>
                    <p className={`rounded-xl border px-3 py-2 text-sm ${isLight ? "border-[#C9A84C]/40 text-zinc-700" : "border-white/10 text-zinc-300"}`}>
                      /artist/{data.drafts.profile.slug}
                      {data.drafts.profile.updatesExisting ? " (your existing profile — approval updates it)" : ""}
                    </p>
                  </div>
                </div>
                <label className="block">
                  <span className={`mb-1 block text-xs font-bold ${sub}`}>Bio</span>
                  <textarea className={input} rows={3} value={profileEdit.bio}
                    onChange={(e) => setProfileEdit({ ...profileEdit, bio: e.target.value })} />
                </label>
                {Object.keys(data.drafts.profile.socialLinks).length > 0 && (
                  <p className={`text-xs ${sub}`}>
                    Links going on the profile: {Object.entries(data.drafts.profile.socialLinks).map(([k, v]) => `${k}: ${v}`).join(" · ")}
                  </p>
                )}
                <button type="button" disabled={busy !== ""}
                  onClick={() => run("edit-profile", () => call("PATCH", "/api/move-home/drafts/profile", profileEdit), "Profile draft updated.")}
                  className="rounded-lg border border-primary/40 px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary/10 disabled:opacity-50">
                  Save draft edits
                </button>
              </div>
            )}

            {step.key === "store" && data.drafts.store && step.status !== "approved" && (
              <div className="mt-4 space-y-3">
                {data.drafts.store.products.map((p, i) => (
                  <div key={i} className={`rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/30" : "border-white/[0.07]"}`}>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_120px]">
                      <input aria-label="Product title" className={input} value={storeEdit[i]?.title ?? p.title}
                        onChange={(e) => setStoreEdit(storeEdit.map((s, j) => (j === i ? { ...s, title: e.target.value } : s)))} />
                      <input aria-label="Price in dollars" className={input} inputMode="decimal" value={storeEdit[i]?.priceDollars ?? ""}
                        onChange={(e) => setStoreEdit(storeEdit.map((s, j) => (j === i ? { ...s, priceDollars: e.target.value } : s)))} />
                    </div>
                    <p className={`mt-2 text-xs ${sub}`}>{p.description}</p>
                    {p.suggestedPrice && (
                      <p className="mt-1 text-xs font-semibold text-amber-400">
                        Suggested price — set your real price above before approving.
                      </p>
                    )}
                    {p.sourceTrackId && <p className={`mt-1 text-xs ${sub}`}>From your catalog — price carried over from the track itself.</p>}
                  </div>
                ))}
                <button type="button" disabled={busy !== ""}
                  onClick={() => run("edit-store", () => call("PATCH", "/api/move-home/drafts/store", {
                    products: (data.drafts.store?.products ?? []).map((p, i) => ({
                      ...p,
                      title: storeEdit[i]?.title ?? p.title,
                      priceCents: Math.max(1, Math.round(parseFloat(storeEdit[i]?.priceDollars || "0") * 100)),
                    })),
                  }), "Store draft updated.")}
                  className="rounded-lg border border-primary/40 px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary/10 disabled:opacity-50">
                  Save draft edits
                </button>
              </div>
            )}

            {step.key === "press_kit" && data.drafts.press_kit && step.status !== "approved" && (
              <div className={`mt-4 rounded-xl border p-3 text-sm ${isLight ? "border-[#C9A84C]/30" : "border-white/[0.07]"}`}>
                <p className={`font-bold ${head}`}>{data.drafts.press_kit.artistName}</p>
                <p className={`text-xs italic ${sub}`}>{data.drafts.press_kit.tagline}</p>
                <p className={`mt-2 text-xs ${sub}`}>{data.drafts.press_kit.bio}</p>
                <p className={`mt-2 text-xs ${sub}`}>
                  Publishes at /press/{data.drafts.press_kit.handle} · {data.drafts.press_kit.topTracks.length} top tracks from your catalog
                </p>
              </div>
            )}

            {step.key === "email_list" && data.drafts.email_list && step.status !== "approved" && (
              <div className={`mt-4 rounded-xl border p-3 text-sm ${isLight ? "border-[#C9A84C]/30" : "border-white/[0.07]"}`}>
                <p className={`font-bold ${head}`}>{data.drafts.email_list.name}</p>
                <p className={`text-xs ${sub}`}>Fans join at /join/{data.drafts.email_list.handle}{data.drafts.email_list.updatesExisting ? " — you already have this list; approval sets the welcome email on it" : ""}</p>
                <p className={`mt-2 text-xs ${sub}`}>Welcome subject: <span className="font-semibold">{data.drafts.email_list.welcomeSubject}</span></p>
                <p className={`mt-1 whitespace-pre-line text-xs ${sub}`}>{data.drafts.email_list.welcomeBody}</p>
              </div>
            )}

            {step.key === "launch_posts" && data.drafts.launch_posts && step.status !== "approved" && (
              <div className="mt-4 space-y-3">
                {data.drafts.launch_posts.posts.length === 0 && (
                  <p className={`text-xs ${sub}`}>No launch drafts yet — they appear for each social account you connect.</p>
                )}
                {data.drafts.launch_posts.posts.map((p, i) => (
                  <div key={i} className={`rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/30" : "border-white/[0.07]"}`}>
                    <p className="text-xs font-bold text-primary">{p.accountLabel}</p>
                    <p className={`mt-1 text-sm ${head}`}>{p.caption}</p>
                    <p className={`mt-1 text-xs ${sub}`}>{p.hashtags}</p>
                    <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-[1fr_130px]">
                      <input aria-label="Launch media URL" className={input} placeholder="Your image or video link"
                        value={launchMedia[i]?.mediaUrl ?? ""}
                        onChange={(e) => setLaunchMedia(launchMedia.map((m, j) => (j === i ? { ...m, mediaUrl: e.target.value } : m)))} />
                      <select aria-label="Media type" className={input} value={launchMedia[i]?.mediaType ?? "image"}
                        onChange={(e) => setLaunchMedia(launchMedia.map((m, j) => (j === i ? { ...m, mediaType: e.target.value as "video" | "image" } : m)))}>
                        <option value="image">Image</option>
                        <option value="video">Video</option>
                      </select>
                    </div>
                    <p className={`mt-1 text-xs ${sub}`}>Approval saves this to your Post Scheduler as a draft — it does not post. You choose when it fires.</p>
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
                    }), "Launch drafts updated.")}
                    className="rounded-lg border border-primary/40 px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary/10 disabled:opacity-50">
                    Save draft edits
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
                  onClick={() => run(`approve-${step.key}`, () => call("POST", `/api/move-home/steps/${step.key}/approve`), `${step.title} is live. ${doneCount + 1} of ${data.steps.length} steps done.`)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-black transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {busy === `approve-${step.key}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Approve — take it live
                </button>
              )}
              {step.status === "approved" && (
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" /> Live — approved by you
                </span>
              )}
              {(step.status === "drafted" || step.status === "pending") && (
                <button type="button" disabled={busy !== ""}
                  onClick={() => run(`skip-${step.key}`, () => call("POST", `/api/move-home/steps/${step.key}/skip`), "Skipped — you can reopen it anytime.")}
                  className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition-colors disabled:opacity-50 ${isLight ? "border-zinc-300 text-zinc-600 hover:bg-zinc-100" : "border-white/10 text-zinc-300 hover:bg-white/[0.05]"}`}>
                  <Ban className="h-3.5 w-3.5" /> Skip for now
                </button>
              )}
              {step.status === "skipped" && (
                <button type="button" disabled={busy !== ""}
                  onClick={() => run(`reopen-${step.key}`, () => call("POST", `/api/move-home/steps/${step.key}/reopen`), "Reopened.")}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-primary/40 px-3 py-2 text-xs font-bold text-primary hover:bg-primary/10 disabled:opacity-50">
                  <RotateCcw className="h-3.5 w-3.5" /> Reopen
                </button>
              )}
            </div>
          </section>
        ))}
      </div>

      <p className={`mt-6 text-center text-xs ${sub}`}>
        {doneCount} of {data.steps.length} steps done · Move Home is free — anything that costs Visual Bucs
        later (like scheduling a post) asks you on its own rail first, never bundled in here.
      </p>
    </div>
  );
}
