import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Loader2, Plus, Trash2, ArrowUp, ArrowDown, Check, Copy, Share2,
  ExternalLink, Eye, BarChart3, Link2, ChevronDown, Sparkles, CircleAlert,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useHubProject } from "@/lib/hub-project";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useToast } from "@/hooks/use-toast";
import { OutOfCredits } from "@/components/OutOfCredits";
import {
  BIO_THEMES, bioTheme, BioPageView, BioLinkIcon, SOCIAL_DEFS,
  type BioPageData, type BioLinkRow, type BioFeaturedItem,
} from "./bio-themes";

/* ─── Link-in-Bio Builder ───────────────────────────────────────────────────
   Docked as a tab in /promote. Creators design their public /bio/:slug page:
   profile header (prefilled from the artist vault — no re-typing), gold/black
   luxury themes, link rows, social icons, featured hub assets, tip-jar link.
   Drafting is free; publishing costs 100 Visual Bucs (server-enforced). */

const PUBLISH_COST = 100;

interface Vault {
  id: string;
  artist_name: string;
  description?: string | null;
  reference_image_url?: string | null;
  is_active?: boolean | null;
}

interface BioPageFull extends BioPageData {
  id: string;
  isPublished: boolean;
  url: string;
  updatedAt: string;
}

interface Analytics {
  views: number;
  totalClicks: number;
  clicksLast7d: number;
  perLink: Array<{ linkTitle: string; clicks: number }>;
}

const LINK_ICON_KEYS = [
  "link", "music", "video", "mic", "shopping-bag", "ticket", "calendar",
  "mail", "heart", "star", "crown", "sparkles", "globe", "image", "play",
];

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";
const labelClass = "text-xs font-bold uppercase tracking-widest text-white/45";
const sectionClass = "rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.05] to-transparent p-6";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function slugify(name: string): string {
  const s = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return s || "bio";
}

