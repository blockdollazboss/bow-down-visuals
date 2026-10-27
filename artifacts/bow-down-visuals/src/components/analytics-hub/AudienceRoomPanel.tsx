import { useCallback, useEffect, useState } from "react";
import { Clock3, Loader2, MapPinOff, MousePointerClick } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  AUDIENCE_ROOM_PATH,
  hourAxisLabel,
  hourBarPct,
  playSourceLabel,
  type AudienceRoomResponse,
} from "@/lib/upg-fans";

/* ─── Audience Room (N16) ─────────────────────────────────────────────────
   Docked INSIDE the Analytics Hub as its own tab — one room over the
   plays a creator actually got in the last 28 days: WHEN the audience
   listens (best hours, real played_at rows, UTC axis labelled as UTC)
   and WHERE plays come from (the source each playing surface declared).
   Plays recorded before source tracking carry no source and are shown
   as untracked — never redistributed into a guessed source. Fan city is
   not recorded anywhere in the platform, so the room says exactly that
   instead of estimating a fan map it cannot prove. */

export function AudienceRoomPanel() {
  const { user, getAccessToken } = useAuth();
  const [room, setRoom] = useState<AudienceRoomResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsProfile, setNeedsProfile] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    setNeedsProfile(false);
    try {
      const token = await getAccessToken();
      const res = await fetch(AUDIENCE_ROOM_PATH, {
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.status === 404) {
        setNeedsProfile(true);
        return;
      }
      if (!res.ok) throw new Error("load failed");
      setRoom(data as unknown as AudienceRoomResponse);
    } catch {
      setError("Couldn't load your Audience Room — try again.");
    } finally {
      setLoading(false);
    }
  }, [user, getAccessToken]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-white/50">
        <Loader2 className="h-5 w-5 animate-spin" /> Opening your Audience Room…
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-red-400/30 bg-red-400/5 p-6 text-center">
        <p className="text-sm text-red-200">{error}</p>
        <button
          onClick={load}
          className="mt-4 inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-bold text-white/80 transition hover:border-primary/50 hover:text-white"
        >
          Try again
        </button>
      </div>
    );
  }

  if (needsProfile) {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
        <p className="text-sm text-white/70">
          Set up your creator profile to open your Audience Room — it reads the plays on your
          own tracks and videos.
        </p>
      </div>
    );
  }

  if (!room) return null;

  return (
    <div className="mx-auto grid max-w-5xl gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-white/40">
            Plays · last {room.windowDays} days
          </p>
          <p className="mt-1 text-3xl font-black text-white">{room.totalPlays.toLocaleString("en-US")}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-white/40">
            <Clock3 className="h-3.5 w-3.5" /> Peak hour
          </p>
          <p className="mt-1 text-3xl font-black text-white">
            {room.peak ? room.peak.label.split("–")[0]?.trim() : "—"}
          </p>
          <p className="text-xs text-white/40">
            {room.peak ? `${room.peak.plays.toLocaleString("en-US")} plays in that hour (UTC)` : "No plays yet in this window"}
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-white/40">
            <MousePointerClick className="h-3.5 w-3.5" /> With a known source
          </p>
          <p className="mt-1 text-3xl font-black text-white">{room.trackedPlays.toLocaleString("en-US")}</p>
          <p className="text-xs text-white/40">
            {room.untrackedPlays.toLocaleString("en-US")} older plays carry no source — counted, never guessed.
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <p className="mb-4 text-xs font-bold uppercase tracking-widest text-white/40">
          When your audience listens (UTC)
        </p>
        {room.totalPlays === 0 ? (
          <p className="text-sm text-white/60">No plays in the last {room.windowDays} days yet — share a track and this room fills in.</p>
        ) : (
          <>
            <div className="flex h-32 items-end gap-1" role="img" aria-label="Plays by hour of day, UTC">
              {room.hourly.map((plays, hour) => (
                <div
                  key={hour}
                  className="flex-1 rounded-t bg-gradient-to-t from-amber-500/50 to-amber-300"
                  style={{ height: `${Math.max(hourBarPct(plays, room.hourly), plays > 0 ? 4 : 0)}%` }}
                  title={`${hourAxisLabel(hour)} UTC — ${plays} plays`}
                />
              ))}
            </div>
            <div className="mt-2 flex justify-between text-[10px] font-bold text-white/35">
              <span>00:00</span>
              <span>06:00</span>
              <span>12:00</span>
              <span>18:00</span>
              <span>23:00</span>
            </div>
          </>
        )}
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <p className="mb-4 text-xs font-bold uppercase tracking-widest text-white/40">
          Where plays come from
        </p>
        {room.sources.length === 0 ? (
          <p className="text-sm text-white/60">
            No source-tracked plays yet. New plays declare where they started; older ones stay
            untracked rather than being guessed into a source.
          </p>
        ) : (
          <ul className="space-y-2">
            {room.sources.map((s) => (
              <li key={s.source} className="flex items-center gap-3">
                <span className="w-40 shrink-0 truncate text-sm text-white/70">{playSourceLabel(s.source)}</span>
                <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/10">
                  <span className="block h-full rounded-full bg-amber-400" style={{ width: `${s.pct}%` }} />
                </span>
                <span className="w-24 shrink-0 text-right text-sm font-bold text-white">
                  {s.plays.toLocaleString("en-US")} · {s.pct}%
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-white/40">
          <MapPinOff className="h-3.5 w-3.5" /> Fan cities
        </p>
        <p className="mt-2 text-sm text-white/60">{room.fanCity.reason}</p>
      </div>
    </div>
  );
}
