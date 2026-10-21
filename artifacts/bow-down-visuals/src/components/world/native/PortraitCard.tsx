import { useEffect, useState } from "react";
import { Crown, Play, Plus, Check, Loader2, ShoppingBag, Ticket } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  NativeCard, NativeLoadingState, NativeErrorState, TransferFooter,
} from "@/components/world/native";
import type { CourtMember } from "@/lib/royal-court";
import {
  portraitWebsitePath, portraitProfilePath, portraitFollowPath,
  portraitUnfollowPath, portraitFollowingPath, portraitMembershipsPath,
  portraitStoreCatalogPath, jukeboxPickId, nextFollowerCount,
  portraitCardFromWire, membershipSummaryRows, shopSummaryRows,
  type PortraitCardData, type PortraitSummaryRow,
} from "@/lib/world/portrait-card";

/* ─── The Portrait Card (NATIVE-PLAN §3.4 — kills the Front Row leak) ─
   A Front Row portrait click used to call onOpenPage("/artist/:slug")
   and mount the creator's whole profile PAGE in the panel. Now it
   opens THIS card, in-world: portrait, name, bio line, Front Row
   seat, follow/unfollow on the profile rails, top tracks with Play,
   and memberships/shop as summary rows. The full Grand Stage
   profile is what the card's OWN transfer footer is for — the
   gallery station's websitePath is null, so this footer (pointing
   at /artist/<slug>) is the card's, rendered through the shared
   TransferFooter contract exactly once.
   PLAY SEAM: Play calls onPlayTrack with the jukebox catalog pick
   form (track:<id>) — the host wires it to the same jukebox.add
   intent the Jukebox panel uses (see lib/world/portrait-card.ts). */

function useAuthHeaders() {
  const { getAccessToken } = useAuth();
  return async (): Promise<Record<string, string>> => {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  };
}

