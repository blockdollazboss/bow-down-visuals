import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUp, CheckCircle2, Lightbulb, Loader2, Star, Wrench } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { usePageTitle } from "@/hooks/use-page-title";
import {
  FIX_PAGES,
  FIX_SEVERITIES,
  PITCH_CATEGORIES,
  sortPitches,
  type PitchFixSubmission,
  type PitchSort,
} from "@/lib/pitch-fix";

/* ─── Pitch & Fix (Stack-200 UPGRADES 196) ─────────────────────────────
   The approved Gate-1 preview (slug pitch-fix-preview) is the spec:
   two doors (Pitch an idea / Report a fix), two public boards with
   status chips, Top/Newest pitch sorting, upvotes, and a RECENTLY
   SHIPPED strip crediting the pitchers.

   MODERATION GATE: submissions land in the team review queue and only
   appear here after approval — the API board endpoint returns
   approved rows only, and the door success copy says exactly that.

   NO PRICES, NO REWARDS: nothing in this section charges, grants, or
   promises anything. It lives inside the site shell (AuthedLayout)
   in the Social/community flow — never a standalone page. */

interface BoardData {
  pitches: PitchFixSubmission[];
  fixes: PitchFixSubmission[];
  shipped: PitchFixSubmission[];
  viewerVotedIds: string[];
}

const CHIP_STYLES: Record<string, string> = {
  reviewing: "bg-sky-500/15 text-sky-300 border-sky-400/30",
  received: "bg-sky-500/15 text-sky-300 border-sky-400/30",
  approved: "bg-amber-500/15 text-amber-300 border-amber-400/30",
  confirmed: "bg-amber-500/15 text-amber-300 border-amber-400/30",
  building: "bg-[#d4a017]/15 text-[#fbbf24] border-[#d4a017]/40",
  fixing: "bg-[#d4a017]/15 text-[#fbbf24] border-[#d4a017]/40",
  shipped: "bg-emerald-500/15 text-emerald-300 border-emerald-400/30",
  fixed: "bg-emerald-500/15 text-emerald-300 border-emerald-400/30",
  pending: "bg-white/10 text-white/60 border-white/20",
  rejected: "bg-red-500/15 text-red-300 border-red-400/30",
  blocks_me: "bg-red-500/15 text-red-300 border-red-400/30",
  annoying: "bg-amber-500/15 text-amber-300 border-amber-400/30",
  small: "bg-white/10 text-white/60 border-white/20",
};

function Chip({ label, kind }: { label: string; kind: string }) {
  return (
    <span className={`inline-block rounded-full border px-2.5 py-0.5 text-[11px] font-extrabold tracking-wide ${CHIP_STYLES[kind] ?? CHIP_STYLES["small"]}`}>
      {label}
    </span>
  );
}

