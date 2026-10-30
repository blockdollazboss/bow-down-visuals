import { apiErrorMessage, plainErrorText } from "../../lib/api-error";
import { useEffect, useState } from "react";
import { CheckCircle2, HeartHandshake, Loader2, Sparkles, XCircle } from "lucide-react";
import {
  COLLAB_MATCH_PATH,
  collabMatchMarkPath,
  suggestionAction,
  suggestionScoreLabel,
  type CollabMatchResponse,
  type CollabSuggestion,
} from "@/lib/upg-fans";
import { NicheLabel, PlatformLabel, scoreColor } from "@/lib/collabs";

/* ─── Collab Match panel — house-suggested pairings (#175) ────────────────
   Docked INSIDE the Collabs page, never a standalone page. The house
   suggests pairings by niche + size on a cadence; the ONLY way to contact
   a suggested creator is through a suggestion — when both sides mark
   Interested, the broker writes one intro into the normal collab inbox.
   Passing closes the pair quietly and forever: no re-nag, no "they
   passed on you" notice to the other side. */

type AuthedFn = (
  path: string,
  opts?: { method?: string; body?: unknown },
) => Promise<{ res: Response; data: Record<string, unknown> }>;

const goldBtn =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-amber-300 to-yellow-600 px-5 py-3 text-sm font-extrabold uppercase tracking-wider text-black shadow-[0_0_24px_rgba(234,179,8,0.35)] transition hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed";
const ghostBtn =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-bold text-white/80 transition hover:border-primary/50 hover:text-white disabled:opacity-50";

export function CollabMatchPanel({ authed }: { authed: AuthedFn }) {
  const [data, setData] = useState<CollabMatchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const { res, data: payload } = await authed(COLLAB_MATCH_PATH);
      if (!res.ok) throw new Error("load failed");
      setData(payload as unknown as CollabMatchResponse);
    } catch {
      setLoadError("Couldn't load your suggested matches — try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function mark(s: CollabSuggestion, markValue: "interested" | "passed") {
    if (actingId) return;
    setActingId(s.id);
    setActionError(null);
    try {
      const { res, data: payload } = await authed(collabMatchMarkPath(s.id), {
        method: "POST",
        body: { mark: markValue },
      });
      if (!res.ok) throw new Error(apiErrorMessage(payload, "mark failed"));
      await load();
    } catch (err) {
      setActionError(plainErrorText(err, "Couldn't save your answer — try again."));
    } finally {
      setActingId(null);
    }
  }

  return (
    <section className="mx-auto max-w-4xl">
      <div className="mb-6 text-center">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-amber-300">
          <Sparkles className="h-3.5 w-3.5" /> Suggested for you
        </div>
        <h2 className="text-2xl font-black text-white">Collab Match</h2>
        <p className="mx-auto mt-2 max-w-2xl text-sm text-white/60">
          Pairings the house picks for you from your niche and size. There's no cold-DMing here:
          if you both say Interested, we drop one intro into your collab inbox and you take it
          from there. Pass, and the pairing closes quietly — they never hear about it.
        </p>
      </div>

      {loading && !data && (
        <div className="flex items-center justify-center gap-2 py-12 text-white/50">
          <Loader2 className="h-5 w-5 animate-spin" /> Finding your matches…
        </div>
      )}

      {loadError && (
        <div className="rounded-2xl border border-red-400/30 bg-red-400/5 p-6 text-center">
          <p className="text-sm text-red-200">{loadError}</p>
          <button onClick={load} className={`${ghostBtn} mt-4`}>Try again</button>
        </div>
      )}

      {data && !data.hasProfile && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
          <p className="text-sm text-white/70">
            Set up your collab profile first (the My Profile tab) — matches are picked from your
            niche, platforms, and what you're looking for.
          </p>
        </div>
      )}

      {data && data.hasProfile && data.suggestions.length === 0 && !loading && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
          <p className="text-sm text-white/70">
            No open matches right now. New pairings arrive on a regular cadence — check back soon.
          </p>
        </div>
      )}

      {actionError && <p className="mb-4 text-center text-sm text-red-300">{actionError}</p>}

      <div className="space-y-4">
        {data?.suggestions.map((s) => {
          const action = suggestionAction(s);
          return (
            <article key={s.id} className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-lg font-extrabold text-white">
                    {s.other?.displayName ?? "A creator"}
                  </h3>
                  <p className="text-sm text-white/50">
                    {s.other ? NicheLabel(s.other.niche) : ""}
                    {s.other && s.other.platforms.length > 0 && (
                      <>
                        {" · "}
                        {s.other.platforms
                          .map((p) => `${PlatformLabel(p.platform)} ${p.followers.toLocaleString("en-US")}`)
                          .join(" · ")}
                      </>
                    )}
                  </p>
                </div>
                <div className="text-right">
                  <span className={`text-2xl font-black ${scoreColor(s.score)}`}>{s.score}</span>
                  <p className="text-[11px] font-bold uppercase tracking-widest text-white/40">
                    {suggestionScoreLabel(s.score)}
                  </p>
                </div>
              </div>

              {s.reasons.length > 0 && (
                <ul className="mt-3 space-y-1">
                  {s.reasons.map((r) => (
                    <li key={r} className="text-sm text-white/60">• {r}</li>
                  ))}
                </ul>
              )}

              <div className="mt-4">
                {action === "answer" && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => mark(s, "interested")}
                      disabled={actingId === s.id}
                      className={goldBtn}
                    >
                      {actingId === s.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <HeartHandshake className="h-4 w-4" />}
                      Interested
                    </button>
                    <button
                      onClick={() => mark(s, "passed")}
                      disabled={actingId === s.id}
                      className={ghostBtn}
                    >
                      <XCircle className="h-4 w-4" /> Pass
                    </button>
                  </div>
                )}
                {action === "waiting" && (
                  <p className="text-sm text-white/50">
                    {s.myStatus === "interested"
                      ? "You said Interested — if they do too, the intro lands in your inbox."
                      : "Passed — this pairing is closed."}
                  </p>
                )}
                {action === "connected" && (
                  <p className="inline-flex items-center gap-2 text-sm font-bold text-emerald-300">
                    <CheckCircle2 className="h-4 w-4" /> Connected — the intro is in your collab inbox.
                  </p>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
