import { apiErrorMessage, plainErrorText } from "../../lib/api-error";
import { useCallback, useEffect, useState } from "react";
import { Crown, Disc3, Heart, Loader2, Trophy } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import {
  REMIX_KING_STATUS_LABELS,
  splitsArePublished,
  type RemixKingView,
} from "@/lib/remix-king";

/* ─── Remix the King (#152) — docked inside Contests ─────────────────
   The monthly house event: the King drops a track, members remix it,
   the winning remix becomes an official release. The splits are
   published in writing up front — they render BEFORE the entry form,
   exactly as the event published them, in both themes. Winning is a
   release, not a cash prize: splits pay in Visual Bucs only. */

export default function RemixKingSection() {
  const isLight = useIsLightTheme();
  const { user, getAccessToken } = useAuth();
  const [view, setView] = useState<RemixKingView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [voted, setVoted] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const cardCls = isLight
    ? "rounded-2xl border border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]"
    : "rounded-2xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]";
  const inputCls = `w-full rounded-xl border px-4 py-2.5 outline-none focus:border-primary/60 ${isLight ? "border-[#C9A84C]/50 bg-white text-[#2A1E07] placeholder:text-[#2A1E07]/35" : "border-white/[0.12] bg-white/[0.03] text-white placeholder:text-white/25"}`;

  const authHeaders = useCallback(async (): Promise<HeadersInit> => {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [getAccessToken]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/remix-king/current", { headers: await authHeaders() });
      if (!res.ok) throw new Error("load failed");
      const data = (await res.json()) as { view: RemixKingView | null };
      setView(data.view);
      setVoted(new Set(data.view?.viewerVotedIds ?? []));
    } catch {
      setView(null);
    } finally {
      setLoaded(true);
    }
  }, [authHeaders]);

  useEffect(() => { void load(); }, [load]);

  if (!loaded || !view) return null;
  const { event, entries, release } = view;
  const published = splitsArePublished(event.splits);

  async function enter() {
    if (!title.trim() || !audioUrl.trim() || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/remix-king/events/${event.id}/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ remix_title: title.trim(), audio_url: audioUrl.trim(), note: note.trim() || undefined }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(apiErrorMessage(data, "Could not enter your remix"));
      setTitle(""); setAudioUrl(""); setNote("");
      setMsg("Your remix is in. Good luck — the winner becomes an official release.");
      void load();
    } catch (e) {
      setMsg(plainErrorText(e, "Could not enter your remix"));
    } finally {
      setBusy(false);
    }
  }

  async function vote(entryId: string) {
    try {
      const res = await fetch(`/api/remix-king/entries/${entryId}/vote`, {
        method: "POST",
        headers: await authHeaders(),
      });
      const data = (await res.json()) as { voted?: boolean; error?: string };
      if (!res.ok) throw new Error(apiErrorMessage(data, "Vote failed"));
      setVoted((prev) => {
        const next = new Set(prev);
        if (data.voted) next.add(entryId); else next.delete(entryId);
        return next;
      });
      void load();
    } catch (e) {
      setMsg(plainErrorText(e, "Vote failed"));
    }
  }

  return (
    <section data-testid="remix-king-section" className={`mt-8 ${cardCls} p-6`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-primary">
            <Crown className="h-4 w-4" /> Monthly house event
          </p>
          <h2 className="mt-1 text-xl font-black">{event.title}</h2>
          <p className={`mt-1 text-sm ${isLight ? "text-[#5c5138]" : "text-white/55"}`}>
            Thy Cheat Code dropped <b>“{event.kingTrackTitle}”</b> — remix it. The winning remix becomes an official release.
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
          {REMIX_KING_STATUS_LABELS[event.status] ?? event.status}
        </span>
      </div>

      {(event.kingTrackAudioUrl || event.kingTrackStemsUrl) && (
        <div className="mt-4 flex flex-wrap gap-2">
          {event.kingTrackAudioUrl && (
            <a href={event.kingTrackAudioUrl} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold hover:border-primary/40">
              <Disc3 className="h-4 w-4" /> Hear the King's track
            </a>
          )}
          {event.kingTrackStemsUrl && (
            <a href={event.kingTrackStemsUrl} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold hover:border-primary/40">
              <Disc3 className="h-4 w-4" /> Download the stems
            </a>
          )}
        </div>
      )}

      {/* The splits — in writing, up front, before anyone enters. */}
      <div className={`mt-5 rounded-xl border p-4 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/[0.08] bg-black/40"}`}>
        <p className="text-xs font-bold uppercase tracking-wider text-primary">The splits — published up front, in writing</p>
        {published ? (
          <ul className="mt-2 space-y-1.5">
            {event.splits.map((s) => (
              <li key={s.role} className="flex items-center justify-between text-sm">
                <span>{s.payeeName}</span>
                <b>{s.sharePct}%</b>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm opacity-70">Splits for this month have not been published yet — entries open once they are.</p>
        )}
        <p className={`mt-2 text-xs ${isLight ? "text-[#5c5138]" : "text-white/40"}`}>
          Splits are frozen the moment entries open and pay in Visual Bucs on the official release. They never change after you enter.
        </p>
      </div>

      {release && (
        <div className="mt-5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
          <p className="inline-flex items-center gap-2 font-bold text-emerald-300">
            <Trophy className="h-4 w-4" /> Official release: {release.releaseTitle}
          </p>
          <p className="mt-1 text-sm opacity-80">
            By {release.winnerName} — released under the splits published above.
            {release.status === "released" ? " Out now." : " Release in preparation."}
          </p>
        </div>
      )}

      {event.status === "open" && published && (
        user ? (
          view.viewerEntry ? (
            <p className="mt-5 text-sm font-semibold">Your remix “{view.viewerEntry.remixTitle}” is in — one entry per member, per month.</p>
          ) : (
            <div className="mt-5 space-y-3">
              <h3 className="font-bold">Enter your remix</h3>
              <input value={title} onChange={(e) => setTitle(e.target.value.slice(0, 120))} placeholder="Remix title" maxLength={120} className={inputCls} />
              <input value={audioUrl} onChange={(e) => setAudioUrl(e.target.value.slice(0, 1000))} placeholder="Link to your remix audio" maxLength={1000} className={inputCls} />
              <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 500))} placeholder="A line about your flip (optional)" maxLength={500} className={inputCls} />
              <button onClick={enter} disabled={busy || !title.trim() || !audioUrl.trim()} className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-black hover:brightness-110 disabled:opacity-40">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Disc3 className="h-4 w-4" />} Enter remix — free
              </button>
            </div>
          )
        ) : (
          <p className="mt-5 text-sm opacity-70">Sign in to enter your remix.</p>
        )
      )}

      {msg && <p className="mt-3 text-sm text-primary">{msg}</p>}

      {entries.length > 0 && (
        <div className="mt-6">
          <h3 className="font-bold">This month's remixes ({entries.length})</h3>
          <div className="mt-3 divide-y divide-white/[0.06]">
            {entries.map((e) => (
              <div key={e.id} className="flex items-center gap-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {e.remixTitle}
                    {e.status === "winner" && <span className="ml-2 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-bold text-emerald-300">Winner</span>}
                    {e.status === "shortlisted" && <span className="ml-2 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-bold text-primary">Shortlisted</span>}
                  </p>
                  <p className="text-xs opacity-50">by {e.entrantName}</p>
                </div>
                <a href={e.audioUrl} target="_blank" rel="noopener" className="text-xs font-semibold text-primary hover:underline">Listen</a>
                {user && e.userId !== user.id && (event.status === "open" || event.status === "judging") && (
                  <button onClick={() => void vote(e.id)} className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold ${voted.has(e.id) ? "border-red-400/40 bg-red-500/10 text-red-300" : "border-white/15 opacity-70 hover:opacity-100"}`}>
                    <Heart className="h-3 w-3" /> {e.voteCount}
                  </button>
                )}
                {(!user || e.userId === user.id) && <span className="text-[11px] opacity-50">{e.voteCount} votes</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
