import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { usePageTitle } from "@/hooks/use-page-title";
import { Link, useParams } from "wouter";
import { Loader2, MapPin, Mail, Globe, ExternalLink, Music2, Quote, Trophy, Camera, Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { resolvePressKitLayout, type PressKitLayoutEntry, type PressKitSectionKey } from "@/lib/press-kit";

/* ─── Public Press Kit ────────────────────────────────────────────────────
   The shareable EPK page at /press/:handle. No auth required — this is what
   bookers, press, and fans see. PDF download via the browser print dialog
   (free, honest — no fake file generation).

   The six content sections below the hero render in the kit's saved
   layout order, hidden ones omitted (lib/press-kit resolvePressKitLayout).
   A kit with no saved layout gets the canonical order — the render this
   page has always produced. */

interface PressKit {
  id: string;
  handle: string;
  artist_name: string;
  tagline?: string | null;
  bio?: string | null;
  genre?: string | null;
  location?: string | null;
  booking_email?: string | null;
  website?: string | null;
  instagram_url?: string | null;
  tiktok_url?: string | null;
  youtube_url?: string | null;
  spotify_url?: string | null;
  achievements: string[];
  press_quotes: Array<{ quote: string; source: string }>;
  photo_urls: string[];
  top_tracks: Array<{ title: string; url: string }>;
  layout?: PressKitLayoutEntry[] | null;
}

export default function PublicPressKit() {
  const isLight = useIsLightTheme();
  usePageTitle("Press Kit", "Official press kit — bio, photos, music, and booking info.");
  const params = useParams<{ handle: string }>();
  const handle = params.handle ?? "";
  const { t } = useTranslation();
  const [kit, setKit] = useState<PressKit | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/press-kit/public/${encodeURIComponent(handle)}`);
        if (res.status === 404) { setNotFound(true); return; }
        if (!res.ok) return;
        const data = await res.json();
        setKit(data.kit);
      } catch { /* show loading state */ }
      finally { setLoading(false); }
    })();
  }, [handle]);

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white">
        <div className="flex items-center justify-center py-32">
          <Loader2 className="h-8 w-8 animate-spin text-[#d4af37]" />
        </div>

      </div>
    );
  }

  if (notFound || !kit) {
    return (
      <div className="min-h-screen bg-black text-white">
        <div className="max-w-xl mx-auto px-5 py-32 text-center">
          <h1 className="text-3xl font-bold mb-3">{t("press-public.notFoundTitle")}</h1>
          <p className="text-white/50 mb-6">{t("press-public.notFoundMessage")}</p>
          <Link href="/" className="text-[#d4af37] hover:underline">{t("press-public.backHome")}</Link>
        </div>

      </div>
    );
  }

  const socials = [
    { label: "Instagram", url: kit.instagram_url },
    { label: "TikTok", url: kit.tiktok_url },
    { label: "YouTube", url: kit.youtube_url },
    { label: "Spotify", url: kit.spotify_url },
  ].filter((s) => s.url);

  /* The six content sections, keyed by their layout key. Each keeps its
     own content condition — a visible section with nothing in it still
     renders nothing, exactly as before layout editing existed. */
  const sectionBlocks: Record<PressKitSectionKey, ReactNode> = {
    bio: kit.bio ? (
      <section className={`mb-10 rounded-2xl border p-6 md:p-8 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[#d4af37] mb-3">{t("press-public.sections.bio")}</h2>
        <p className="text-white/80 leading-relaxed whitespace-pre-line">{kit.bio}</p>
      </section>
    ) : null,

    achievements: kit.achievements.length > 0 ? (
      <section className="mb-10">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[#d4af37] mb-3 flex items-center gap-2">
          <Trophy className="h-4 w-4" /> {t("press-public.sections.achievements")}
        </h2>
        <ul className="grid md:grid-cols-2 gap-2">
          {kit.achievements.map((a, i) => (
            <li key={i} className={`rounded-xl border px-4 py-3 text-sm ${isLight ? "border-[#C9A84C]/35 bg-[#F7ECD2]/80 text-[#6B5B36]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04] text-white/75"}`}>{a}</li>
          ))}
        </ul>
      </section>
    ) : null,

    press_quotes: kit.press_quotes.length > 0 ? (
      <section className="mb-10">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[#d4af37] mb-3 flex items-center gap-2">
          <Quote className="h-4 w-4" /> {t("press-public.sections.press")}
        </h2>
        <div className="grid md:grid-cols-2 gap-4">
          {kit.press_quotes.map((q, i) => (
            <blockquote key={i} className="rounded-xl border border-[#d4af37]/25 bg-[#d4af37]/[0.04] p-5">
              <p className="text-white/85 italic mb-2">“{q.quote}”</p>
              <cite className="text-white/45 text-sm not-italic">— {q.source}</cite>
            </blockquote>
          ))}
        </div>
      </section>
    ) : null,

    top_tracks: kit.top_tracks.length > 0 ? (
      <section className="mb-10">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[#d4af37] mb-3 flex items-center gap-2">
          <Music2 className="h-4 w-4" /> {t("press-public.sections.topTracks")}
        </h2>
        <div className={`rounded-2xl border overflow-hidden ${isLight ? "border-[#C9A84C]/40 bg-[#FCF7EA]" : "border-primary/25 bg-[#0d0a04]"}`}>
          {kit.top_tracks.map((t, i) => (
            <a key={i} href={t.url} target="_blank" rel="noreferrer"
               className="flex items-center justify-between px-5 py-3.5 hover:bg-white/[0.04] transition-colors border-b border-white/5 last:border-0">
              <span className="text-sm"><span className="text-white/30 mr-3">{i + 1}</span>{t.title}</span>
              <ExternalLink className="h-4 w-4 text-white/30" />
            </a>
          ))}
        </div>
      </section>
    ) : null,

    photos: kit.photo_urls.length > 1 ? (
      <section className="mb-10">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[#d4af37] mb-3 flex items-center gap-2">
          <Camera className="h-4 w-4" /> {t("press-public.sections.photos")}
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {kit.photo_urls.slice(1).map((u, i) => (
            <img key={i} src={u} onError={(e) => { e.currentTarget.style.display = "none"; }} alt={t("press-public.photoAlt", { name: kit.artist_name, index: i + 1 })}
                 className="aspect-square object-cover rounded-xl border border-white/10" />
          ))}
        </div>
      </section>
    ) : null,

    contact: (
      <section className="mb-10 rounded-2xl border border-[#d4af37]/30 bg-[#d4af37]/[0.05] p-6 md:p-8 text-center">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[#d4af37] mb-4">{t("press-public.sections.bookingContact")}</h2>
        <div className="flex flex-wrap items-center justify-center gap-3">
          {kit.booking_email && (
            <a href={`mailto:${kit.booking_email}`}
               className="inline-flex items-center gap-2 rounded-xl bg-[#d4af37] text-black font-semibold px-5 py-2.5 text-sm hover:bg-[#e5c158]">
              <Mail className="h-4 w-4" /> {kit.booking_email}
            </a>
          )}
          {kit.website && (
            <a href={kit.website} target="_blank" rel="noreferrer"
               className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-5 py-2.5 text-sm hover:border-[#d4af37]/50">
              <Globe className="h-4 w-4" /> {t("press-public.website")}
            </a>
          )}
          {socials.map((s) => (
            <a key={s.label} href={s.url!} target="_blank" rel="noreferrer"
               className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-5 py-2.5 text-sm hover:border-[#d4af37]/50">
              {s.label} <ExternalLink className="h-3 w-3" />
            </a>
          ))}
        </div>
      </section>
    ),
  };

  const orderedSections = resolvePressKitLayout(kit.layout).filter((entry) => entry.visible);

  return (
    <div className="min-h-screen bg-black text-white">

      <main className="max-w-4xl mx-auto px-5 md:px-8 py-10">
        {/* hero */}
        <div className="text-center mb-10">
          {kit.photo_urls[0] && (
            <img src={kit.photo_urls[0]} onError={(e) => { e.currentTarget.style.display = "none"; }} alt={kit.artist_name}
                 className="w-40 h-40 rounded-full object-cover mx-auto mb-6 border-2 border-[#d4af37]/60 shadow-[0_0_40px_rgba(212,175,55,0.25)]" />
          )}
          <p className="text-xs uppercase tracking-[0.3em] text-[#d4af37] mb-2">{t("press-public.epkLabel")}</p>
          <h1 className="text-4xl md:text-5xl font-bold mb-2">{kit.artist_name}</h1>
          {kit.tagline && <p className="text-lg text-white/60 italic mb-3">{kit.tagline}</p>}
          <div className="flex items-center justify-center gap-4 text-sm text-white/50">
            {kit.genre && <span className="rounded-full border border-white/15 px-3 py-1">{kit.genre}</span>}
            {kit.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{kit.location}</span>}
          </div>
        </div>

        {/* content sections — saved layout order, hidden ones omitted */}
        {orderedSections.map((entry) => (
          <Fragment key={entry.key}>{sectionBlocks[entry.key]}</Fragment>
        ))}

        <div className="text-center text-xs text-white/50 print:hidden">
          <button onClick={() => window.print()}
                  className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-4 py-2 hover:border-[#d4af37]/50 mb-3">
            <Download className="h-3 w-3" /> {t("press-public.downloadPdf")}
          </button>
          <p>{t("press-public.madeWith")} <Link href="/" className="text-[#d4af37] hover:underline">Bow Down Visuals</Link> {t("press-public.cheatCodeTagline")}</p>
        </div>
      </main>

    </div>
  );
}
