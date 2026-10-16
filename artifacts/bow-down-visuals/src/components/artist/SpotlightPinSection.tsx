import { useEffect, useRef, useState } from "react";
import { Pin, Play, Pause, AlertTriangle, RotateCcw, X, Music2, Clapperboard } from "lucide-react";
import {
  fetchPublicSpotlight,
  saveMySpotlight,
  fetchMyPinnableItems,
  spotlightViewState,
  type SpotlightPin,
  type PinnableItem,
  type SpotlightLoadStatus,
} from "@/lib/profile-website";
import { fetchMyProfile } from "@/lib/artist-profiles";

/* ─── Spotlight Pin — public profile section (Stack 3, item 5) ──────────
   The creator's ONE featured track or video, pinned to the top of their
   profile. Click-to-play with the house media pattern (never autoplay).
   The section hides entirely when there's no pin; the OWNER viewing
   their own unpinned page gets the "Pin a track or video" invitation
   with an inline picker over their own published catalog, and can
   change or clear the pin in place. A failed load is an honest error +
   retry — never a fake-empty. */

export default function SpotlightPinSection({ slug }: { slug: string }) {
  const [pin, setPin] = useState<SpotlightPin | null>(null);
  const [status, setStatus] = useState<SpotlightLoadStatus>("loading");
  const [isOwner, setIsOwner] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [playing, setPlaying] = useState(false);
  const mediaRef = useRef<HTMLAudioElement | HTMLVideoElement | null>(null);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerItems, setPickerItems] = useState<PinnableItem[] | null>(null);
  const [pickerError, setPickerError] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    (async () => {
      try {
        const p = await fetchPublicSpotlight(slug);
        if (!cancelled) {
          setPin(p);
          setStatus("ready");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, retryNonce]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mine = await fetchMyProfile();
        if (!cancelled) setIsOwner(!!mine && mine.slug === slug);
      } catch {
        if (!cancelled) setIsOwner(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  useEffect(() => () => {
    mediaRef.current?.pause();
  }, []);

  const view = spotlightViewState({ status, pin, isOwner });
  if (view === "loading" || view === "hidden") return null;

  const toggle = () => {
    const el = mediaRef.current;
    if (!el || !pin) return;
    if (playing) {
      el.pause();
      setPlaying(false);
    } else {
      void el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    }
  };

  const openPicker = async () => {
    setPickerOpen(true);
    setPickerError(false);
    if (pickerItems !== null) return;
    try {
      setPickerItems(await fetchMyPinnableItems(slug));
    } catch {
      setPickerError(true);
    }
  };

  const choosePin = async (item: PinnableItem) => {
    setSaving(true);
    try {
      const saved = await saveMySpotlight({ kind: item.kind, itemId: item.id });
      setPin(saved);
      setPickerOpen(false);
      setPlaying(false);
    } catch {
      setPickerError(true);
    } finally {
      setSaving(false);
    }
  };

  const clearPin = async () => {
    setSaving(true);
    try {
      await saveMySpotlight({ kind: null });
      setPin(null);
      setPickerOpen(false);
      setPlaying(false);
    } catch {
      setPickerError(true);
    } finally {
      setSaving(false);
    }
  };

  const picker = pickerOpen && (
    <div className="mt-3 w-full rounded-xl border border-[#d4af37]/40 bg-black/30 p-3 text-left">
      {pickerError && (
        <p className="px-1 py-2 text-xs text-red-300">That didn't save — try again.</p>
      )}
      {pickerItems === null && !pickerError && (
        <p className="px-1 py-2 text-xs" style={{ color: "var(--ap-muted)" }}>Loading your catalog…</p>
      )}
      {pickerItems !== null && pickerItems.length === 0 && (
        <p className="px-1 py-2 text-xs" style={{ color: "var(--ap-muted)" }}>
          Nothing published yet — publish a track or video first, then pin it here.
        </p>
      )}
      {pickerItems !== null && pickerItems.length > 0 && (
        <ul className="max-h-56 space-y-1 overflow-y-auto">
          {pickerItems.map((item) => (
            <li key={`${item.kind}-${item.id}`}>
              <button
                type="button"
                disabled={saving}
                onClick={() => void choosePin(item)}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-[#d4af37]/10 disabled:opacity-50"
              >
                {item.artworkUrl ? (
                  <img src={item.artworkUrl} alt="" className="h-9 w-9 shrink-0 rounded object-cover" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                ) : (
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-[#d4af37]/15 text-[#d4af37]">
                    {item.kind === "track" ? <Music2 className="h-4 w-4" /> : <Clapperboard className="h-4 w-4" />}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate text-sm font-semibold" style={{ color: "var(--ap-text)" }}>
                  {item.title}
                </span>
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#d4af37]">
                  {item.kind}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <section className="ap-section" style={{ padding: "var(--ap-pad)" }} data-testid="spotlight-pin">
      <div className="mb-3 flex items-center gap-2">
        <Pin className="h-5 w-5 text-[#d4af37]" />
        <h2
          className="text-xl font-bold tracking-wide sm:text-2xl"
          style={{ fontFamily: "var(--ap-heading-font)", color: "var(--ap-text)" }}
        >
          Spotlight
        </h2>
      </div>

      {view === "error" && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-[#d4af37]/40 bg-black/30 px-4 py-6 text-center">
          <AlertTriangle className="h-6 w-6 text-[#d4af37]" />
          <p className="text-sm" style={{ color: "var(--ap-text)" }}>
            The spotlight couldn't load right now.
          </p>
          <button
            type="button"
            onClick={() => setRetryNonce((n) => n + 1)}
            className="mt-1 inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-5 py-2 text-xs font-bold text-black transition hover:scale-105"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Try again
          </button>
        </div>
      )}

      {view === "owner-empty" && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-[#d4af37]/50 bg-black/20 px-4 py-6 text-center">
          <Pin className="h-6 w-6 text-[#d4af37]" />
          <p className="text-sm font-semibold" style={{ color: "var(--ap-text)" }}>
            Pin a track or video
          </p>
          <p className="max-w-sm text-xs" style={{ color: "var(--ap-muted)" }}>
            One featured drop at the top of your page — the first thing every visitor hears.
          </p>
          {!pickerOpen && (
            <button
              type="button"
              onClick={() => void openPicker()}
              className="mt-1 inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-5 py-2 text-xs font-bold text-black transition hover:scale-105"
            >
              <Pin className="h-3.5 w-3.5" /> Pin a track or video
            </button>
          )}
          {picker}
        </div>
      )}

      {view === "pin" && pin && (
        <div className="rounded-xl border border-[#d4af37]/60 bg-gradient-to-b from-[#d4af37]/15 to-transparent p-[1px] shadow-[0_0_18px_rgba(212,175,55,0.15)]">
          <div className="flex items-center gap-4 rounded-[11px] px-4 py-4" style={{ backgroundColor: "var(--ap-card)" }}>
            {pin.kind === "video" ? (
              <video
                ref={mediaRef as React.RefObject<HTMLVideoElement>}
                src={pin.mediaUrl}
                poster={pin.artworkUrl ?? undefined}
                className="h-20 w-32 shrink-0 rounded object-cover"
                playsInline
                preload="metadata"
                onEnded={() => setPlaying(false)}
              />
            ) : (
              <>
                {pin.artworkUrl && (
                  <img
                    src={pin.artworkUrl}
                    alt=""
                    className="h-20 w-20 shrink-0 rounded object-cover"
                    onError={(e) => { e.currentTarget.style.display = "none"; }}
                  />
                )}
                <audio
                  ref={mediaRef as React.RefObject<HTMLAudioElement>}
                  src={pin.mediaUrl}
                  preload="metadata"
                  onEnded={() => setPlaying(false)}
                  className="hidden"
                />
              </>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#d4af37]">
                Pinned {pin.kind}
              </div>
              <div className="truncate font-semibold" style={{ color: "var(--ap-text)" }}>
                {pin.title}
              </div>
              <div className="text-xs" style={{ color: "var(--ap-muted)" }}>
                {playing ? "Now playing" : `Tap to play the pinned ${pin.kind}`}
              </div>
              {isOwner && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void openPicker()}
                    className="inline-flex items-center gap-1 rounded-full border border-[#d4af37]/50 px-3 py-1 text-[11px] font-bold text-[#d4af37] transition hover:bg-[#d4af37]/10"
                  >
                    <Pin className="h-3 w-3" /> Change pin
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void clearPin()}
                    className="inline-flex items-center gap-1 rounded-full border border-white/20 px-3 py-1 text-[11px] font-bold text-white/70 transition hover:bg-white/10 disabled:opacity-50"
                  >
                    <X className="h-3 w-3" /> Unpin
                  </button>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={toggle}
              aria-label={playing ? "Pause" : "Play pinned media"}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#d4af37] font-bold text-black transition hover:scale-105"
            >
              {playing ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}
            </button>
          </div>
          {isOwner && picker}
        </div>
      )}
    </section>
  );
}