export default function PitchFixPage() {
  const { t } = useTranslation();
  const isLight = useIsLightTheme();
  const { user, getAccessToken } = useAuth();
  usePageTitle(t("pitchFix.title"));

  const [board, setBoard] = useState<BoardData | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [sort, setSort] = useState<PitchSort>("top");
  const [voted, setVoted] = useState<Set<string>>(new Set());
  const [mine, setMine] = useState<PitchFixSubmission[]>([]);

  // Pitch door state
  const [pTitle, setPTitle] = useState("");
  const [pWhat, setPWhat] = useState("");
  const [pWhy, setPWhy] = useState("");
  const [pCat, setPCat] = useState<string>("create");
  const [pName, setPName] = useState("");
  const [pNote, setPNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [pBusy, setPBusy] = useState(false);

  // Fix door state
  const [fTitle, setFTitle] = useState("");
  const [fPage, setFPage] = useState<string>("video_editor");
  const [fSev, setFSev] = useState<string>("annoying");
  const [fDetails, setFDetails] = useState("");
  const [fName, setFName] = useState("");
  const [fNote, setFNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [fBusy, setFBusy] = useState(false);

  const authHeaders = useCallback(async (): Promise<HeadersInit> => {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [getAccessToken]);

  const loadBoard = useCallback(async () => {
    try {
      const res = await fetch("/api/pitch-fix/board", { headers: await authHeaders() });
      if (!res.ok) throw new Error("board failed");
      const data = (await res.json()) as BoardData;
      setBoard(data);
      setVoted(new Set(data.viewerVotedIds ?? []));
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [authHeaders]);

  const loadMine = useCallback(async () => {
    if (!user) { setMine([]); return; }
    try {
      const res = await fetch("/api/pitch-fix/mine", { headers: await authHeaders() });
      if (!res.ok) return;
      const data = (await res.json()) as { submissions: PitchFixSubmission[] };
      setMine(data.submissions ?? []);
    } catch { /* mine is a nicety; the boards are the surface */ }
  }, [user, authHeaders]);

  useEffect(() => { void loadBoard(); void loadMine(); }, [loadBoard, loadMine]);

  async function submitPitch(e: React.FormEvent) {
    e.preventDefault();
    if (!user) { setPNote({ ok: false, text: t("pitchFix.signInToSubmit") }); return; }
    if (!pTitle.trim() || !pWhat.trim()) { setPNote({ ok: false, text: t("pitchFix.titleRequired") }); return; }
    setPBusy(true);
    try {
      const res = await fetch("/api/pitch-fix/pitches", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ title: pTitle, body: pWhat, why: pWhy || undefined, category: pCat, creator_name: pName || undefined }),
      });
      if (!res.ok) throw new Error("pitch failed");
      setPNote({ ok: true, text: t("pitchFix.pitchSent") });
      setPTitle(""); setPWhat(""); setPWhy("");
      void loadMine();
    } catch {
      setPNote({ ok: false, text: t("pitchFix.sendError") });
    } finally { setPBusy(false); }
  }

  async function submitFix(e: React.FormEvent) {
    e.preventDefault();
    if (!user) { setFNote({ ok: false, text: t("pitchFix.signInToSubmit") }); return; }
    if (!fTitle.trim()) { setFNote({ ok: false, text: t("pitchFix.fixRequired") }); return; }
    setFBusy(true);
    try {
      const res = await fetch("/api/pitch-fix/fixes", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ title: fTitle, body: fDetails || undefined, page: fPage, severity: fSev, creator_name: fName || undefined }),
      });
      if (!res.ok) throw new Error("fix failed");
      setFNote({ ok: true, text: t("pitchFix.fixSent") });
      setFTitle(""); setFDetails("");
      void loadMine();
    } catch {
      setFNote({ ok: false, text: t("pitchFix.sendError") });
    } finally { setFBusy(false); }
  }

  async function toggleVote(id: string) {
    if (!user) return;
    try {
      const res = await fetch(`/api/pitch-fix/${id}/vote`, { method: "POST", headers: await authHeaders() });
      if (!res.ok) return;
      const data = (await res.json()) as { voted: boolean; upvoteCount: number };
      setVoted((prev) => {
        const next = new Set(prev);
        if (data.voted) next.add(id); else next.delete(id);
        return next;
      });
      setBoard((b) => b ? { ...b, pitches: b.pitches.map((p) => (p.id === id ? { ...p, upvoteCount: data.upvoteCount } : p)) } : b);
    } catch { /* vote is best-effort UI; the count re-reads on reload */ }
  }

  const cardCls = isLight
    ? "rounded-2xl border border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F7EDD2] shadow-sm"
    : "rounded-2xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]";
  const inputCls = `w-full rounded-lg border px-3 py-2.5 text-sm font-medium outline-none focus:border-[#d4a017] ${isLight ? "border-[#C9A84C]/50 bg-white text-[#2A1E07]" : "border-white/15 bg-black/40 text-white"}`;
  const labelCls = `mb-1.5 block text-xs font-extrabold tracking-wide ${isLight ? "text-[#2A1E07]" : "text-white"}`;
  const subCls = isLight ? "text-sm leading-relaxed text-[#5c5138]" : "text-sm leading-relaxed text-white/55";
  const headCls = isLight ? "text-[#2A1E07]" : "text-white";

  const pitches = board ? sortPitches(board.pitches, sort) : [];
  const myPending = mine.filter((s) => s.moderationStatus === "pending");

  return (
    <div data-testid="pitch-fix-page">
      <header>
        <h1 className={`font-serif text-4xl font-bold md:text-5xl ${headCls}`}>
          {t("pitchFix.title")} <span className="text-[#d4a017]">&amp;</span> {t("pitchFix.titleFix")}
        </h1>
        <p className={`mt-2 max-w-2xl text-base ${subCls}`}>{t("pitchFix.subtitle")}</p>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs font-extrabold tracking-widest" aria-hidden="true">
          {[t("pitchFix.flow.pitch"), t("pitchFix.flow.review"), t("pitchFix.flow.build"), t("pitchFix.flow.shipped")].map((step, i, arr) => (
            <span key={step} className="flex items-center gap-2">
              <span className={`rounded-full border px-3 py-1 ${isLight ? "border-[#C9A84C]/50 bg-[#f1e8d0] text-[#5c5138]" : "border-white/15 bg-white/5 text-white/70"}`}>{step}</span>
              {i < arr.length - 1 && <span className="text-[#d4a017]">→</span>}
            </span>
          ))}
        </div>
      </header>

      {/* ── Two doors ─────────────────────────────────────────── */}
      <section className="mt-8 grid gap-5 lg:grid-cols-2">
        <form onSubmit={submitPitch} className={`${cardCls} p-6`} data-testid="pitch-door">
          <h2 className={`flex items-center gap-2 font-serif text-2xl font-bold ${headCls}`}><Lightbulb className="h-5 w-5 text-[#d4a017]" />{t("pitchFix.pitchDoor.title")}</h2>
          <p className={`mt-1 ${subCls}`}>{t("pitchFix.pitchDoor.sub")}</p>
          <div className="mt-4">
            <label className={labelCls} htmlFor="pf-pitch-title">{t("pitchFix.pitchDoor.titleLabel")}</label>
            <input id="pf-pitch-title" className={inputCls} maxLength={90} value={pTitle} onChange={(e) => setPTitle(e.target.value)} placeholder={t("pitchFix.pitchDoor.titlePlaceholder")} />
          </div>
          <div className="mt-3">
            <label className={labelCls} htmlFor="pf-pitch-what">{t("pitchFix.pitchDoor.whatLabel")}</label>
            <textarea id="pf-pitch-what" className={inputCls} maxLength={400} value={pWhat} onChange={(e) => setPWhat(e.target.value)} placeholder={t("pitchFix.pitchDoor.whatPlaceholder")} />
          </div>
          <div className="mt-3">
            <label className={labelCls} htmlFor="pf-pitch-why">{t("pitchFix.pitchDoor.whyLabel")}</label>
            <textarea id="pf-pitch-why" className={inputCls} maxLength={400} value={pWhy} onChange={(e) => setPWhy(e.target.value)} placeholder={t("pitchFix.pitchDoor.whyPlaceholder")} />
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor="pf-pitch-cat">{t("pitchFix.pitchDoor.categoryLabel")}</label>
              <select id="pf-pitch-cat" className={inputCls} value={pCat} onChange={(e) => setPCat(e.target.value)}>
                {PITCH_CATEGORIES.map((c) => <option key={c} value={c}>{t(`pitchFix.category.${c}`)}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls} htmlFor="pf-pitch-name">{t("pitchFix.nameLabel")}</label>
              <input id="pf-pitch-name" className={inputCls} maxLength={40} value={pName} onChange={(e) => setPName(e.target.value)} placeholder={t("pitchFix.namePlaceholder")} />
            </div>
          </div>
          <button type="submit" disabled={pBusy} className="mt-4 w-full rounded-xl bg-[#d4a017] px-4 py-3 text-sm font-extrabold text-[#171408] transition hover:bg-[#eccd6d] disabled:opacity-60">
            {pBusy ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : t("pitchFix.pitchDoor.submit")}
          </button>
          {pNote && <p role="status" className={`mt-2 text-sm font-bold ${pNote.ok ? "text-emerald-500" : "text-red-400"}`}>{pNote.text}</p>}
        </form>

        <form onSubmit={submitFix} className={`${cardCls} p-6`} data-testid="fix-door">
          <h2 className={`flex items-center gap-2 font-serif text-2xl font-bold ${headCls}`}><Wrench className="h-5 w-5 text-[#d4a017]" />{t("pitchFix.fixDoor.title")}</h2>
          <p className={`mt-1 ${subCls}`}>{t("pitchFix.fixDoor.sub")}</p>
          <div className="mt-4">
            <label className={labelCls} htmlFor="pf-fix-what">{t("pitchFix.fixDoor.whatLabel")}</label>
            <input id="pf-fix-what" className={inputCls} maxLength={90} value={fTitle} onChange={(e) => setFTitle(e.target.value)} placeholder={t("pitchFix.fixDoor.whatPlaceholder")} />
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor="pf-fix-where">{t("pitchFix.fixDoor.whereLabel")}</label>
              <select id="pf-fix-where" className={inputCls} value={fPage} onChange={(e) => setFPage(e.target.value)}>
                {FIX_PAGES.map((p) => <option key={p} value={p}>{t(`pitchFix.page.${p}`)}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls} htmlFor="pf-fix-sev">{t("pitchFix.fixDoor.severityLabel")}</label>
              <select id="pf-fix-sev" className={inputCls} value={fSev} onChange={(e) => setFSev(e.target.value)}>
                {FIX_SEVERITIES.map((s) => <option key={s} value={s}>{t(`pitchFix.severity.${s}`)}</option>)}
              </select>
            </div>
          </div>
          <div className="mt-3">
            <label className={labelCls} htmlFor="pf-fix-details">{t("pitchFix.fixDoor.detailsLabel")}</label>
            <textarea id="pf-fix-details" className={inputCls} maxLength={400} value={fDetails} onChange={(e) => setFDetails(e.target.value)} placeholder={t("pitchFix.fixDoor.detailsPlaceholder")} />
          </div>
          <div className="mt-3">
            <label className={labelCls} htmlFor="pf-fix-name">{t("pitchFix.nameLabel")}</label>
            <input id="pf-fix-name" className={inputCls} maxLength={40} value={fName} onChange={(e) => setFName(e.target.value)} placeholder={t("pitchFix.namePlaceholder")} />
          </div>
          <button type="submit" disabled={fBusy} className={`mt-4 w-full rounded-xl border px-4 py-3 text-sm font-extrabold transition disabled:opacity-60 ${isLight ? "border-[#C9A84C]/60 text-[#2A1E07] hover:border-[#d4a017]" : "border-white/25 text-white hover:border-[#d4a017]"}`}>
            {fBusy ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : t("pitchFix.fixDoor.submit")}
          </button>
          {fNote && <p role="status" className={`mt-2 text-sm font-bold ${fNote.ok ? "text-emerald-500" : "text-red-400"}`}>{fNote.text}</p>}
        </form>
      </section>

      {myPending.length > 0 && (
        <section className={`mt-5 ${cardCls} p-4`} data-testid="pitch-fix-mine">
          <p className={`text-sm font-bold ${headCls}`}>{t("pitchFix.mineTitle")}</p>
          <ul className={`mt-1 text-sm ${subCls}`}>
            {myPending.map((s) => (
              <li key={s.id} className="mt-1 flex flex-wrap items-center gap-2">
                <span>{s.kind === "feedback" ? (s.title || t("pitchFix.feedbackRow", { rating: s.rating ?? 0 })) : s.title}</span>
                <Chip label={t("pitchFix.moderation.pending")} kind="pending" />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Boards ────────────────────────────────────────────── */}
      {loadError ? (
        <div className={`mt-8 ${cardCls} p-5`}>
          <p className={`font-bold ${headCls}`}>{t("pitchFix.loadError")}</p>
          <button type="button" onClick={() => void loadBoard()} className="mt-2 rounded-lg border border-[#d4a017]/50 px-3 py-1.5 text-xs font-bold text-[#d4a017]">{t("pitchFix.retry")}</button>
        </div>
      ) : !board ? (
        <p className="mt-10 flex items-center gap-2 text-sm text-white/40"><Loader2 className="h-4 w-4 animate-spin" />{t("pitchFix.loading")}</p>
      ) : (
        <section className="mt-10 grid items-start gap-6 lg:grid-cols-2">
          <div data-testid="pitch-board">
            <div className="flex items-baseline gap-3">
              <h2 className={`font-serif text-2xl font-bold ${headCls}`}>{t("pitchFix.pitchBoard")}</h2>
              <span className={`text-sm font-bold ${subCls}`}>{t("pitchFix.pitchesCount", { count: board.pitches.length })}</span>
            </div>
            <div className="mt-3 flex gap-2" role="group" aria-label={t("pitchFix.pitchBoard")}>
              {(["top", "newest"] as PitchSort[]).map((s) => (
                <button key={s} type="button" onClick={() => setSort(s)} className={`rounded-full border px-3.5 py-1.5 text-xs font-extrabold ${sort === s ? (isLight ? "bg-[#2A1E07] text-[#f6f1e6] border-[#2A1E07]" : "bg-white text-black border-white") : (isLight ? "border-[#C9A84C]/60 text-[#5c5138]" : "border-white/20 text-white/60")}`}>
                  {t(s === "top" ? "pitchFix.sortTop" : "pitchFix.sortNewest")}
                </button>
              ))}
            </div>
            <div className="mt-4">
              {pitches.length === 0 && <p className={subCls}>{t("pitchFix.emptyPitches")}</p>}
              {pitches.map((p) => (
                <article key={p.id} className={`${cardCls} mb-3 p-4`}>
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <h3 className={`font-bold ${headCls}`}>{p.title}</h3>
                      <p className={subCls}>{p.body}</p>
                      {p.why && <p className={`${subCls} mt-1`}><em>{t("pitchFix.whyMatters")}:</em> {p.why}</p>}
                      <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs font-bold">
                        <Chip label={t(`pitchFix.pitchStatus.${p.status}`, { defaultValue: p.status })} kind={p.status} />
                        <span className="text-[#d4a017]">{t(`pitchFix.category.${p.category ?? "other"}`, { defaultValue: p.category ?? "" })}</span>
                        <span className={subCls}>{t("pitchFix.by", { name: p.submitterName })}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void toggleVote(p.id)}
                      aria-pressed={voted.has(p.id)}
                      aria-label={t("pitchFix.upvote", { title: p.title })}
                      className={`flex min-w-[58px] flex-col items-center rounded-xl border px-2.5 py-1.5 ${voted.has(p.id) ? "border-[#d4a017] bg-[#d4a017] text-[#171408]" : (isLight ? "border-[#C9A84C]/60 text-[#2A1E07]" : "border-white/20 text-white")}`}
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                      <span className="text-base font-extrabold leading-tight">{p.upvoteCount}</span>
                      <span className="text-[9px] font-extrabold tracking-widest">{t("pitchFix.votes")}</span>
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div data-testid="fix-board">
            <div className="flex items-baseline gap-3">
              <h2 className={`font-serif text-2xl font-bold ${headCls}`}>{t("pitchFix.fixBoard")}</h2>
              <span className={`text-sm font-bold ${subCls}`}>{t("pitchFix.reportsCount", { count: board.fixes.length })}</span>
            </div>
            <div className="mt-4">
              {board.fixes.length === 0 && <p className={subCls}>{t("pitchFix.emptyFixes")}</p>}
              {board.fixes.map((f) => (
                <article key={f.id} className={`${cardCls} mb-3 p-4`}>
                  <h3 className={`font-bold ${headCls}`}>
                    {f.kind === "feedback" ? (f.title || t("pitchFix.feedbackRow", { rating: f.rating ?? 0 })) : f.title}
                  </h3>
                  {f.kind === "feedback" && f.rating != null && (
                    <p className="mt-1 flex gap-0.5" aria-label={t("pitchFix.feedbackRow", { rating: f.rating })}>
                      {[1, 2, 3, 4, 5].map((n) => <Star key={n} className={`h-4 w-4 ${n <= (f.rating ?? 0) ? "fill-[#d4a017] text-[#d4a017]" : "text-white/25"}`} />)}
                    </p>
                  )}
                  {f.body && <p className={subCls}>{f.body}</p>}
                  <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs font-bold">
                    <Chip label={t(`pitchFix.fixStatus.${f.status}`, { defaultValue: f.status })} kind={f.status} />
                    {f.severity && <Chip label={t(`pitchFix.severity.${f.severity}`, { defaultValue: f.severity })} kind={f.severity} />}
                    {f.page && <span className={subCls}>{t("pitchFix.reportedIn", { page: t(`pitchFix.page.${f.page}`, { defaultValue: f.page }) })}</span>}
                    <span className={subCls}>{t("pitchFix.by", { name: f.submitterName })}</span>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Recently shipped ──────────────────────────────────── */}
      {board && board.shipped.length > 0 && (
        <section className="mt-10" data-testid="pitch-fix-shipped">
          <h2 className={`font-serif text-2xl font-bold ${headCls}`}>{t("pitchFix.shipped.title")}</h2>
          <p className={`mt-1 ${subCls}`}>{t("pitchFix.shipped.sub")}</p>
          <div className="mt-4 grid gap-3.5 md:grid-cols-3">
            {board.shipped.map((s) => (
              <div key={s.id} className={`${cardCls} p-4`}>
                <p className={`font-bold ${headCls}`}>{s.kind === "feedback" ? (s.title || t("pitchFix.feedbackRow", { rating: s.rating ?? 0 })) : s.title}</p>
                <p className={`mt-1.5 text-sm ${subCls}`}>
                  {s.kind === "pitch"
                    ? <>{t("pitchFix.shipped.ideaBy")} <b className="text-[#d4a017]">{s.submitterName}</b> — {t("pitchFix.shipped.shippedWord")}</>
                    : <>{t("pitchFix.shipped.fixBy")} <b className="text-[#d4a017]">{s.submitterName}</b> — {t("pitchFix.shipped.fixedWord")}</>}
                </p>
                <p className={`mt-0.5 text-xs ${subCls}`}>
                  {s.kind === "pitch" ? `${t("pitchFix.pitchBoard")} · ${t(`pitchFix.category.${s.category ?? "other"}`, { defaultValue: "" })}` : `${t("pitchFix.fixBoard")} · ${s.page ? t(`pitchFix.page.${s.page}`, { defaultValue: "" }) : ""}`}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Team note ─────────────────────────────────────────── */}
      <section className={`mt-10 flex items-start gap-4 ${cardCls} p-5`}>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-[#d4a017] font-serif text-lg font-bold text-[#d4a017]">B</span>
        <div>
          <h3 className={`flex items-center gap-2 font-serif text-lg font-bold ${headCls}`}><CheckCircle2 className="h-4 w-4 text-[#d4a017]" />{t("pitchFix.note.title")}</h3>
          <p className={`mt-1 max-w-3xl ${subCls}`}>{t("pitchFix.note.body")}</p>
        </div>
      </section>
    </div>
  );
}
