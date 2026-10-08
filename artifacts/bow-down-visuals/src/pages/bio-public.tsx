import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { useTranslation } from "react-i18next";
import { Loader2, Link2Off, Share2, Check } from "lucide-react";
import { JsonLd } from "@/components/seo/json-ld";
import { usePageTitle } from "@/hooks/use-page-title";
import { BioPageView, type BioPageData } from "@/components/promote/bio-themes";

/* ─── Public link-in-bio page ───────────────────────────────────────────────
   /bio/:slug — no login required. Gold/black luxury creator page: profile
   header, social icons, link rows, featured content, tip jar, and the
   "Made with Bow Down Visuals" badge (viral surface). Clicks are tracked
   per link for the builder's analytics dashboard. Shared URLs carry
   ?ref=CODE (AppShell captures it for the referral loop). */

interface PublicBioPage extends BioPageData {
  viewCount: number;
  url: string;
}

export default function BioPublic() {
  const { t } = useTranslation();
  const [, params] = useRoute("/bio/:slug");
  const slug = params?.slug ?? "";
  const [page, setPage] = useState<PublicBioPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [shared, setShared] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/bio-pages/public/${encodeURIComponent(slug)}`);
        const json = await res.json();
        if (cancelled) return;
        if (json.ok && json.page) setPage(json.page);
        else setNotFound(true);
      } catch {
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [slug]);

  usePageTitle(
    page ? `${page.displayName} — Links | Bow Down Visuals` : t("linkInBio.public.title"),
    page ? `${page.displayName}${page.headline ? ` — ${page.headline}` : ""}. ${page.bio || "Links, music, and more."}` : t("linkInBio.public.description")
  );

  function trackTap(kind: "link" | "social" | "featured" | "tip", index: number, title: string) {
    /* Fire-and-forget: analytics must never block the fan's tap. */
    try {
      fetch(`/api/bio-pages/public/${encodeURIComponent(slug)}/click`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkIndex: index, linkTitle: title, kind }),
        keepalive: true,
      }).catch(() => undefined);
    } catch { /* noop */ }
  }

  async function handleShare() {
    if (!page) return;
    const url = page.referralCode
      ? `${page.url}?ref=${encodeURIComponent(page.referralCode)}`
      : page.url;
    try {
      if (navigator.share) {
        await navigator.share({ title: `${page.displayName} — Links`, url });
      } else {
        await navigator.clipboard.writeText(url);
      }
      setShared(true);
      setTimeout(() => setShared(false), 2000);
    } catch { /* user cancelled */ }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
      </div>
    );
  }

  if (notFound || !page) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center gap-4 px-6 text-center text-white">
        <Link2Off className="w-10 h-10 text-zinc-600" />
        <h1 className="text-2xl font-bold">{t("linkInBio.public.notFound")}</h1>
        <p className="text-zinc-400 max-w-sm text-sm">{t("linkInBio.public.notFoundDetail")}</p>
        <a href="/" className="text-amber-400 hover:text-amber-300 font-medium">
          Bow Down Visuals
        </a>
      </div>
    );
  }

  const shareUrl = page.referralCode ? `${page.url}?ref=${encodeURIComponent(page.referralCode)}` : page.url;
  /* "Made with Bow Down Visuals" badge: site home + the creator's referral
     code — the viral attribution loop. */
  const badgeUrl = page.referralCode ? `/?ref=${encodeURIComponent(page.referralCode)}` : "/";
  const profileJsonLd = {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    name: `${page.displayName} — Links`,
    description: page.bio || page.headline || `${page.displayName}'s links`,
    url: page.url,
    mainEntity: {
      "@type": "Person",
      name: page.displayName,
      description: page.bio || undefined,
      image: page.avatarUrl || undefined,
    },
  };

  return (
    <>
      <JsonLd data={profileJsonLd} />
      <div className="relative">
        <button
          onClick={handleShare}
          aria-label={t("linkInBio.public.share")}
          className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/50 text-white/70 backdrop-blur transition hover:border-amber-500/50 hover:text-amber-300"
        >
          {shared ? <Check className="h-4 w-4 text-emerald-400" /> : <Share2 className="h-4 w-4" />}
        </button>
        <BioPageView page={page} onLinkTap={trackTap} shareUrl={badgeUrl} />
      </div>
    </>
  );
}
