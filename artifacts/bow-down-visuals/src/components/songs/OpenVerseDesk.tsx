import { useCallback, useEffect, useMemo, useState } from "react";
import { Crown, Loader2, Mic2, RefreshCw, Send, Trophy, Undo2, XCircle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";

/* ─── Open Verse desk (#176) ─────────────────────────────────────────────
   Docked inside the song's own surfaces — Songs (CREATE) and Contests
   (PROMOTE) — never a standalone page. A creator posts one of their
   songs with an open verse slot; other creators submit verses in-app;
   the song's creator picks the winner onto the track.

   SPLIT TERMS UP FRONT: the terms ride the existing publishing-splits
   rail, are set by the song's creator at post time, and are shown on
   every post BEFORE anyone submits — the money step is stated at the
   door. Picking a winner records the split exactly once.
   Money: TEST MODE, Visual Bucs only, never cash; posting and
   submitting are free. Nothing is picked or posted automatically —
   only the song's creator picks the winner. */

export interface OpenVerseSplitTerm {
  name: string;
  role: "creator" | "winner";
  sharePct: number;
}

export interface OpenVersePostDto {
  id: string;
  song_kind: "release" | "song";
  song_id: string;
  song_title: string;
  brief: string;
  slot_label: string;
  split_terms: OpenVerseSplitTerm[];
  winner_share_pct: number;
  currency: string;
  money_note: string;
  terms_note: string;
  status: "open" | "closed" | "winner_picked" | "cancelled";
  state: string;
  closes_at: string | null;
  is_owner: boolean;
  submission_count: number | null;
  my_submission_id: string | null;
  my_submission_status: string | null;
  winner_submission_id: string | null;
  is_winner: boolean;
  viewer_actions: string[];
}

interface OpenVerseSubmissionDto {
  id: string;
  post_id: string;
  submitter_name: string;
  is_mine: boolean;
  audio_url: string;
  lyrics: string | null;
  note: string | null;
  status: string;
  created_at: string | null;
}

interface MySong {
  id: string;
  title: string;
  audio_url: string;
}

const MONEY_NOTE =
  "Test mode — splits are percentages of this track's future Visual Bucs earnings. Visual Bucs only, never cash, and submitting a verse is free.";
const TERMS_NOTE =
  "Split terms are set by the song's creator before any verse is submitted and never change after a winner is picked.";

export function splitPreview(winnerSharePct: number): OpenVerseSplitTerm[] {
  const winner = Number.isFinite(winnerSharePct) ? winnerSharePct : 0;
  const creator = Math.round((100 - winner) * 100) / 100;
  return [
    { name: "Song creator", role: "creator", sharePct: creator },
    { name: "Winning verse creator", role: "winner", sharePct: winner },
  ];
}

export function postStateLabel(post: OpenVersePostDto): string {
  if (post.status === "winner_picked") return "Winner picked — verse on the track";
  if (post.status === "cancelled") return "Cancelled";
  if (post.state === "closed_time" || post.status === "closed") return "Submissions closed — awaiting the creator's pick";
  return "Taking verses now";
}

function SplitTermsBlock({ terms }: { terms: OpenVerseSplitTerm[] }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/30 px-3 py-2" data-testid="open-verse-split-terms">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-white/40">Split terms — set up front</p>
      <div className="mt-1 space-y-0.5">
        {terms.map((t) => (
          <p key={t.role} className="flex items-center justify-between text-sm">
            <span className="text-white/70">{t.name}</span>
            <span className="font-bold text-amber-200">{t.sharePct}%</span>
          </p>
        ))}
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-white/40">{TERMS_NOTE}</p>
    </div>
  );
}

