import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Sparkles, AlertTriangle, RotateCcw } from "lucide-react";
import { TrackRow, FeedEmpty, RowSkeleton } from "@/components/discovery/cards";
import { CreateCta } from "@/components/discovery/FollowButton";
import ShareMenu from "@/components/ShareMenu";
import { useAuth } from "@/contexts/AuthContext";
import type { TrackLite } from "@/components/discovery/cards";

/* ─── DropsWire — the releases wire, now a view inside /home ──────────────
   Extracted from the old standalone /feed page in Phase 3 (the two "feed"
   pages merged into one Feed at /home). New releases from creators you
   follow (last 30 days), newest first. "New since your last visit" is
   badged from localStorage. Data source unchanged: /api/discovery/feed.
   For-You v1 (Wave 3 #19): the same endpoint personalizes the order
   when the member's For-You switch is on and they have engagement to
   rank with — the switch above the wire is that control, discovery
   picks are chipped, and ranked items carry their "why" in the meta
   line. Off (or cold start) renders the plain wire exactly as before. */

const LAST_VISIT_KEY = "bdv_feed_last_visit";

interface FeedItem extends TrackLite {
  kind: "track" | "video";
  thumb: string | null;
  created_at: string;
  /* For-You v1 (Wave 3 #19): present only when personalization is on
     and ranked this wire. `source` says how the drop got here; `why`
     is the honest reason, present only when a signal earned it. */
  source?: "following" | "discovery";
  why?: { kind: string; label: string } | null;
}

