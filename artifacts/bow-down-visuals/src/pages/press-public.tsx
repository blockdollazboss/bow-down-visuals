import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { Loader2, MapPin, Mail, Globe, ExternalLink, Music2, Quote, Trophy, Camera, Download } from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";

/* ─── Public Press Kit ────────────────────────────────────────────────────
   The shareable EPK page at /press/:handle. No auth required — this is what
   bookers, press, and fans see. PDF download via the browser print dialog
   (free, honest — no fake file generation). */

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
}

export default function PublicPressKit() {
  const params = useParams<{ handle: string }>();
  const handle = params.handle ?? "";
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
        <MarketingNav />
        <div className="flex items-center justify-center py-32">
          <Loader2 className="h-8 w-8 animate-spin text-[#d4af37]" />
        </div>
        <SiteFooter />
      </div>
    );
  }

  if (notFound || !kit) {
    return (
      <div className="min-h-screen bg-black text-white">
        <MarketingNav />
        <div className="max-w-xl mx-auto px-5 py-32 text-center">
          <h1 className="text-3xl font-bold mb-3">Press kit not found</h1>
          <p className="text-white/50 mb-6">This press kit doesn't exist or isn't public.</p>
          <Link href="/" className="text-[#d4af37] hover:underline">Back to home</Link>
        </div>
        <SiteFooter />
      </div>
    );
  }

  const socials = [
    { label: "Instagram", url: kit.instagram_url },
    { label: "TikTok", url: kit.tiktok_url },
    { label: "YouTube", url: kit.youtube_url },
    { label: "Spotify", url: kit.spotify_url },
  ].filter((s) => s.url);

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="print:hidden"><MarketingNav /></div>

      <main className="max-w-4xl mx-auto px-5 md:px-8 py-10">
        {/* hero */}
        <div className="text-center mb-10">
          {kit.photo_urls[0] && (
            <img src={kit.photo_urls[0]} alt={kit.artist_name}
                 className="w-40 h-40 rounded-full object-cover mx-auto mb-6 border-2 border-[#d4af37]/60 shadow-[0_0_40px_rgba(212,175,55,0.25)]" />
          )}
          <p className="text-xs uppercase tracking-[0.3em] text-[#d4af37] mb-2">Electronic Press Kit</p>
          <h1 className="text-4xl md:text-5xl font-bold mb-2">{kit.artist_name}</h1>
          {kit.tagline && <p className="text-lg text-white/60 italic mb-3">{kit.tagline}</p>}
          <div className="flex items-center justify-center gap-4 text-sm text-white/50">
            {kit.genre && <span className="rounded-full border border-white/15 px-3 py-1">{kit.genre}</span>}
            {kit.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{kit.location}</span>}
          </div>
        </div>

        {/* bio */}
        {kit.bio && (
          <section className="mb-10 rounded-2xl border border-white/10 bg-white/[0.02] p-6 md:p-8">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[#d4af37] mb-3">Bio</h2>
            <p className="text-white/80 leading-relaxed whitespace-pre-line">{kit.bio}</p>
          </section>
        )}

        {/* achievements */}
        {kit.achievements.length > 0 && (
          <section className="mb-10">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[#d4af37] mb-3 flex items-center gap-2">
              <Trophy className="h-4 w-4" /> Achievements
            </h2>
            <ul className="grid md:grid-cols-2 gap-2">
              {kit.achievements.map((a, i) => (
                <li key={i} className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-sm text-white/75">{a}</li>
              ))}
            </ul>
          </section>
        )}

        {/* press quotes */}
        {kit.press_quotes.length > 0 && (
          <section className="mb-10">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[#d4af37] mb-3 flex items-center gap-2">
              <Quote className="h-4 w-4" /> Press
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
        )}

        {/* top tracks */}
        {kit.top_tracks.length > 0 && (
          <section className="mb-10">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[#d4af37] mb-3 flex items-center gap-2">
              <Music2 className="h-4 w-4" /> Top tracks
            </h2>
            <div className="rounded-2xl border border-white/10 overflow-hidden">
              {kit.top_tracks.map((t, i) => (
                <a key={i} href={t.url} target="_blank" rel="noreferrer"
                   className="flex items-center justify-between px-5 py-3.5 hover:bg-white/[0.04] transition-colors border-b border-white/5 last:border-0">
                  <span className="text-sm"><span className="text-white/30 mr-3">{i + 1}</span>{t.title}</span>
                  <ExternalLink className="h-4 w-4 text-white/30" />
                </a>
              ))}
            </div>
          </section>
        )}

        {/* photos */}
        {kit.photo_urls.length > 1 && (
          <section className="mb-10">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[#d4af37] mb-3 flex items-center gap-2">
              <Camera className="h-4 w-4" /> Photos
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {kit.photo_urls.slice(1).map((u, i) => (
                <img key={i} src={u} alt={`${kit.artist_name} photo ${i + 1}`}
                     className="aspect-square object-cover rounded-xl border border-white/10" />
              ))}
            </div>
          </section>
        )}

        {/* contact */}
        <section className="mb-10 rounded-2xl border border-[#d4af37]/30 bg-[#d4af37]/[0.05] p-6 md:p-8 text-center">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[#d4af37] mb-4">Booking & Contact</h2>
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
                <Globe className="h-4 w-4" /> Website
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

        <div className="text-center text-xs text-white/30 print:hidden">
          <button onClick={() => window.print()}
                  className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-4 py-2 hover:border-[#d4af37]/50 mb-3">
            <Download className="h-3 w-3" /> Download as PDF
          </button>
          <p>Made with <Link href="/" className="text-[#d4af37] hover:underline">Bow Down Visuals</Link> — the content creator cheat code.</p>
        </div>
      </main>

      <div className="print:hidden"><SiteFooter /></div>
    </div>
  );
}