export default function OpenVerseDesk() {
  const isLight = useIsLightTheme();
  const { user, getAccessToken } = useAuth();
  const [posts, setPosts] = useState<OpenVersePostDto[]>([]);
  const [ready, setReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [mySongs, setMySongs] = useState<MySong[]>([]);
  const [songId, setSongId] = useState("");
  const [winnerShare, setWinnerShare] = useState("25");
  const [brief, setBrief] = useState("");
  const [slotLabel, setSlotLabel] = useState("");
  const [closesAt, setClosesAt] = useState("");

  const [detailId, setDetailId] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<OpenVerseSubmissionDto[]>([]);
  const [ledger, setLedger] = useState<{ winner_share_pct: number; idempotency_key: string } | null>(null);

  const [audioUrl, setAudioUrl] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [note, setNote] = useState("");

  const cardCls = isLight
    ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]"
    : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]";
  const inputCls =
    "w-full rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:border-white/25";

  const authHeaders = useCallback(async () => {
    const token = await getAccessToken();
    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }, [getAccessToken]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const headers = await authHeaders();
      const [openRes, mineRes, songsRes] = await Promise.all([
        fetch("/api/open-verse/open", { headers }),
        fetch("/api/open-verse/mine", { headers }),
        fetch("/api/songs", { headers }),
      ]);
      const openBody = (await openRes.json().catch(() => ({}))) as { posts?: OpenVersePostDto[]; open_verse_ready?: boolean };
      const mineBody = (await mineRes.json().catch(() => ({}))) as { posts?: OpenVersePostDto[]; open_verse_ready?: boolean };
      const byId = new Map<string, OpenVersePostDto>();
      for (const p of openBody.posts ?? []) byId.set(p.id, p);
      for (const p of mineBody.posts ?? []) byId.set(p.id, { ...(byId.get(p.id) ?? {}), ...p } as OpenVersePostDto);
      setPosts([...byId.values()]);
      setReady((openBody.open_verse_ready ?? true) && (mineBody.open_verse_ready ?? true));
      const songsBody = (await songsRes.json().catch(() => ({}))) as { songs?: MySong[] } | MySong[];
      const list = Array.isArray(songsBody) ? songsBody : (songsBody.songs ?? []);
      setMySongs(list);
      setSongId((cur) => cur || list[0]?.id || "");
    } catch {
      setError("Couldn't load open verses — try again.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    if (user) void load();
    else setLoading(false);
  }, [user, load]);

  const previewTerms = useMemo(() => splitPreview(Number(winnerShare)), [winnerShare]);

  async function call(path: string, body?: unknown): Promise<Record<string, unknown>> {
    const res = await fetch(path, {
      method: "POST",
      headers: await authHeaders(),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error((data.message as string) || (data.error as string) || "That didn't go through — try again.");
    }
    return data;
  }

  async function createPost() {
    if (!songId) return setError("Pick one of your songs first.");
    setBusy("create");
    setError(null);
    try {
      await call("/api/open-verse", {
        song_kind: "song",
        song_id: songId,
        brief,
        slot_label: slotLabel,
        winner_share_pct: Number(winnerShare),
        closes_at: closesAt ? new Date(closesAt).toISOString() : null,
      });
      setBrief("");
      setSlotLabel("");
      setClosesAt("");
      setNotice("Your open verse is live — the split terms above are the terms, in writing, before anyone records a note.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't post the open verse.");
    } finally {
      setBusy(null);
    }
  }

  async function loadDetail(postId: string) {
    try {
      const res = await fetch(`/api/open-verse/${postId}`, { headers: await authHeaders() });
      const body = (await res.json().catch(() => ({}))) as {
        submissions?: OpenVerseSubmissionDto[];
        split_ledger?: { winner_share_pct: number; idempotency_key: string } | null;
      };
      setSubmissions(body.submissions ?? []);
      setLedger(body.split_ledger ?? null);
    } catch {
      setError("Couldn't load the verses for that post.");
    }
  }

  async function openDetail(post: OpenVersePostDto) {
    if (detailId === post.id) {
      setDetailId(null);
      return;
    }
    setDetailId(post.id);
    setSubmissions([]);
    setLedger(null);
    await loadDetail(post.id);
  }

  async function submitVerse(post: OpenVersePostDto) {
    setBusy(`submit-${post.id}`);
    setError(null);
    try {
      await call(`/api/open-verse/${post.id}/submit`, { audio_url: audioUrl, lyrics: lyrics || null, note: note || null });
      setAudioUrl("");
      setLyrics("");
      setNote("");
      setNotice(`Verse submitted to “${post.song_title}”. The split you saw — ${post.winner_share_pct}% to the winning verse — is the split in writing.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't submit your verse.");
    } finally {
      setBusy(null);
    }
  }

  async function ownerAction(post: OpenVersePostDto, action: "close" | "cancel" | "withdraw" | "pick", submissionId?: string) {
    setBusy(`${action}-${post.id}`);
    setError(null);
    try {
      if (action === "withdraw") await call(`/api/open-verse/${post.id}/withdraw`);
      else if (action === "close") await call(`/api/open-verse/${post.id}/close`);
      else if (action === "cancel") await call(`/api/open-verse/${post.id}/cancel`);
      if (action === "pick" && submissionId) {
        const data = await call(`/api/open-verse/${post.id}/pick-winner`, { submission_id: submissionId });
        setLedger((data.split_ledger as { winner_share_pct: number; idempotency_key: string }) ?? null);
        setNotice("Winner picked — the verse is on the track and the split is recorded exactly once.");
      }
      await load();
      if (detailId === post.id) void loadDetail(post.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That action didn't go through.");
    } finally {
      setBusy(null);
    }
  }

  if (!user) return null;

  return (
    <section aria-label="Open Verse" className={`rounded-2xl border p-5 ${cardCls}`} data-testid="open-verse-desk">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-black">
            <Mic2 className="h-5 w-5 text-primary" /> Open Verse
          </h2>
          <p className="mt-1 text-sm text-white/55">
            Post a song with an open verse slot, hear verses from other creators, and pick the winner onto the track.
            The splits are the money step — stated here, up front, before anyone records a note.
          </p>
          <p className="mt-1 text-xs text-white/40">{MONEY_NOTE}</p>
        </div>
        <button
          onClick={() => void load()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/60 hover:text-white"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      {!ready && (
        <p className="mt-4 rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white/60">
          Open Verse isn't switched on yet — your songs are safe, and posting an open verse opens as soon as the Open Verse storage lands.
        </p>
      )}
      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
      {notice && <p className="mt-4 text-sm text-emerald-300">{notice}</p>}

      {/* Post my song with an open verse slot */}
      <div className="mt-5 rounded-xl border border-white/10 bg-black/20 p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-white/40">Post your song with an open verse</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs text-white/50">Your song</span>
            <select value={songId} onChange={(e) => setSongId(e.target.value)} className={inputCls} aria-label="Your song">
              {mySongs.length === 0 && <option value="">No songs yet — make or upload one first</option>}
              {mySongs.map((s) => (
                <option key={s.id} value={s.id}>{s.title}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-white/50">Winning verse's share (%)</span>
            <input
              type="number" min={1} max={99} step="0.01" value={winnerShare}
              onChange={(e) => setWinnerShare(e.target.value)} className={inputCls} aria-label="Winning verse share percent"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-white/50">Slot label</span>
            <input value={slotLabel} onChange={(e) => setSlotLabel(e.target.value)} placeholder="Open verse" className={inputCls} aria-label="Slot label" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-white/50">Submissions close (optional)</span>
            <input type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} className={inputCls} aria-label="Submissions close at" />
          </label>
        </div>
        <label className="mt-3 block">
          <span className="mb-1 block text-xs text-white/50">Brief for verse creators</span>
          <textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={2} placeholder="What should the verse do? Bars, feel, topic…" className={inputCls} aria-label="Brief" />
        </label>
        <div className="mt-3">
          <SplitTermsBlock terms={previewTerms} />
        </div>
        <button
          onClick={() => void createPost()}
          disabled={busy === "create" || !ready}
          className="mt-3 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-black hover:brightness-110 disabled:opacity-50"
        >
          {busy === "create" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic2 className="h-4 w-4" />}
          Post the open verse
        </button>
      </div>

      {/* Open posts */}
      <div className="mt-5 space-y-3">
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-white/40" /></div>
        ) : posts.length === 0 ? (
          <p className="py-6 text-center text-sm text-white/40">No open verses yet — post yours above, or check back when a creator opens a slot.</p>
        ) : (
          posts.map((post) => (
            <article key={post.id} className="rounded-xl border border-white/10 bg-black/20 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-bold">
                  {post.song_title} <span className="ml-1 rounded-full border border-amber-400/30 px-2 py-0.5 text-[11px] font-semibold text-amber-200">{post.slot_label}</span>
                </p>
                <p className="text-xs text-white/45">{postStateLabel(post)}</p>
              </div>
              {post.brief && <p className="mt-1 text-sm text-white/60">{post.brief}</p>}
              <p className="mt-1 text-xs text-white/40">
                {post.submission_count ?? 0} verse{(post.submission_count ?? 0) === 1 ? "" : "s"} in
                {post.closes_at ? ` · closes ${new Date(post.closes_at).toLocaleString()}` : ""}
                {post.is_winner ? " · your verse won this one" : ""}
              </p>
              <div className="mt-3">
                <SplitTermsBlock terms={post.split_terms} />
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => void openDetail(post)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/70 hover:text-white"
                >
                  <Trophy className="h-3.5 w-3.5" /> {detailId === post.id ? "Hide verses" : "View verses"}
                </button>
                {post.viewer_actions.includes("close") && (
                  <button onClick={() => void ownerAction(post, "close")} disabled={busy === `close-${post.id}`} className="rounded-full border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/70 hover:text-white disabled:opacity-50">
                    Close submissions
                  </button>
                )}
                {post.viewer_actions.includes("cancel") && (
                  <button onClick={() => void ownerAction(post, "cancel")} disabled={busy === `cancel-${post.id}`} className="inline-flex items-center gap-1 rounded-full border border-red-400/30 px-3 py-1.5 text-xs font-semibold text-red-300 hover:text-red-200 disabled:opacity-50">
                    <XCircle className="h-3.5 w-3.5" /> Cancel post
                  </button>
                )}
                {post.viewer_actions.includes("withdraw") && (
                  <button onClick={() => void ownerAction(post, "withdraw")} disabled={busy === `withdraw-${post.id}`} className="inline-flex items-center gap-1 rounded-full border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/70 hover:text-white disabled:opacity-50">
                    <Undo2 className="h-3.5 w-3.5" /> Withdraw my verse
                  </button>
                )}
              </div>

              {post.my_submission_status && post.my_submission_status !== "withdrawn" && (
                <p className="mt-2 text-xs text-white/50">Your verse: {post.my_submission_status === "winner" ? "picked — it's on the track" : post.my_submission_status}.</p>
              )}

              {/* Submit a verse — terms above are shown BEFORE this form. */}
              {post.viewer_actions.includes("submit") && (
                <div className="mt-3 rounded-lg border border-white/10 bg-black/30 p-3">
                  <p className="text-xs font-semibold text-white/60">Submit your verse — the split above is the split you agree to.</p>
                  <div className="mt-2 grid gap-2">
                    <select value={audioUrl} onChange={(e) => setAudioUrl(e.target.value)} className={inputCls} aria-label="Verse audio from my songs">
                      <option value="">Use one of my songs as the verse audio…</option>
                      {mySongs.filter((s) => s.audio_url).map((s) => (
                        <option key={s.id} value={s.audio_url}>{s.title}</option>
                      ))}
                    </select>
                    <input value={audioUrl} onChange={(e) => setAudioUrl(e.target.value)} placeholder="…or paste the verse audio link" className={inputCls} aria-label="Verse audio link" />
                    <textarea value={lyrics} onChange={(e) => setLyrics(e.target.value)} rows={2} placeholder="Lyrics (optional)" className={inputCls} aria-label="Verse lyrics" />
                    <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note to the song's creator (optional)" className={inputCls} aria-label="Note to creator" />
                  </div>
                  <button
                    onClick={() => void submitVerse(post)}
                    disabled={busy === `submit-${post.id}` || !audioUrl}
                    className="mt-2 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-black hover:brightness-110 disabled:opacity-50"
                  >
                    {busy === `submit-${post.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    Submit verse — free
                  </button>
                </div>
              )}

              {detailId === post.id && (
                <div className="mt-3 space-y-2">
                  {ledger && (
                    <p className="rounded-lg border border-emerald-400/25 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-200">
                      Split recorded exactly once — winning verse {ledger.winner_share_pct}% (Visual Bucs, test mode). Ledger key {ledger.idempotency_key}.
                    </p>
                  )}
                  {submissions.length === 0 ? (
                    <p className="text-xs text-white/40">No verses you can see on this post yet.</p>
                  ) : (
                    submissions.map((s) => (
                      <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/30 px-3 py-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold">
                            {s.submitter_name} {s.status === "winner" && <Crown className="inline h-4 w-4 text-amber-300" />}
                            <span className="ml-2 text-xs font-normal text-white/40">{s.status}</span>
                          </p>
                          {s.note && <p className="truncate text-xs text-white/50">{s.note}</p>}
                          {s.audio_url && (
                            <a href={s.audio_url} target="_blank" rel="noreferrer" className="text-xs text-amber-200 underline">Listen to the verse</a>
                          )}
                        </div>
                        {post.is_owner && post.viewer_actions.includes("pick_winner") && s.status === "submitted" && (
                          <button
                            onClick={() => void ownerAction(post, "pick", s.id)}
                            disabled={busy === `pick-${post.id}`}
                            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-bold text-black hover:brightness-110 disabled:opacity-50"
                          >
                            <Crown className="h-3.5 w-3.5" /> Pick as winner
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </article>
          ))
        )}
      </div>
    </section>
  );
}