export function DropsWire() {
  const { user, getAccessToken } = useAuth();
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [lastVisit, setLastVisit] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [forYou, setForYou] = useState<boolean | null>(null);

  /* The explicit For-You on/off (owner law: every automated behavior
     ships with one). Stored server-side per member; the feed read
     honors it, so flipping the switch just re-reads the wire. */
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken().catch(() => null);
        if (!token || cancelled) return;
        const r = await fetch("/api/discovery/feed/prefs", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok || cancelled) return;
        const d = await r.json();
        if (!cancelled && typeof d.forYouEnabled === "boolean") setForYou(d.forYouEnabled);
      } catch {
        /* The toggle just stays hidden; the wire itself still loads. */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, getAccessToken]);

  const toggleForYou = async () => {
    if (forYou === null) return;
    const next = !forYou;
    setForYou(next);
    try {
      const token = await getAccessToken().catch(() => null);
      if (!token) return;
      await fetch("/api/discovery/feed/prefs", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ forYouEnabled: next }),
      });
    } catch {
      /* Best effort — the next prefs read re-syncs the switch. */
    }
    setRetryNonce((n) => n + 1);
  };

  useEffect(() => {
    setLastVisit(localStorage.getItem(LAST_VISIT_KEY));
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken().catch(() => null);
        if (!token || cancelled) return;
        const r = await fetch("/api/discovery/feed?limit=40", {
          headers: { Authorization: `Bearer ${token}` },
        });
        // A failed load is neither an endless skeleton (old !ok path)
        // nor an empty feed (old catch path) — it's a load error.
        if (!r.ok) { if (!cancelled) setLoadError(true); return; }
        const d = await r.json();
        if (!cancelled) { setLoadError(false); setItems(Array.isArray(d.items) ? d.items : []); }
      } catch {
        if (!cancelled) setLoadError(true);
      }
    })();
    // Mark the visit AFTER the load kicks off so this batch counts as "seen" next time.
    localStorage.setItem(LAST_VISIT_KEY, new Date().toISOString());
    return () => {
      cancelled = true;
    };
  }, [user, getAccessToken, retryNonce]);

  const freshCount = lastVisit
    ? (items ?? []).filter((i) => new Date(i.created_at) > new Date(lastVisit)).length
    : (items ?? []).length;

  return (
    <div>
      {user && forYou !== null && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-primary/25 bg-zinc-950 px-4 py-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-bold text-white">
              <Sparkles className="h-4 w-4 shrink-0 text-[#e8c86a]" />
              For You
              <span
                className={
                  forYou
                    ? "rounded-full bg-[#e8c86a] px-2 py-0.5 text-[10px] font-black uppercase text-black"
                    : "rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-black uppercase text-white/50"
                }
              >
                {forYou ? "On" : "Off"}
              </span>
            </p>
            <p className="mt-0.5 text-[11px] text-white/40">
              {forYou
                ? "Ordered by the creators you play, like and save — every pick says why. Nothing leaves the platform."
                : "Off — newest drops from the creators you follow, in order, nothing ranked."}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={forYou}
            aria-label="Toggle For You personalization"
            onClick={toggleForYou}
            className={
              forYou
                ? "relative h-6 w-11 shrink-0 rounded-full bg-[#e8c86a] transition-colors"
                : "relative h-6 w-11 shrink-0 rounded-full bg-white/15 transition-colors"
            }
          >
            <span
              className={
                forYou
                  ? "absolute left-0 top-0.5 h-5 w-5 translate-x-[22px] rounded-full bg-black transition-transform"
                  : "absolute left-0 top-0.5 h-5 w-5 translate-x-0.5 rounded-full bg-white transition-transform"
              }
            />
          </button>
        </div>
      )}
      {loadError ? (
        <div className="rounded-2xl border border-primary/25 bg-zinc-950 p-10 text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-primary" />
          <p className="mt-3 font-bold text-white">Couldn't load the drops wire.</p>
          <p className="mt-1 text-sm text-white/50">Something went wrong on our end — that's not the same as a quiet feed.</p>
          <button type="button" onClick={() => setRetryNonce((n) => n + 1)} className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 font-bold text-black hover:brightness-110">
            <RotateCcw className="h-4 w-4" /> Try again
          </button>
        </div>
      ) : items === null ? (
        <div className="grid gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <RowSkeleton key={i} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <FeedEmpty />
      ) : (
        <>
          {freshCount > 0 && (
            <p className="mb-4 flex items-center justify-center gap-2 text-sm font-bold text-[#e8c86a]">
              <Sparkles className="h-4 w-4" />
              {freshCount} new since your last visit
            </p>
          )}
          <div className="grid gap-3">
            {items.map((item) => (
              <div key={`${item.kind}-${item.id}`} className="relative">
                {lastVisit && new Date(item.created_at) > new Date(lastVisit) && (
                  <span className="absolute -left-1 top-3 z-10 rounded-full bg-[#e8c86a] px-2 py-0.5 text-[10px] font-black uppercase text-black">
                    New
                  </span>
                )}
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <TrackRow
                      track={{ ...item, artwork_url: item.thumb }}
                      linkPath={item.kind === "video" ? `/watch/${item.id}` : `/track/${item.id}`}
                    />
                  </div>
                </div>
                <p className="mt-1 pl-1 text-[11px] text-white/30">
                  {item.source === "discovery" && (
                    <span className="mr-1.5 rounded-full border border-[#e8c86a]/60 px-1.5 py-px text-[9px] font-black uppercase text-[#e8c86a]">
                      Discovery
                    </span>
                  )}
                  {new Date(item.created_at).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                  {" · "}
                  <Link href={`/artist/${item.slug}`} className="hover:text-[#e8c86a]">
                    {item.display_name}
                  </Link>
                  {item.why ? (
                    <>
                      {" · "}
                      <span className="text-[#e8c86a]/80">{item.why.label}</span>
                    </>
                  ) : null}
                  {" · "}
                  <ShareMenu
                    getToken={getAccessToken}
                    shareUrl={`${window.location.origin}${item.kind === "video" ? `/watch/${item.id}` : `/track/${item.id}`}`}
                    title={item.title}
                    text={`${item.title} — Made with Bow Down Visuals`}
                    contentType={item.kind === "video" ? "video" : "song"}
                    contentId={item.id}
                    compact
                  />
                </p>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="mt-8 text-center text-sm">
        <Link href="/charts" className="font-bold text-[#e8c86a] hover:underline">
          Find more creators to follow →
        </Link>
      </div>

      <CreateCta headline="Your fans could see YOU here." />
    </div>
  );
}
