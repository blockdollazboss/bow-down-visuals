import { useEffect, useRef, useState } from "react";
import { Crown, X, ChevronUp, ChevronDown, Search, AlertTriangle, RotateCcw, Check } from "lucide-react";
import {
  fetchMyCourt,
  fetchCourtCandidates,
  saveMyCourt,
  addToCourt,
  removeFromCourt,
  moveInCourt,
  canAddToCourt,
  courtSaveSummary,
  MAX_COURT_MEMBERS,
  type CourtCandidate,
} from "@/lib/royal-court";

/* ─── The Front Row picker (profile settings) ─────────────────────────────
   Crown up to 8 creators, ranked. Sources: creators you follow first,
   search for anyone else. The ordered list IS the ranking — up/down
   moves swap one seat. Save is replace-all against the owner's own
   profile (resolved server-side from the session); the confirmation
   reads back the court the server stored. Load and save failures are
   honest states with retries — never a fake-empty picker. */

interface MemberInfo {
  displayName: string;
  slug: string;
  avatarUrl: string | null;
  isPublic: boolean;
}

export default function RoyalCourtPicker() {
  const [courtIds, setCourtIds] = useState<string[]>([]);
  const [info, setInfo] = useState<Map<string, MemberInfo>>(new Map());
  const [candidates, setCandidates] = useState<CourtCandidate[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const remember = (list: Array<{ profileId: string; displayName: string; slug: string; avatarUrl: string | null; isPublic: boolean }>) => {
    setInfo((prev) => {
      const next = new Map(prev);
      for (const c of list) {
        next.set(c.profileId, {
          displayName: c.displayName,
          slug: c.slug,
          avatarUrl: c.avatarUrl,
          isPublic: c.isPublic,
        });
      }
      return next;
    });
  };

  /* Initial load: my current Court + the creators I follow. */
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        const [court, following] = await Promise.all([fetchMyCourt(), fetchCourtCandidates()]);
        if (cancelled) return;
        remember(court);
        remember(following);
        setCourtIds(court.map((m) => m.profileId));
        setCandidates(following);
      } catch (err) {
        if (cancelled) return;
        const status = (err as { status?: number }).status;
        setLoadError(
          status === 404
            ? "Your creator profile comes first — save it, then set your Front Row."
            : "Couldn't load your Front Row. Check your connection and try again.",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryNonce]);

  /* Search (debounced): blank query returns to the following list. */
  useEffect(() => {
    if (loading) return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      try {
        const results = await fetchCourtCandidates(query);
        remember(results);
        setCandidates(results);
      } catch {
        /* keep the last good candidate list — the picker stays usable */
      }
    }, 250);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, loading]);

  const pick = (c: CourtCandidate) => {
    remember([c]);
    setCourtIds((ids) => addToCourt(ids, c.profileId));
    setSavedMessage(null);
    setSaveError(null);
  };

  const drop = (profileId: string) => {
    setCourtIds((ids) => removeFromCourt(ids, profileId));
    setSavedMessage(null);
    setSaveError(null);
  };

  const move = (index: number, dir: -1 | 1) => {
    setCourtIds((ids) => moveInCourt(ids, index, dir));
    setSavedMessage(null);
    setSaveError(null);
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await saveMyCourt(courtIds);
      remember(saved);
      setCourtIds(saved.map((m) => m.profileId));
      setSavedMessage(courtSaveSummary(saved));
    } catch (err) {
      setSaveError((err as Error).message || "Couldn't save your Front Row. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4" data-testid="front-row-picker">
      <h3 className="mb-1 flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-white/50">
        <Crown className="h-4 w-4 text-amber-400" /> The Front Row
      </h3>
      <p className="mb-3 text-xs text-white/40">
        Seat up to {MAX_COURT_MEMBERS} creators you ride with — ranked, gold-framed, front and center on your public page. #1 takes the head seat in your Front Row.
      </p>

      {loading && <p className="py-4 text-center text-sm text-white/40">Loading your Front Row…</p>}

      {!loading && loadError && (
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <AlertTriangle className="h-6 w-6 text-amber-400" />
          <p className="text-sm text-white/70">{loadError}</p>
          <button
            type="button"
            onClick={() => setRetryNonce((n) => n + 1)}
            className="mt-1 inline-flex items-center gap-2 rounded-full bg-amber-400 px-5 py-2 text-xs font-bold text-black transition hover:scale-105"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Try again
          </button>
        </div>
      )}

      {!loading && !loadError && (
        <>
          {/* ── Current Court, in rank order ── */}
          {courtIds.length === 0 ? (
            <p className="mb-3 rounded-lg border border-dashed border-white/15 px-3 py-3 text-center text-xs text-white/40">
              No one has a seat yet. Pick from your people below — your Front Row shows on your page the moment you save.
            </p>
          ) : (
            <ol className="mb-3 space-y-1.5">
              {courtIds.map((id, i) => {
                const m = info.get(id);
                return (
                  <li key={id} className="flex items-center gap-2 rounded-lg border border-amber-400/25 bg-amber-400/5 px-2.5 py-1.5">
                    <span className="w-7 shrink-0 text-center text-xs font-black text-amber-300">#{i + 1}</span>
                    {m?.avatarUrl ? (
                      <img src={m.avatarUrl} alt="" className="h-7 w-7 shrink-0 rounded-full border border-amber-400/60 object-cover" />
                    ) : (
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-amber-400/60 text-[11px] font-black text-amber-300">
                        {(m?.displayName ?? "?").slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-white">{m?.displayName ?? "Creator"}</span>
                      {m && !m.isPublic && (
                        <span className="block text-[11px] text-amber-300/80">
                          Their profile is private right now — hidden from your page until they're public again.
                        </span>
                      )}
                    </span>
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${m?.displayName ?? "member"} up`} className="rounded p-1 text-white/60 transition hover:text-amber-300 disabled:opacity-25">
                      <ChevronUp className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === courtIds.length - 1} aria-label={`Move ${m?.displayName ?? "member"} down`} className="rounded p-1 text-white/60 transition hover:text-amber-300 disabled:opacity-25">
                      <ChevronDown className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => drop(id)} aria-label={`Remove ${m?.displayName ?? "member"} from your Front Row`} className="rounded p-1 text-white/60 transition hover:text-red-300">
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                );
              })}
            </ol>
          )}

          {/* ── Search + candidates ── */}
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-white/40" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search creators to seat…"
              className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/30"
            />
          </div>
          <p className="mb-2 text-[11px] uppercase tracking-widest text-white/35">
            {query.trim() ? "Search results" : "Creators you follow"}
          </p>
          {candidates.length === 0 ? (
            <p className="mb-3 text-xs text-white/40">
              {query.trim()
                ? "No creators match that search."
                : "You're not following any creators yet — search above to find your people."}
            </p>
          ) : (
            <div className="mb-3 flex flex-wrap gap-2">
              {candidates.map((c) => {
                const crowned = courtIds.includes(c.profileId);
                const full = !canAddToCourt(courtIds, c.profileId);
                return (
                  <span key={c.profileId} className="flex items-center gap-2 rounded-full border border-white/12 bg-black/30 py-1 pl-1 pr-2">
                    {c.avatarUrl ? (
                      <img src={c.avatarUrl} alt="" className="h-6 w-6 rounded-full object-cover" />
                    ) : (
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-[10px] font-black text-white/70">
                        {c.displayName.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <span className="text-xs font-semibold text-white/80">{c.displayName}</span>
                    <button
                      type="button"
                      onClick={() => (crowned ? drop(c.profileId) : pick(c))}
                      disabled={!crowned && full}
                      className={
                        crowned
                          ? "rounded-full bg-amber-400/20 px-2.5 py-0.5 text-[11px] font-bold text-amber-200 transition hover:bg-amber-400/30"
                          : "rounded-full bg-amber-400 px-2.5 py-0.5 text-[11px] font-bold text-black transition hover:scale-105 disabled:opacity-30 disabled:hover:scale-100"
                      }
                    >
                      {crowned ? "Seated ✓" : "Seat"}
                    </button>
                  </span>
                );
              })}
            </div>
          )}
          {courtIds.length >= MAX_COURT_MEMBERS && (
            <p className="mb-3 text-xs text-amber-300/80">Your Front Row is full — all {MAX_COURT_MEMBERS} seats are taken. Remove someone to seat another.</p>
          )}

          {/* ── Save + confirmation ── */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save my Front Row"}
            </button>
            {savedMessage && (
              <span className="inline-flex items-start gap-1.5 text-xs font-semibold text-emerald-300">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {savedMessage}
              </span>
            )}
            {saveError && (
              <span className="inline-flex items-center gap-2 text-xs font-semibold text-red-300">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {saveError}
                <button type="button" onClick={save} className="underline underline-offset-2 hover:text-red-200">
                  Retry
                </button>
              </span>
            )}
            {!savedMessage && !saveError && (
              <span className="text-xs text-white/35">Seats fill in the order you pick. Reorder with the arrows, then save.</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
