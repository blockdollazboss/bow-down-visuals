import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Coins, Gift, Swords, Trophy } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { reachApi, type RaidDto, type WatchProgress, type LoyaltyState } from "@/lib/reach-api";
import { normalizeLoyaltyState, normalizeWatchProgress } from "@/lib/reach-watch";
import { apiFetch } from "@/lib/social-api";

/* ── Watch-page Reach panel (Stack 9 #3/#5/#6) ──────────────────────────
   - Stream-linked Drops: the panel heartbeats the server, which
     measures REAL elapsed time between beats; thresholds and the
     weekly budget are shown exactly as the server reports them.
   - Loyalty: this channel's points balance + perk redemption.
     Points are the channel's own — not Visual Bucs (the copy and
     the API both say so).
   - Raids: an outgoing raid shows a countdown and then carries the
     viewer to the target stream; an incoming raid shows who arrived. */

export default function ReachWatchPanel({
  streamId,
  profileId,
  isLive,
  isOwner: isOwnerProp,
}: {
  streamId: string;
  profileId: string | null;
  isLive: boolean;
  isOwner: boolean;
}) {
  const { user, getAccessToken } = useAuth();
  /* Ownership self-check: /live-streams/status returns the signed-in
     user's own live stream — if it's this one, the viewer is the
     streamer (the watch DTO deliberately carries no owner user id). */
  const [ownLive, setOwnLive] = useState(false);
  const isOwner = isOwnerProp || ownLive;
  useEffect(() => {
    if (!isLive || !user) return;
    (async () => {
      try {
        const res = await apiFetch(getAccessToken, "/api/live-streams/status");
        if (!res.ok) return;
        const d = (await res.json()) as { live_stream: { id: string } | null };
        setOwnLive(d.live_stream?.id === streamId);
      } catch { /* not the owner — panel stays viewer-side */ }
    })();
  }, [isLive, streamId, user, getAccessToken]);
  const [, setLocation] = useLocation();
  const [progress, setProgress] = useState<WatchProgress | null>(null);
  const [progressError, setProgressError] = useState(false);
  const [loyalty, setLoyalty] = useState<LoyaltyState | null>(null);
  const [redeemNote, setRedeemNote] = useState<string | null>(null);
  const [outgoing, setOutgoing] = useState<RaidDto | null>(null);
  const [incoming, setIncoming] = useState<RaidDto | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const sessionRef = useRef<string>("");
  if (!sessionRef.current) {
    sessionRef.current =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `watch-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
  const carriedRef = useRef<string | null>(null);
  const [raidTargets, setRaidTargets] = useState<Array<{ id: string; title: string; creatorName: string }>>([]);
  const [raidTarget, setRaidTarget] = useState("");
  const [raidNote, setRaidNote] = useState<string | null>(null);

  /* Raid control (owner): targets are the streams actually live
     right now — the server re-checks at raid time regardless. */
  useEffect(() => {
    if (!isOwner || !isLive) return;
    (async () => {
      try {
        const res = await fetch("/api/live-streams/live");
        if (!res.ok) return;
        const d = (await res.json()) as { streams: Array<{ id: string; title: string; creator: { display_name: string } | null }> };
        setRaidTargets(
          (d.streams ?? []).filter((x) => x.id !== streamId).map((x) => ({ id: x.id, title: x.title, creatorName: x.creator?.display_name ?? "Creator" })),
        );
      } catch { /* the select just stays empty */ }
    })();
  }, [isOwner, isLive, streamId]);

  /* Watch accrual heartbeat (signed-in viewers only — guests watch,
     but drops/loyalty are account things and the server says so). */
  useEffect(() => {
    if (!isLive || !user) return;
    let cancelled = false;
    const beat = async () => {
      try {
        const raw = await reachApi.watchHeartbeat(getAccessToken, streamId, sessionRef.current);
        /* Guard (DTO batch #2): a malformed success is a load failure,
           never a fake budget — normalize or throw into the catch. */
        const p = normalizeWatchProgress(raw);
        if (!p) throw new Error("malformed watch progress");
        if (!cancelled) {
          setProgress(p);
          setProgressError(false);
          if (p.justAwarded?.length) {
            // refresh loyalty too — watch blocks may have landed
            if (profileId) reachApi.loyalty(getAccessToken, profileId).then((s) => setLoyalty(normalizeLoyaltyState(s))).catch(() => undefined);
          }
        }
      } catch {
        if (!cancelled) setProgressError(true);
      }
    };
    void beat();
    const t = setInterval(beat, 15_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [isLive, user, streamId, profileId, getAccessToken]);

  useEffect(() => {
    if (!profileId || !user) return;
    reachApi.loyalty(getAccessToken, profileId).then((s) => setLoyalty(normalizeLoyaltyState(s))).catch(() => undefined);
  }, [profileId, user, getAccessToken]);

  /* Raid polling: outgoing (banner + carry) and incoming (alert). */
  useEffect(() => {
    if (!isLive) return;
    let cancelled = false;
    const poll = async () => {
      try {
        /* Stack-28 #34 / A3-F16: the two raid halves settle
           independently (allSettled) — one endpoint hiccupping must
           not discard the other half's fresh state for this cycle
           (e.g. a missed incoming-raid alert). */
        const [outR, incR] = await Promise.allSettled([
          reachApi.raidOutgoing(getAccessToken, streamId),
          reachApi.raidIncoming(getAccessToken, streamId),
        ]);
        if (cancelled) return;
        if (incR.status === "fulfilled") setIncoming(incR.value.raid);
        if (outR.status !== "fulfilled") return;
        const out = outR.value;
        setOutgoing(out.raid);
        if (out.raid && !isOwner && carriedRef.current !== out.raid.id) {
          const startedAt = out.raid.createdAt ? new Date(out.raid.createdAt).getTime() : Date.now();
          const remaining = Math.max(0, Math.ceil((startedAt + out.raid.countdownSeconds * 1000 - Date.now()) / 1000));
          setCountdown(remaining);
          if (remaining <= 0) {
            carriedRef.current = out.raid.id;
            setLocation(`/live/${out.raid.targetStreamId}`);
          }
        }
      } catch {
        /* a failed poll is silent — the next one retries */
      }
    };
    void poll();
    const t = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [isLive, streamId, isOwner, getAccessToken, setLocation]);

  if (!user) return null;

  return (
    <div className="mt-5 space-y-4">
      {incoming && (
        <div className="rounded-2xl border border-[#C9A84C]/50 bg-[#C9A84C]/10 p-4 text-sm" data-testid="raid-incoming">
          <span className="flex items-center gap-2 font-bold text-[#e8c86a]">
            <Swords className="h-4 w-4" /> Raid incoming!
          </span>
          <p className="mt-1 text-white/70">
            {incoming.raider?.displayName ?? "A creator"} raided with {incoming.viewerCount} viewer{incoming.viewerCount === 1 ? "" : "s"}.
          </p>
        </div>
      )}
      {outgoing && (
        <div className="rounded-2xl border border-red-500/40 bg-red-950/30 p-4 text-sm" data-testid="raid-outgoing">
          <span className="flex items-center gap-2 font-bold text-red-300">
            <Swords className="h-4 w-4" /> {outgoing.raider?.displayName ?? "This creator"} is raiding {outgoing.target?.displayName ?? "another creator"}
          </span>
          <p className="mt-1 text-white/70">
            {isOwner
              ? "Your viewers are being carried over now."
              : countdown !== null && countdown > 0
                ? `You're heading over in ${countdown}s — hang tight.`
                : "Heading over now…"}
          </p>
        </div>
      )}

      {isOwner && isLive && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4" data-testid="raid-control">
          <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-wider text-[#e8c86a]">
            <Swords className="h-4 w-4" /> Raid another creator
          </h3>
          <p className="mt-1 text-xs text-white/50">Send your viewers to a creator who is live right now. They get a countdown, then land on that stream; the creator gets a raid alert with your real viewer count.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <select value={raidTarget} onChange={(e) => setRaidTarget(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-white/15 bg-black px-3 py-2 text-sm focus:border-[#e8c86a] focus:outline-none">
              <option value="">Pick a live stream…</option>
              {raidTargets.map((t) => (
                <option key={t.id} value={t.id}>{t.creatorName} — {t.title}</option>
              ))}
            </select>
            <button
              type="button"
              disabled={!raidTarget}
              onClick={async () => {
                setRaidNote(null);
                try {
                  const r = await reachApi.raid(getAccessToken, streamId, raidTarget);
                  setRaidNote(`Raid sent — ${r.raid.viewerCount} viewer${r.raid.viewerCount === 1 ? "" : "s"} carried over.`);
                } catch (e) {
                  setRaidNote(e instanceof Error ? e.message : "The raid couldn't start.");
                }
              }}
              className="rounded-full bg-red-600 px-4 py-2 text-sm font-bold text-white transition enabled:hover:scale-[1.02] disabled:opacity-50"
            >
              Raid now
            </button>
          </div>
          {raidTargets.length === 0 && <p className="mt-2 text-xs text-white/40">Nobody else is live right now — a raid needs a live target.</p>}
          {raidNote && <p className="mt-2 text-xs text-white/60">{raidNote}</p>}
        </div>
      )}

      {isLive && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-wider text-[#e8c86a]">
            <Gift className="h-4 w-4" /> Stream Drops
          </h3>
          {progressError && <p className="mt-2 text-xs text-red-300">Drop progress couldn't load — your watch time may not be counting right now.</p>}
          {progress && (
            <div className="mt-3 space-y-3">
              {progress.thresholds.map((t) => (
                <div key={t.seconds}>
                  <div className="flex justify-between text-xs text-white/60">
                    <span>
                      Watch {Math.floor(t.seconds / 60)} min → <span className="font-bold text-white">{t.amountVb} Visual Bucs</span>
                    </span>
                    <span>{t.earned ? "Earned ✓" : `${Math.floor(t.progressSeconds / 60)}/${Math.floor(t.seconds / 60)} min`}</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-[#C9A84C]" style={{ width: `${Math.min(100, (t.progressSeconds / t.seconds) * 100)}%` }} />
                  </div>
                </div>
              ))}
              <p className="text-[11px] text-white/40">
                Drops pay from the weekly stream-drop budget ({progress.weeklyBudget.remainingVb} of {progress.weeklyBudget.capVb} Visual Bucs left this week).
                {progress.budgetReached ? " This week's budget is spent — watch time still counts toward loyalty points." : ""}
              </p>
            </div>
          )}
        </div>
      )}

      {loyalty && loyalty.enabled && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-wider text-[#e8c86a]">
            <Trophy className="h-4 w-4" /> Channel loyalty
          </h3>
          <p className="mt-2 flex items-center gap-1.5 text-sm text-white/80">
            <Coins className="h-4 w-4 text-[#C9A84C]" /> You have <b>{loyalty.myPoints}</b> points on this channel
          </p>
          <p className="mt-1 text-[11px] text-white/40">{loyalty.notice}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {loyalty.perks.map((perk) => (
              <button
                key={perk.kind}
                type="button"
                disabled={loyalty.myPoints < perk.cost}
                onClick={async () => {
                  setRedeemNote(null);
                  try {
                    const r = await reachApi.redeem(getAccessToken, profileId!, perk.kind);
                    setLoyalty((prev) => (prev ? { ...prev, myPoints: r.myPoints } : prev));
                    setRedeemNote(`Requested: ${perk.label}. The creator sees it in their queue and fulfills it by hand.`);
                  } catch (e) {
                    setRedeemNote(e instanceof Error ? e.message : "That redemption didn't go through.");
                  }
                }}
                className="rounded-full border border-[#C9A84C]/40 px-3 py-1.5 text-xs font-bold text-[#e8c86a] transition enabled:hover:bg-[#C9A84C]/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {perk.label} — {perk.cost} pts
              </button>
            ))}
          </div>
          {redeemNote && <p className="mt-2 text-xs text-white/60">{redeemNote}</p>}
          {loyalty.myRedemptions.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-white/50">
              {loyalty.myRedemptions.slice(0, 5).map((r) => (
                <li key={r.id}>
                  {r.perkLabel} — <span className="capitalize">{r.status}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