export function LinkInBioBuilder() {
  const { t } = useTranslation();
  const { user, getAccessToken, refreshProfile } = useAuth();
  const { project, referralCode } = useHubProject();
  const { confirmedFetch } = useConfirmedApi();
  const { toast } = useToast();

  const [pages, setPages] = useState<BioPageFull[]>([]);
  const [pageId, setPageId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [unpublishing, setUnpublishing] = useState(false);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  /* form state */
  const [displayName, setDisplayName] = useState("");
  const [headline, setHeadline] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [slug, setSlug] = useState("");
  const [theme, setTheme] = useState("gold-royal");
  const [links, setLinks] = useState<BioLinkRow[]>([]);
  const [socials, setSocials] = useState<Record<string, string>>({});
  const [featured, setFeatured] = useState<BioFeaturedItem[]>([]);
  const [tipJarUrl, setTipJarUrl] = useState("");

  const [vaults, setVaults] = useState<Vault[]>([]);
  const [vaultId, setVaultId] = useState("");
  const [prefilled, setPrefilled] = useState(false);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const page = useMemo(() => pages.find((p) => p.id === pageId) ?? null, [pages, pageId]);

  async function authed(path: string, init?: RequestInit) {
    const token = await getAccessToken();
    const res = await fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
    return res;
  }

  function fillForm(p: BioPageFull) {
    setDisplayName(p.displayName);
    setHeadline(p.headline);
    setBio(p.bio);
    setAvatarUrl(p.avatarUrl ?? "");
    setSlug(p.slug);
    setTheme(p.theme);
    setLinks(p.links.map((l) => ({ ...l })));
    setSocials({ ...(p.socials ?? {}) });
    setFeatured(p.featured.map((f) => ({ ...f })));
    setTipJarUrl(p.tipJarUrl ?? "");
    setOutOfCredits(false);
  }

  async function load() {
    if (!user) { setLoading(false); return; }
    setLoading(true);
    setLoadError(null);
    try {
      const [pagesRes, vaultsRes] = await Promise.all([
        authed("/api/bio-pages/me"),
        authed("/api/artist-vaults"),
      ]);
      if (pagesRes.ok) {
        const d = await pagesRes.json();
        const list: BioPageFull[] = d.pages ?? [];
        setPages(list);
        const first = list[0];
        if (first) { setPageId(first.id); fillForm(first); }
      } else {
        throw new Error(t("linkInBio.errors.loadFailed"));
      }
      if (vaultsRes.ok) {
        const v = await vaultsRes.json();
        setVaults(v.vaults ?? v ?? []);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t("linkInBio.errors.loadFailed"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user]);

  useEffect(() => {
    if (!pageId) { setAnalytics(null); return; }
    setAnalyticsLoading(true);
    (async () => {
      try {
        const res = await authed(`/api/bio-pages/${pageId}/analytics`);
        if (res.ok) setAnalytics(await res.json());
      } catch { /* analytics is non-fatal */ }
      finally { setAnalyticsLoading(false); }
    })();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [pageId]);

  function prefillFromVault(vault: Vault) {
    setDisplayName(vault.artist_name);
    if (vault.description) setBio(vault.description);
    if (vault.reference_image_url) setAvatarUrl(vault.reference_image_url);
    setSlug((s) => (s ? s : slugify(vault.artist_name)));
    setPrefilled(true);
  }

  function cleanAvatar(): string | null {
    const v = avatarUrl.trim();
    return v.startsWith("http") ? v : null;
  }

  function draftBody() {
    return {
      displayName: displayName.trim() || "My Page",
      headline: headline.trim(),
      bio: bio.trim(),
      avatarUrl: cleanAvatar(),
      slug: slug.trim() && SLUG_RE.test(slug.trim()) ? slug.trim() : undefined,
      theme,
      links,
      socials,
      featured,
      tipJarUrl: tipJarUrl.trim() || null,
    };
  }

  async function createDraft(): Promise<string | null> {
    setSaving(true);
    try {
      const res = await authed("/api/bio-pages", { method: "POST", body: JSON.stringify(draftBody()) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || t("linkInBio.errors.saveFailed"));
      const np: BioPageFull = d.page;
      setPages((ps) => [np, ...ps]);
      setPageId(np.id);
      fillForm(np);
      toast({ title: t("linkInBio.actions.draftSaved") });
      return np.id;
    } catch (err) {
      toast({ title: t("linkInBio.errors.saveFailed"), description: err instanceof Error ? err.message : undefined });
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function saveDraft() {
    if (!pageId) { await createDraft(); return; }
    if (!displayName.trim()) { toast({ title: t("linkInBio.errors.needName") }); return; }
    if (slug.trim() && !SLUG_RE.test(slug.trim())) { toast({ title: t("linkInBio.profile.slugInvalid") }); return; }
    setSaving(true);
    try {
      const res = await authed(`/api/bio-pages/${pageId}`, {
        method: "PUT",
        body: JSON.stringify({ ...draftBody(), displayName: displayName.trim(), slug: slug.trim() || undefined }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || t("linkInBio.errors.saveFailed"));
      const np: BioPageFull = d.page;
      setPages((ps) => ps.map((p) => (p.id === pageId ? np : p)));
      fillForm(np);
      toast({ title: t("linkInBio.actions.draftSaved") });
    } catch (err) {
      toast({ title: t("linkInBio.errors.saveFailed"), description: err instanceof Error ? err.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    if (publishing) return;
    if (!displayName.trim()) { toast({ title: t("linkInBio.errors.needName") }); return; }
    if (links.length === 0) { toast({ title: t("linkInBio.links.needOne") }); return; }
    setPublishing(true);
    setOutOfCredits(false);
    try {
      /* No draft yet: create one from the current form, then publish it. */
      let id = pageId;
      if (!id) {
        id = await createDraft();
        if (!id) throw new Error(t("linkInBio.errors.saveFailed"));
      } else {
        /* Save the latest edits first, then charge + publish. */
        await authed(`/api/bio-pages/${id}`, {
          method: "PUT",
          body: JSON.stringify({ ...draftBody(), displayName: displayName.trim(), slug: slug.trim() || undefined }),
        });
      }
      const res = await confirmedFetch(`/api/bio-publish/${id}`, {
        method: "POST",
        overrideCost: PUBLISH_COST,
        overrideFeature: "Publish Link-in-Bio Page",
      });
      if (!res) { setPublishing(false); return; } // user cancelled the credit confirmation
      const d = await res.json().catch(() => ({}));
      if (res.status === 402 || d.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (res.status === 409) {
        toast({ title: t("linkInBio.actions.alreadyPublished") });
        setPages((ps) => ps.map((p) => (p.id === id ? { ...p, isPublished: true, url: d.url ?? p.url } : p)));
        return;
      }
      if (!res.ok) throw new Error(d.message || d.error || t("linkInBio.errors.publishFailed"));
      setPages((ps) => ps.map((p) => (p.id === id ? { ...p, isPublished: true, url: d.url, slug: d.slug } : p)));
      setSlug(d.slug);
      refreshProfile();
      toast({ title: t("linkInBio.actions.published") });
    } catch (err) {
      toast({ title: t("linkInBio.errors.publishFailed"), description: err instanceof Error ? err.message : undefined });
    } finally {
      setPublishing(false);
    }
  }

  async function unpublish() {
    if (!pageId || unpublishing) return;
    setUnpublishing(true);
    try {
      const res = await authed(`/api/bio-pages/${pageId}/unpublish`, { method: "POST" });
      if (!res.ok) throw new Error(t("linkInBio.errors.publishFailed"));
      setPages((ps) => ps.map((p) => (p.id === pageId ? { ...p, isPublished: false } : p)));
      toast({ title: t("linkInBio.actions.unpublished") });
    } catch (err) {
      toast({ title: t("linkInBio.errors.publishFailed"), description: err instanceof Error ? err.message : undefined });
    } finally {
      setUnpublishing(false);
    }
  }

  const shareUrl = useMemo(() => {
    if (!page) return "";
    return referralCode ? `${page.url}?ref=${encodeURIComponent(referralCode)}` : page.url;
  }, [page, referralCode]);

  async function copyShare() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard unavailable */ }
  }

  async function share() {
    if (!shareUrl) return;
    try {
      if (navigator.share) {
        await navigator.share({ title: displayName || "Link in Bio", url: shareUrl });
      } else {
        await copyShare();
      }
    } catch { /* user cancelled */ }
  }

  function addLink() {
    setLinks((ls) => [...ls, { title: "", url: "", icon: "link" }]);
  }
  function moveLink(i: number, dir: -1 | 1) {
    setLinks((ls) => {
      const j = i + dir;
      if (j < 0 || j >= ls.length) return ls;
      const next = [...ls];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  }

  const hubAssets = project.assets.filter((a) => a.url && !a.url.startsWith("blob:"));
  const featuredUrls = new Set(featured.map((f) => f.url));

  const previewData: BioPageData = {
    slug: slug || "preview",
    displayName: displayName || "Your Name",
    headline,
    bio,
    avatarUrl: avatarUrl || null,
    links: links.filter((l) => l.title.trim()),
    socials,
    theme,
    featured,
    tipJarUrl: tipJarUrl || null,
  };

  if (!user) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
        <Link2 className="mx-auto h-8 w-8 text-primary" />
        <p className="mt-3 text-white/70">{t("promote.signIn.message")}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-center">
        <p className="text-sm text-red-200">{loadError}</p>
        <button onClick={load} className="mt-3 text-sm font-semibold text-white/70 hover:text-white">
          {t("common.retry", "Retry")}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* pages switcher */}
      {pages.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {pages.map((p) => (
            <button
              key={p.id}
              onClick={() => { setPageId(p.id); fillForm(p); }}
              className={`rounded-xl border px-4 py-2 text-sm font-semibold transition ${
                p.id === pageId
                  ? "border-primary/60 bg-primary/15 text-white"
                  : "border-white/10 bg-white/[0.03] text-white/55 hover:border-white/25 hover:text-white"
              }`}
            >
              {p.displayName || p.slug}
              {p.isPublished && <span className="ml-2 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />}
            </button>
          ))}
          <button
            onClick={() => { setPageId(null); setDisplayName(""); setHeadline(""); setBio(""); setAvatarUrl(""); setSlug(""); setTheme("gold-royal"); setLinks([]); setSocials({}); setFeatured([]); setTipJarUrl(""); setPrefilled(false); }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-dashed border-white/20 px-4 py-2 text-sm font-semibold text-white/55 transition hover:border-primary/50 hover:text-white"
          >
            <Plus className="h-4 w-4" /> New
          </button>
        </div>
      )}

      {/* profile */}
      <div className={sectionClass}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-bold">{t("linkInBio.profile.title")}</h3>
          {vaults.length > 0 && (
            <div className="flex items-center gap-2">
              <select
                value={vaultId}
                onChange={(e) => {
                  setVaultId(e.target.value);
                  const v = vaults.find((x) => x.id === e.target.value);
                  if (v) prefillFromVault(v);
                }}
                className="cursor-pointer appearance-none rounded-xl border border-white/10 bg-black/60 px-3 py-2 text-xs text-white/70 outline-none focus:border-primary/60"
              >
                <option value="">{t("linkInBio.profile.prefill")}</option>
                {vaults.map((v) => (
                  <option key={v.id} value={v.id} className="bg-black">{v.artist_name}</option>
                ))}
              </select>
            </div>
          )}
        </div>
        {vaults.length === 0 && (
          <p className="mb-4 text-xs text-white/35">{t("linkInBio.profile.noVaults")}</p>
        )}
        {prefilled && (
          <p className="mb-4 inline-flex items-center gap-1.5 text-xs text-emerald-300">
            <Check className="h-3.5 w-3.5" /> {t("linkInBio.profile.prefillDone")}
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass}>{t("linkInBio.profile.displayName")}</label>
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={80}
              placeholder={t("linkInBio.profile.displayNamePlaceholder")} className={`${inputClass} mt-2`} />
          </div>
          <div>
            <label className={labelClass}>{t("linkInBio.profile.headline")}</label>
            <input value={headline} onChange={(e) => setHeadline(e.target.value)} maxLength={120}
              placeholder={t("linkInBio.profile.headlinePlaceholder")} className={`${inputClass} mt-2`} />
          </div>
        </div>
        <div className="mt-4">
          <label className={labelClass}>{t("linkInBio.profile.bio")}</label>
          <textarea value={bio} onChange={(e) => setBio(e.target.value)} maxLength={600} rows={3}
            placeholder={t("linkInBio.profile.bioPlaceholder")} className={`${inputClass} mt-2 resize-none`} />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass}>{t("linkInBio.profile.avatarUrl")}</label>
            <div className="mt-2 flex items-center gap-3">
              {avatarUrl ? (
                <img src={avatarUrl} alt="" className="h-11 w-11 shrink-0 rounded-full border border-amber-400/50 object-cover" />
              ) : (
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-amber-700 text-lg font-bold text-black">
                  {(displayName || "?").charAt(0).toUpperCase()}
                </div>
              )}
              <input value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} maxLength={800}
                placeholder={t("linkInBio.profile.avatarUrlPlaceholder")} className={inputClass} />
            </div>
          </div>
          <div>
            <label className={labelClass}>{t("linkInBio.profile.slug")}</label>
            <input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} maxLength={40}
              placeholder={slugify(displayName) || "my-handle"} className={`${inputClass} mt-2`} />
            <p className="mt-1.5 text-xs text-white/35">
              {t("linkInBio.profile.slugHint", { slug: slug || slugify(displayName) || "my-handle" })}
            </p>
            {slug.trim() && !SLUG_RE.test(slug.trim()) && (
              <p className="mt-1 inline-flex items-center gap-1 text-xs text-red-300">
                <CircleAlert className="h-3.5 w-3.5" /> {t("linkInBio.profile.slugInvalid")}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* theme */}
      <div className={sectionClass}>
        <h3 className="mb-4 text-base font-bold">{t("linkInBio.theme.title")}</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          {BIO_THEMES.map((th) => (
            <button
              key={th.key}
              onClick={() => setTheme(th.key)}
              className={`rounded-2xl border p-4 text-left transition ${
                theme === th.key
                  ? "border-primary/60 bg-primary/10"
                  : "border-white/10 bg-white/[0.02] hover:border-white/25"
              }`}
            >
              <div className={`mb-3 h-16 overflow-hidden rounded-xl ${th.page} relative`}>
                <div className="absolute inset-0" style={{ background: th.glow }} />
                <div className={`absolute left-1/2 top-1/2 h-8 w-24 -translate-x-1/2 -translate-y-1/2 rounded-lg border ${th.linkButton}`} />
              </div>
              <p className="text-sm font-bold text-white">{t(th.labelKey)}</p>
              <p className="mt-1 text-xs text-white/40">{t(th.blurbKey)}</p>
              {theme === th.key && <Check className="mt-2 h-4 w-4 text-emerald-400" />}
            </button>
          ))}
        </div>
      </div>

      {/* links */}
      <div className={sectionClass}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-bold">{t("linkInBio.links.title")}</h3>
          <button onClick={addLink}
            className="inline-flex items-center gap-1.5 rounded-xl border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary transition hover:bg-primary/20">
            <Plus className="h-3.5 w-3.5" /> {t("linkInBio.links.add")}
          </button>
        </div>
        {links.length === 0 ? (
          <p className="text-sm text-white/35">{t("linkInBio.links.empty")}</p>
        ) : (
          <div className="space-y-3">
            {links.map((link, i) => (
              <div key={i} className="rounded-xl border border-white/10 bg-black/40 p-3">
                <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                  <input value={link.title} maxLength={60}
                    onChange={(e) => setLinks((ls) => ls.map((l, j) => (j === i ? { ...l, title: e.target.value } : l)))}
                    placeholder={t("linkInBio.links.titlePlaceholder")} className={inputClass} />
                  <input value={link.url} maxLength={800}
                    onChange={(e) => setLinks((ls) => ls.map((l, j) => (j === i ? { ...l, url: e.target.value } : l)))}
                    placeholder={t("linkInBio.links.urlPlaceholder")} className={inputClass} />
                  <div className="flex items-center gap-1">
                    <button onClick={() => moveLink(i, -1)} disabled={i === 0} aria-label={t("linkInBio.links.moveUp")}
                      className="rounded-lg border border-white/10 p-2 text-white/50 transition hover:text-white disabled:opacity-30">
                      <ArrowUp className="h-4 w-4" />
                    </button>
                    <button onClick={() => moveLink(i, 1)} disabled={i === links.length - 1} aria-label={t("linkInBio.links.moveDown")}
                      className="rounded-lg border border-white/10 p-2 text-white/50 transition hover:text-white disabled:opacity-30">
                      <ArrowDown className="h-4 w-4" />
                    </button>
                    <button onClick={() => setLinks((ls) => ls.filter((_, j) => j !== i))} aria-label={t("linkInBio.links.remove")}
                      className="rounded-lg border border-white/10 p-2 text-white/50 transition hover:border-red-500/50 hover:text-red-300">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-xs text-white/40">{t("linkInBio.links.icon")}:</span>
                  <div className="flex flex-wrap gap-1">
                    {LINK_ICON_KEYS.map((key) => (
                      <button
                        key={key}
                        onClick={() => setLinks((ls) => ls.map((l, j) => (j === i ? { ...l, icon: key } : l)))}
                        title={key}
                        className={`rounded-lg border p-1.5 transition ${
                          link.icon === key ? "border-primary/60 bg-primary/15 text-primary" : "border-white/10 text-white/40 hover:text-white"
                        }`}
                      >
                        <BioLinkIcon icon={key} className="h-4 w-4" />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* socials */}
      <div className={sectionClass}>
        <h3 className="mb-1 text-base font-bold">{t("linkInBio.socials.title")}</h3>
        <p className="mb-4 text-xs text-white/35">{t("linkInBio.socials.hint")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {SOCIAL_DEFS.map((s) => (
            <div key={s.key} className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] text-amber-300/80">
                <s.Icon className="h-4 w-4" />
              </span>
              <input value={socials[s.key] ?? ""} maxLength={800}
                onChange={(e) => setSocials((ss) => ({ ...ss, [s.key]: e.target.value }))}
                placeholder={`${s.label} URL`} className={inputClass} />
            </div>
          ))}
        </div>
      </div>

      {/* featured from hub */}
      <div className={sectionClass}>
        <h3 className="mb-1 text-base font-bold">{t("linkInBio.featured.title")}</h3>
        <p className="mb-4 text-xs text-white/35">{t("linkInBio.featured.hint")}</p>
        {featured.length > 0 && (
          <div className="mb-4 space-y-2">
            {featured.map((f, i) => (
              <div key={i} className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/40 px-4 py-2.5">
                <span className="flex-1 truncate text-sm text-white/80">{f.label}</span>
                <span className="text-[11px] uppercase tracking-wider text-white/35">{f.kind}</span>
                <button onClick={() => setFeatured((fs) => fs.filter((_, j) => j !== i))} aria-label={t("linkInBio.featured.remove")}
                  className="text-white/40 transition hover:text-red-300">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
        {featured.length === 0 && (
          <p className="mb-4 text-sm text-white/35">{t("linkInBio.featured.empty")}</p>
        )}
        {hubAssets.length === 0 ? (
          <p className="text-xs text-white/35">{t("linkInBio.featured.noAssets")}</p>
        ) : (
          <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
            {hubAssets.filter((a) => !featuredUrls.has(a.url)).slice(0, 30).map((a) => (
              <div key={a.id} className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/40 px-4 py-2.5">
                <span className="flex-1 truncate text-sm text-white/80">{a.label}</span>
                <span className="text-[11px] uppercase tracking-wider text-white/35">{a.kind}</span>
                <button
                  onClick={() => setFeatured((fs) => [...fs, { label: a.label, url: a.url, kind: a.kind }].slice(0, 12))}
                  className="inline-flex items-center gap-1 rounded-lg border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary transition hover:bg-primary/20"
                >
                  <Plus className="h-3 w-3" /> {t("linkInBio.featured.add")}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* tip jar */}
      <div className={sectionClass}>
        <h3 className="mb-1 text-base font-bold">{t("linkInBio.tipJar.title")}</h3>
        <p className="mb-4 text-xs text-white/35">{t("linkInBio.tipJar.hint")}</p>
        <input value={tipJarUrl} onChange={(e) => setTipJarUrl(e.target.value)} maxLength={800}
          placeholder={t("linkInBio.tipJar.placeholder")} className={inputClass} />
      </div>

      {/* preview */}
      <div className={sectionClass}>
        <button onClick={() => setShowPreview((s) => !s)}
          className="flex w-full items-center justify-between text-base font-bold">
          <span className="inline-flex items-center gap-2"><Eye className="h-4 w-4 text-primary" /> {t("linkInBio.preview")}</span>
          <ChevronDown className={`h-4 w-4 text-white/50 transition ${showPreview ? "rotate-180" : ""}`} />
        </button>
        {showPreview && (
          <div className="mx-auto mt-4 max-w-sm overflow-hidden rounded-3xl border border-white/15">
            <div className="pointer-events-none scale-100">
              <BioPageView page={previewData} />
            </div>
          </div>
        )}
      </div>

      {/* analytics */}
      {page && (
        <div className={sectionClass}>
          <h3 className="mb-4 inline-flex items-center gap-2 text-base font-bold">
            <BarChart3 className="h-4 w-4 text-primary" /> {t("linkInBio.analytics.title")}
          </h3>
          {analyticsLoading ? (
            <div className="flex items-center gap-2 text-sm text-white/40">
              <Loader2 className="h-4 w-4 animate-spin" /> …
            </div>
          ) : !analytics || analytics.totalClicks === 0 ? (
            <p className="text-sm text-white/35">{t("linkInBio.analytics.noData")}</p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: t("linkInBio.analytics.views"), value: analytics.views },
                  { label: t("linkInBio.analytics.clicks"), value: analytics.totalClicks },
                  { label: t("linkInBio.analytics.last7d"), value: analytics.clicksLast7d },
                ].map((s) => (
                  <div key={s.label} className="rounded-xl border border-white/10 bg-black/40 p-3 text-center">
                    <p className="text-2xl font-extrabold text-primary">{s.value}</p>
                    <p className="mt-1 text-[11px] uppercase tracking-wider text-white/40">{s.label}</p>
                  </div>
                ))}
              </div>
              <p className="mb-2 mt-5 text-xs font-bold uppercase tracking-widest text-white/45">
                {t("linkInBio.analytics.perLink")}
              </p>
              <div className="space-y-1.5">
                {analytics.perLink.map((row) => (
                  <div key={row.linkTitle} className="flex items-center justify-between rounded-lg bg-black/30 px-3 py-2">
                    <span className="truncate text-sm text-white/75">{row.linkTitle}</span>
                    <span className="ml-3 shrink-0 rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-bold text-primary">
                      {row.clicks}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* actions */}
      {outOfCredits && (
        <div className="rounded-2xl border border-white/10 p-4">
          <OutOfCredits onClose={() => setOutOfCredits(false)} />
          <p className="mt-2 text-center text-xs text-white/50">{t("linkInBio.actions.outOfCredits")}</p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={saveDraft} disabled={saving || publishing}
          className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.05] px-6 py-3 text-sm font-bold text-white transition hover:border-white/30 disabled:opacity-50">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {saving ? t("linkInBio.actions.saving") : t("linkInBio.actions.saveDraft")}
        </button>
        {page?.isPublished ? (
          <>
            <a href={page.url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-6 py-3 text-sm font-bold text-emerald-300 transition hover:bg-emerald-500/20">
              <ExternalLink className="h-4 w-4" /> {t("linkInBio.actions.viewPage")}
            </a>
            <button onClick={unpublish} disabled={unpublishing}
              className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-6 py-3 text-sm font-bold text-white/60 transition hover:text-white disabled:opacity-50">
              {unpublishing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {unpublishing ? t("linkInBio.actions.unpublishing") : t("linkInBio.actions.unpublish")}
            </button>
            <button onClick={share}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 to-yellow-500 px-6 py-3 text-sm font-bold text-black transition hover:brightness-110">
              <Share2 className="h-4 w-4" /> {t("linkInBio.actions.share")}
            </button>
            <button onClick={copyShare}
              className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-4 py-3 text-sm font-semibold text-white/70 transition hover:text-white">
              {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
              {copied ? t("linkInBio.actions.copied") : t("linkInBio.actions.copyLink")}
            </button>
          </>
        ) : (
          <button onClick={publish} disabled={publishing || saving}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 to-yellow-500 px-6 py-3 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-50">
            {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {publishing ? t("linkInBio.actions.publishing") : t("linkInBio.actions.publish", { cost: PUBLISH_COST })}
          </button>
        )}
      </div>
      {page?.isPublished && shareUrl && (
        <p className="break-all text-xs text-white/35">{shareUrl}</p>
      )}
    </div>
  );
}

/* Re-exported for the public page's theme swatch (kept in one module). */
export { bioTheme };