function fmtClock(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec) || sec < 0) return "";
  const s = Math.floor(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function SummaryRows({ title, icon, rows, empty, isLight }: {
  title: string;
  icon: React.ReactNode;
  rows: PortraitSummaryRow[] | null;
  empty: string;
  isLight: boolean;
}) {
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  return (
    <div>
      <p className={`mb-1 flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
        {icon} {title}
      </p>
      {rows === null ? (
        <p className={`inline-flex items-center gap-2 text-xs ${muted}`}>
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[#d4af37]" /> Checking…
        </p>
      ) : rows.length === 0 ? (
        <p className={`text-xs ${muted}`}>{empty}</p>
      ) : (
        <div className="space-y-1">
          {rows.map((r) => (
            <p key={`${r.label}-${r.detail}`} className={`flex items-baseline gap-2 text-xs ${isLight ? "text-[#2a1e07]" : "text-white/80"}`}>
              <span className="font-bold">{r.label}</span>
              {r.detail && <span className={muted}>{r.detail}</span>}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export function PortraitCard({
  member, isLight, isGuest, onPlayTrack, onBack,
}: {
  member: CourtMember;
  isLight: boolean;
  isGuest: boolean;
  /** Play seam: the host's jukebox.add intent (track:<id> pick). */
  onPlayTrack: (trackId: string) => void;
  onBack: () => void;
}) {
  const authHeaders = useAuthHeaders();
  const { user } = useAuth();
  const [card, setCard] = useState<PortraitCardData | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [following, setFollowing] = useState<boolean | null>(null);
  const [followBusy, setFollowBusy] = useState(false);
  const [followNote, setFollowNote] = useState<string | null>(null);
  const [playedId, setPlayedId] = useState<string | null>(null);
  const [memberships, setMemberships] = useState<PortraitSummaryRow[] | null>(null);
  const [shop, setShop] = useState<PortraitSummaryRow[] | null>(null);
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setCard(null);
    (async () => {
      try {
        const res = await fetch(portraitProfilePath(member.slug));
        if (!res.ok) throw new Error("profile");
        const wire: unknown = await res.json();
        if (!cancelled) setCard(portraitCardFromWire(member, wire));
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [member, tick]);

  /* Follow state + the two summary rails ride the loaded card. */
  useEffect(() => {
    if (!card) return;
    let cancelled = false;
    if (user) {
      (async () => {
        try {
          const res = await fetch(portraitFollowingPath([card.profileId]), {
            headers: await authHeaders(),
          });
          if (!res.ok || cancelled) return;
          const d = (await res.json()) as Record<string, boolean>;
          if (!cancelled) setFollowing(d[card.profileId] ?? false);
        } catch { /* button stays in its loading dress */ }
      })();
    } else {
      setFollowing(false);
    }
    if (card.userId) {
      fetch(portraitMembershipsPath(card.userId))
        .then(async (r) => (r.ok ? membershipSummaryRows(await r.json()) : []))
        .then((rows) => { if (!cancelled) setMemberships(rows); })
        .catch(() => { if (!cancelled) setMemberships([]); });
    } else {
      setMemberships([]);
    }
    fetch(portraitStoreCatalogPath(card.slug))
      .then(async (r) => (r.ok ? shopSummaryRows(await r.json()) : []))
      .then((rows) => { if (!cancelled) setShop(rows); })
      .catch(() => { if (!cancelled) setShop([]); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card, user]);

  async function toggleFollow() {
    if (!card || followBusy || following === null) return;
    setFollowBusy(true);
    setFollowNote(null);
    try {
      const res = await fetch(
        following ? portraitUnfollowPath(card.profileId) : portraitFollowPath(card.profileId),
        { method: following ? "DELETE" : "POST", headers: await authHeaders() },
      );
      const d = (await res.json().catch(() => ({}))) as { follower_count?: number; error?: string };
      if (!res.ok) throw new Error(d.error ?? "follow");
      const next = !following;
      setFollowing(next);
      setCard((c) =>
        c
          ? {
              ...c,
              followerCount:
                typeof d.follower_count === "number"
                  ? d.follower_count
                  : nextFollowerCount(c.followerCount, next),
            }
          : c,
      );
    } catch {
      setFollowNote("The follow didn't stick — try again.");
    } finally {
      setFollowBusy(false);
    }
  }

  const websitePath = portraitWebsitePath(member.slug);

  return (
    <div data-testid="world-portrait-card">
      <button
        type="button"
        data-testid="world-portrait-back"
        onClick={onBack}
        className={`mb-2 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition ${
          isLight
            ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
            : "border-white/15 text-white/75 hover:text-white"
        }`}
      >
        ← Back to the gallery
      </button>

      {failed ? (
        <NativeErrorState
          isLight={isLight}
          title="This portrait wouldn't open"
          message="The creator is fine — the card just couldn't fetch their details."
          onRetry={() => setTick((n) => n + 1)}
        />
      ) : card === null ? (
        <NativeLoadingState isLight={isLight} message="Bringing their card down from the wall…" />
      ) : (
        <NativeCard isLight={isLight}>
          <div className="flex flex-wrap items-start gap-3">
            {card.avatarUrl ? (
              <img
                src={card.avatarUrl}
                alt={card.displayName}
                className="h-16 w-16 rounded-full border-2 border-[#d4af37] object-cover"
              />
            ) : (
              <span className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-[#d4af37] bg-gradient-to-br from-amber-300 to-amber-600 text-2xl font-black text-black">
                {card.displayName.slice(0, 1).toUpperCase()}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className={`truncate text-base font-black ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                {card.displayName}
              </p>
              <p className="inline-flex items-center gap-1 text-[11px] font-black uppercase tracking-wide text-[#e8c86a]">
                <Crown className="h-3 w-3" /> Front Row · Seat #{card.seat}
              </p>
              {card.bioLine && <p className={`mt-0.5 text-xs ${muted}`}>{card.bioLine}</p>}
              <p className={`text-[11px] ${muted}`}>
                {card.followerCount.toLocaleString("en-US")} followers
              </p>
            </div>
            {isGuest ? (
              <span className={`text-[11px] font-semibold ${muted}`}>
                Sign in on the website to follow from the palace.
              </span>
            ) : following === null ? (
              <span className="inline-block h-7 w-20 animate-pulse rounded-full bg-white/10" />
            ) : (
              <button
                type="button"
                data-testid="world-portrait-follow"
                onClick={() => void toggleFollow()}
                disabled={followBusy}
                className={`inline-flex items-center gap-1 rounded-full px-3.5 py-1.5 text-xs font-bold transition disabled:opacity-50 ${
                  following
                    ? isLight
                      ? "border border-[#7A5A12]/30 text-[#6B5B36]"
                      : "border border-white/15 text-white/60"
                    : "bg-[#d4af37] text-black hover:scale-105"
                }`}
              >
                {followBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : following ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Plus className="h-3.5 w-3.5" />
                )}
                {following ? "Following" : "Follow"}
              </button>
            )}
          </div>
          {followNote && (
            <p className={`mt-2 text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{followNote}</p>
          )}

          {card.topTracks.length > 0 && (
            <div className="mt-3">
              <p className={`mb-1 text-[11px] font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
                Top tracks
              </p>
              <div className="space-y-1.5">
                {card.topTracks.map((t) => (
                  <div
                    key={t.id}
                    className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${
                      isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"
                    }`}
                  >
                    {t.artworkUrl ? (
                      <img src={t.artworkUrl} alt="" className="h-9 w-9 rounded-lg object-cover" />
                    ) : null}
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>{t.title}</span>
                      <span className={`block text-[11px] ${muted}`}>
                        {t.plays.toLocaleString("en-US")} plays{fmtClock(t.durationSec) ? ` · ${fmtClock(t.durationSec)}` : ""}
                      </span>
                    </span>
                    <button
                      type="button"
                      data-testid="world-portrait-play"
                      onClick={() => { onPlayTrack(jukeboxPickId(t.id)); setPlayedId(t.id); }}
                      className="inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-bold text-black transition hover:scale-105"
                    >
                      <Play className="h-3.5 w-3.5" />
                      {playedId === t.id ? "On the jukebox" : "Play"}
                    </button>
                  </div>
                ))}
              </div>
              <p className={`mt-1 text-[11px] ${muted}`}>
                Play puts the track on the room&rsquo;s jukebox — the Music Hall hears it together.
              </p>
            </div>
          )}

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <SummaryRows
              title="Memberships"
              icon={<Ticket className="h-3.5 w-3.5" />}
              rows={memberships}
              empty="No memberships on offer right now."
              isLight={isLight}
            />
            <SummaryRows
              title="In their shop"
              icon={<ShoppingBag className="h-3.5 w-3.5" />}
              rows={shop}
              empty="Nothing on the shelf right now."
              isLight={isLight}
            />
          </div>
          <p className={`mt-2 text-[11px] ${muted}`}>
            Joining and buying happen at the shop stands and on their full profile — the card&rsquo;s
            transfer below opens it.
          </p>
        </NativeCard>
      )}

      {/* The card's OWN transfer — the gallery station carries no
          websitePath (null), so the full Grand Stage profile is
          this card's footer, via the shared TransferFooter. */}
      <TransferFooter
        context={`${member.displayName} — the full Grand Stage profile`}
        websitePath={websitePath}
        isLight={isLight}
      />
    </div>
  );
}
