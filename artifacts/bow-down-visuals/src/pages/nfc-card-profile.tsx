import { useEffect, useState } from "react";
import { useParams } from "wouter";
import {
  Loader2, ExternalLink, UserPlus, Share2, Nfc, QrCode,
  BadgeCheck, Link2Off,
} from "lucide-react";
import { downloadVCard, type NfcProfile } from "@/lib/nfc-cards";

/* ─── Public digital business card ──────────────────────────────────────
   The tap/QR destination: bowdownvisuals.com/c/:slug
   Gold-black luxury theme. No login required — this is what a prospect
   sees when they tap the physical card or scan the QR. */

export default function NfcCardProfile() {
  const params = useParams<{ slug: string }>();
  const [profile, setProfile] = useState<NfcProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [shared, setShared] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/nfc-cards/profile/${encodeURIComponent(params.slug ?? "")}`);
        const json = await res.json();
        if (cancelled) return;
        if (json.ok) setProfile({ ...json.profile, url: window.location.href });
        else setNotFound(true);
      } catch {
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [params.slug]);

  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: profile?.display_name ?? "Digital business card", url });
      } else {
        await navigator.clipboard.writeText(url);
      }
      setShared(true);
      setTimeout(() => setShared(false), 2000);
    } catch { /* user cancelled */ }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
      </div>
    );
  }

  if (notFound || !profile) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center gap-4 px-6 text-center">
        <Link2Off className="w-10 h-10 text-zinc-600" />
        <h1 className="text-2xl font-bold text-white">This card isn't active</h1>
        <p className="text-zinc-400 max-w-sm">
          The link may be mistyped, or the owner deactivated this digital card.
        </p>
        <a href="/" className="text-amber-400 hover:text-amber-300 font-medium">
          ← Back to Bow Down Visuals
        </a>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center px-5 py-10 relative overflow-hidden">
      {/* ambient gold glow */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(600px 300px at 50% -50px, rgba(212,175,55,0.18), transparent 70%)",
        }}
      />

      <div className="w-full max-w-md relative">
        {/* tap badge */}
        <div className="flex items-center justify-center gap-2 mb-6 text-amber-400/90">
          <Nfc className="w-4 h-4" />
          <span className="text-xs tracking-[0.25em] uppercase">Tap to connect</span>
          <QrCode className="w-4 h-4" />
        </div>

        {/* card */}
        <div className="rounded-3xl border border-amber-500/30 bg-gradient-to-b from-zinc-900 to-black p-8 text-center shadow-[0_0_60px_rgba(212,175,55,0.12)]">
          {profile.avatar_url ? (
            <img
              src={profile.avatar_url}
              alt={profile.display_name}
              className="w-24 h-24 rounded-full mx-auto object-cover border-2 border-amber-400/60"
            />
          ) : (
            <div className="w-24 h-24 rounded-full mx-auto flex items-center justify-center bg-gradient-to-br from-amber-400 to-amber-700 text-black text-3xl font-bold">
              {profile.display_name.charAt(0).toUpperCase()}
            </div>
          )}

          <h1 className="mt-4 text-3xl font-bold flex items-center justify-center gap-2">
            {profile.display_name}
            <BadgeCheck className="w-5 h-5 text-amber-400" />
          </h1>
          {profile.title && (
            <p className="mt-1 text-amber-200/90 font-medium">{profile.title}</p>
          )}
          {profile.bio && (
            <p className="mt-3 text-zinc-400 text-sm leading-relaxed">{profile.bio}</p>
          )}

          {/* actions */}
          <div className="mt-6 grid grid-cols-2 gap-3">
            <button
              onClick={() => downloadVCard(profile)}
              className="flex items-center justify-center gap-2 rounded-xl bg-amber-400 text-black font-semibold py-3 hover:bg-amber-300 transition"
            >
              <UserPlus className="w-4 h-4" /> Save Contact
            </button>
            <button
              onClick={share}
              className="flex items-center justify-center gap-2 rounded-xl border border-amber-500/40 text-amber-300 font-semibold py-3 hover:bg-amber-400/10 transition"
            >
              <Share2 className="w-4 h-4" /> {shared ? "Copied!" : "Share"}
            </button>
          </div>
        </div>

        {/* links */}
        {profile.links.length > 0 && (
          <div className="mt-6 space-y-3">
            {profile.links.map((link, i) => (
              <a
                key={i}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between rounded-2xl border border-zinc-800 bg-zinc-900/80 px-5 py-4 hover:border-amber-500/50 hover:bg-zinc-900 transition group"
              >
                <span className="font-medium">{link.label}</span>
                <ExternalLink className="w-4 h-4 text-zinc-500 group-hover:text-amber-400 transition" />
              </a>
            ))}
          </div>
        )}

        {/* footer */}
        <p className="mt-10 text-center text-xs text-zinc-600">
          Powered by{" "}
          <a href="/" className="text-amber-500/80 hover:text-amber-400">
            Bow Down Visuals
          </a>{" "}
          · NFC Smart Cards
        </p>
      </div>
    </div>
  );
}
