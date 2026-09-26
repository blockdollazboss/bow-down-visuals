import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  Scale, Sparkles, Loader2, FileText, MessageCircleQuestion, CheckCircle2,
  Copy, Plus, Trash2, ShieldCheck, Clock3, BadgeDollarSign, ArrowRight,
  ChevronDown, AlertTriangle, ListChecks,
} from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import { usePageTitle } from "@/hooks/use-page-title";

/* ─── Copyright Filing Assistant ────────────────────────────────────────────
   AI-powered guided page for U.S. copyright registration prep (music creators).

   The form is FREE UI. The AI layer is core and prominent:
   - "Generate filing draft" → POST /api/copyright/draft (1 credit) — formal
     description of work + filing notes (application choice, deposit, authorship).
   - "Ask about copyright" Q&A box → POST /api/copyright/ask (1 credit/answer).
   We prepare everything; the creator files at copyright.gov themselves (v1).
   Registrations are tracked in localStorage (v1 persistence).
   NOT legal advice — disclaimer is shown in multiple places. */

const DRAFT_CREDIT_COST = 1;
const ASK_CREDIT_COST = 1;

type WorkType = "song" | "sound-recording" | "lyrics" | "music-video" | "album";

const WORK_TYPE_OPTS: { key: WorkType; label: string; hint: string }[] = [
  { key: "song", label: "Song", hint: "Melody + lyrics (the composition)" },
  { key: "sound-recording", label: "Sound recording", hint: "The recorded track / master" },
  { key: "lyrics", label: "Lyrics", hint: "Words only, no melody claimed" },
  { key: "music-video", label: "Music video", hint: "The audiovisual work" },
  { key: "album", label: "Album / EP", hint: "Group of works released together" },
];

interface DraftResult {
  description: string;
  filingNotes: string[];
}

interface QaMessage {
  role: "user" | "assistant";
  content: string;
}

type RegStatus = "draft" | "prepared" | "filed";
interface Registration {
  id: string;
  title: string;
  workType: string;
  status: RegStatus;
  createdAt: string;
}

const TRACKER_KEY = "bdv-copyright-registrations";

const FAQ: { q: string; a: string }[] = [
  {
    q: "How much does registration cost?",
    a: "Filing online at copyright.gov: $65 for the Standard Application (one work, or a group of works sharing the same author, owner, and release date) or $45 for the Single Application (one work, one author who is also the sole claimant). Fees change — confirm at copyright.gov before you file.",
  },
  {
    q: "How long does it take?",
    a: "Standard processing typically runs 1–4 months. If you need it faster (for example, an infringement deadline), Special Handling expedites to about 5 business days but costs roughly $800+ extra.",
  },
  {
    q: "What if someone steals my work?",
    a: "You own the copyright the moment you create the work — registration doesn't create the right. But you generally can't sue in federal court until the Copyright Office acts on your application, and registering BEFORE the infringement happens preserves your eligibility for statutory damages and attorney's fees. Register early.",
  },
  {
    q: "Single vs. group registration — which do I pick?",
    a: "One song or one video by one author: the $45 Single Application. An album or EP from the same author/owner released together: one $65 Standard Application can cover the group. The AI filing draft above recommends the right one for your facts.",
  },
  {
    q: "Can I register AI-assisted music?",
    a: "Only human authorship is registrable. For AI-assisted works, the Copyright Office requires you to disclaim the AI-generated portions (March 2023 guidance) — an AI system cannot be listed as an author. Describe what YOU created in the application.",
  },
];

const DISCLAIMER =
  "Bow Down Visuals is not a law firm and this page is not legal advice. Copyright law has edge cases — for disputes, transfers, or anything high-stakes, consult an intellectual property attorney.";

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

const labelClass = "mb-1.5 block text-xs font-bold uppercase tracking-widest text-white/50";

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function CopyrightAssistant() {
  usePageTitle("Copyright Assistant", "Protect your music — guided copyright registration help for creators.");
  const { user, getAccessToken, refreshProfile } = useAuth();

  /* ── free guided form ── */
  const [workType, setWorkType] = useState<WorkType>("song");
  const [title, setTitle] = useState("");
  const [authors, setAuthors] = useState("");
  const [creationDate, setCreationDate] = useState("");
  const [published, setPublished] = useState(false);
  const [publishedDate, setPublishedDate] = useState("");
  const [notes, setNotes] = useState("");

  /* ── AI draft state ── */
  const [draft, setDraft] = useState<DraftResult | null>(null);
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftOutOfCredits, setDraftOutOfCredits] = useState(false);

  /* ── AI Q&A state ── */
  const [qaMessages, setQaMessages] = useState<QaMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [qaLoading, setQaLoading] = useState(false);
  const [qaError, setQaError] = useState<string | null>(null);
  const [qaOutOfCredits, setQaOutOfCredits] = useState(false);

  /* ── tracker (localStorage v1) ── */
  const [regs, setRegs] = useState<Registration[]>([]);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(TRACKER_KEY);
      if (raw) setRegs(JSON.parse(raw) as Registration[]);
    } catch {
      /* corrupted storage — start fresh */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(TRACKER_KEY, JSON.stringify(regs));
    } catch {
      /* storage full/blocked — tracker just won't persist */
    }
  }, [regs]);

  async function authedFetch(path: string, body: unknown) {
    const token = await getAccessToken();
    const res = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { res, data };
  }

  async function generateDraft() {
    if (draftLoading || !user) return;
    if (!title.trim()) {
      setDraftError("Give the work a title first — that's what the draft is built on.");
      return;
    }
    setDraftLoading(true);
    setDraftError(null);
    setDraftOutOfCredits(false);
    try {
      const { res, data } = await authedFetch("/api/copyright/draft", {
        workType,
        title: title.trim(),
        authors: authors.trim(),
        creationDate: creationDate.trim(),
        published,
        publishedDate: publishedDate.trim(),
        notes: notes.trim(),
      });
      if (res.status === 402) {
        setDraftOutOfCredits(true);
        return;
      }
      if (!res.ok) {
        throw new Error((data.error as string) || "Draft failed — try again.");
      }
      setDraft({
        description: data.description as string,
        filingNotes: (data.filingNotes as string[]) ?? [],
      });
      refreshProfile().catch(() => {});
      document.getElementById("draft-result")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : "Draft failed — try again.");
    } finally {
      setDraftLoading(false);
    }
  }

  async function askQuestion() {
    if (qaLoading || !user || !question.trim()) return;
    const q = question.trim().slice(0, 1000);
    setQuestion("");
    setQaLoading(true);
    setQaError(null);
    setQaOutOfCredits(false);
    const nextMessages: QaMessage[] = [...qaMessages, { role: "user", content: q }];
    setQaMessages(nextMessages);
    try {
      const { res, data } = await authedFetch("/api/copyright/ask", {
        question: q,
        history: nextMessages.slice(-6).map((m) => ({ role: m.role, content: m.content })),
      });
      if (res.status === 402) {
        setQaOutOfCredits(true);
        setQaMessages(nextMessages);
        return;
      }
      if (!res.ok) {
        throw new Error((data.error as string) || "Couldn't get an answer — try again.");
      }
      setQaMessages([...nextMessages, { role: "assistant", content: data.answer as string }]);
      refreshProfile().catch(() => {});
    } catch (err) {
      setQaError(err instanceof Error ? err.message : "Couldn't get an answer — try again.");
      setQaMessages(nextMessages);
    } finally {
      setQaLoading(false);
    }
  }

  const checklist = useMemo(() => {
    const typeLabel = WORK_TYPE_OPTS.find((o) => o.key === workType)?.label ?? workType;
    const steps: string[] = [
      `Go to copyright.gov/eco and start a new claim for "${title.trim() || "(your title)"}" (${typeLabel}).`,
      `Application type: ${draft ? "see the AI filing notes above for the recommended application" : "Standard Application ($65 online) — or Single Application ($45) if it's one work by one author who is also the sole claimant"}.`,
      `Enter the author/claimant info${authors.trim() ? `: ${authors.trim()}` : " (the human creator(s) — AI systems can't be listed)"}.`,
      draft
        ? `Paste the AI-drafted description of work into the application.`
        : `Write a short description of the work (or generate one with the AI assistant above).`,
      `Upload your deposit copy${draft && draft.filingNotes.length > 0 ? " (see AI filing notes for the right format)" : " — e.g. MP3 for a recording, lyric sheet PDF for lyrics, the video file for a music video"}.`,
      `Pay the filing fee online and save your case number — then mark this work "filed" in your tracker below.`,
    ];
    return steps;
  }, [workType, title, authors, draft]);

  function copyChecklist() {
    const text =
      `Copyright filing checklist — "${title.trim() || "(untitled)"}"\n\n` +
      (draft ? `DESCRIPTION OF WORK (AI-drafted):\n${draft.description}\n\nFILING NOTES:\n${draft.filingNotes.map((n) => `• ${n}`).join("\n")}\n\n` : "") +
      `STEPS:\n${checklist.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n\n${DISCLAIMER}`;
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => {}
    );
  }

  function addRegistration() {
    if (!title.trim()) return;
    setRegs((prev) => [
      {
        id: uid(),
        title: title.trim().slice(0, 120),
        workType: WORK_TYPE_OPTS.find((o) => o.key === workType)?.label ?? workType,
        status: draft ? "prepared" : "draft",
        createdAt: new Date().toISOString(),
      },
      ...prev,
    ]);
  }

  function cycleStatus(id: string) {
    setRegs((prev) =>
      prev.map((r) =>
        r.id === id
          ? { ...r, status: (r.status === "draft" ? "prepared" : r.status === "prepared" ? "filed" : "draft") as RegStatus }
          : r
      )
    );
  }

  const statusBadge = (s: RegStatus) =>
    s === "filed"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
      : s === "prepared"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
        : "border-white/15 bg-white/[0.04] text-white/50";

  return (
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />
      <main className="mx-auto max-w-5xl px-4 pb-20 pt-10 sm:px-6">
        {/* ── HERO ── */}
        <div className="text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-primary">
            <Scale className="h-4 w-4" aria-hidden="true" /> Protect the catalog
          </div>
          <h1 className="text-4xl font-black tracking-tight sm:text-5xl">
            Copyright <span className="bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] bg-clip-text text-transparent">Filing Assistant</span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-white/60">
            You own your music the second you create it — registration is what lets you{" "}
            <span className="text-white">enforce</span> it. Our AI drafts your application
            description and filing notes, then hands you a checklist to file at{" "}
            <span className="text-white">copyright.gov</span> in minutes.
          </p>
        </div>

        {/* ── EXPLAINER ── */}
        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {[
            {
              icon: ShieldCheck,
              title: "What registration does",
              body: "Creates a public record of your claim and is generally required before you can sue for infringement in federal court.",
            },
            {
              icon: BadgeDollarSign,
              title: "Why it matters for money",
              body: "Register BEFORE infringement happens and you preserve eligibility for statutory damages (up to $150k per work) and attorney's fees.",
            },
            {
              icon: Clock3,
              title: "Cost & timing",
              body: "$65 Standard Application or $45 Single Application online. Standard processing: ~1–4 months. Confirm fees at copyright.gov.",
            },
          ].map((c) => (
            <div key={c.title} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <c.icon className="mb-3 h-6 w-6 text-primary" aria-hidden="true" />
              <h3 className="font-bold text-white">{c.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-white/55">{c.body}</p>
            </div>
          ))}
        </div>

        {/* ── AI FILING ASSISTANT (core) ── */}
        <section className="mt-12 rounded-3xl border border-primary/30 bg-gradient-to-b from-primary/[0.07] to-transparent p-6 sm:p-8">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f]">
              <Sparkles className="h-6 w-6 text-black" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-2xl font-black">AI Filing Assistant</h2>
              <p className="text-sm text-white/50">
                Fill in your work details — free. AI writes your formal application description + filing notes.
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Work type</label>
              <div className="flex flex-wrap gap-2">
                {WORK_TYPE_OPTS.map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    title={o.hint}
                    onClick={() => setWorkType(o.key)}
                    className={`rounded-xl border px-3.5 py-2 text-sm font-bold transition ${
                      workType === o.key
                        ? "border-primary/60 bg-primary/15 text-primary"
                        : "border-white/10 bg-white/[0.03] text-white/55 hover:border-white/25"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className={labelClass} htmlFor="cr-title">Work title</label>
              <input id="cr-title" className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Midnight Crown" maxLength={200} />
            </div>
            <div>
              <label className={labelClass} htmlFor="cr-authors">Author(s) / claimant(s)</label>
              <input id="cr-authors" className={inputClass} value={authors} onChange={(e) => setAuthors(e.target.value)} placeholder="Legal names, comma-separated" maxLength={500} />
            </div>
            <div>
              <label className={labelClass} htmlFor="cr-created">Year / date of creation</label>
              <input id="cr-created" className={inputClass} value={creationDate} onChange={(e) => setCreationDate(e.target.value)} placeholder="e.g. 2026" maxLength={20} />
            </div>
            <div className="flex items-end gap-4">
              <label className="flex cursor-pointer items-center gap-2.5 text-sm text-white/70">
                <input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} className="h-4 w-4 accent-[#d4af37]" />
                Already published / released
              </label>
              {published && (
                <input className={inputClass} value={publishedDate} onChange={(e) => setPublishedDate(e.target.value)} placeholder="Release date" maxLength={20} />
              )}
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass} htmlFor="cr-notes">Anything else the AI should know (optional)</label>
              <textarea id="cr-notes" className={`${inputClass} min-h-[72px] resize-y`} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Co-writers, samples used, AI tools involved in production…" maxLength={1000} />
            </div>
          </div>

          <div className="mt-6 text-center">
            {user ? (
              <button
                onClick={generateDraft}
                disabled={draftLoading}
                className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-8 py-4 text-lg font-black text-black shadow-[0_4px_28px_rgba(212,175,55,0.4)] transition hover:scale-[1.03] active:scale-95 disabled:opacity-50"
              >
                {draftLoading ? <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" /> : <Sparkles className="h-6 w-6" aria-hidden="true" />}
                {draftLoading ? "Drafting your filing…" : draft ? "Regenerate draft" : "Generate my filing draft"}
              </button>
            ) : (
              <Link href="/login" className="inline-flex items-center gap-2 rounded-2xl border border-primary/50 bg-primary/10 px-8 py-4 text-lg font-bold text-primary transition hover:bg-primary hover:text-black">
                <Sparkles className="h-6 w-6" aria-hidden="true" /> Sign in to generate your draft <ArrowRight className="h-5 w-5" aria-hidden="true" />
              </Link>
            )}
            <p className="mt-2.5 text-xs text-white/35">{DRAFT_CREDIT_COST} credit per draft · powered by Thy Cheat Code</p>
            {draftOutOfCredits && <div className="mx-auto mt-4 max-w-md"><OutOfCredits /></div>}
            {draftError && !draftOutOfCredits && (
              <p className="mx-auto mt-4 max-w-md rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{draftError}</p>
            )}
          </div>

          {draft && (
            <div id="draft-result" className="mt-8 grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-black/50 p-5">
                <h3 className="mb-2 flex items-center gap-2 font-bold text-primary"><FileText className="h-5 w-5" aria-hidden="true" /> Description of work</h3>
                <p className="text-sm leading-relaxed text-white/75">{draft.description}</p>
                <button
                  onClick={() => navigator.clipboard.writeText(draft.description).catch(() => {})}
                  className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-primary/80 transition hover:text-primary"
                >
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Copy description
                </button>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/50 p-5">
                <h3 className="mb-2 flex items-center gap-2 font-bold text-primary"><ListChecks className="h-5 w-5" aria-hidden="true" /> Filing notes</h3>
                <ul className="space-y-2 text-sm leading-relaxed text-white/75">
                  {draft.filingNotes.map((n, i) => (
                    <li key={i} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />{n}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </section>

        {/* ── FILING CHECKLIST ── */}
        <section className="mt-10 rounded-3xl border border-white/10 bg-white/[0.03] p-6 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-2xl font-black">Your filing checklist</h2>
            <button
              onClick={copyChecklist}
              className="inline-flex items-center gap-1.5 rounded-xl border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-bold text-primary transition hover:bg-primary hover:text-black"
            >
              <Copy className="h-4 w-4" aria-hidden="true" /> {copied ? "Copied!" : "Copy checklist"}
            </button>
          </div>
          <p className="mt-1 text-sm text-white/50">Take this to <span className="text-white">copyright.gov/eco</span> — we prepare everything, you file (v1).</p>
          <ol className="mt-4 space-y-3">
            {checklist.map((s, i) => (
              <li key={i} className="flex gap-3 text-sm leading-relaxed text-white/70">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-black text-primary">{i + 1}</span>
                {s}
              </li>
            ))}
          </ol>
          <button
            onClick={addRegistration}
            disabled={!title.trim()}
            className="mt-5 inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/[0.04] px-4 py-2.5 text-sm font-bold text-white/80 transition hover:border-primary/50 hover:text-primary disabled:opacity-40"
          >
            <Plus className="h-4 w-4" aria-hidden="true" /> Track this work below
          </button>
        </section>

        {/* ── TRACKER ── */}
        <section className="mt-10">
          <h2 className="text-2xl font-black">My registrations</h2>
          <p className="mt-1 text-sm text-white/50">Tap a status to advance it: draft → prepared → filed.</p>
          {regs.length === 0 ? (
            <p className="mt-4 rounded-2xl border border-dashed border-white/15 p-6 text-center text-sm text-white/40">
              Nothing tracked yet — fill in the form above and hit "Track this work".
            </p>
          ) : (
            <div className="mt-4 space-y-2.5">
              {regs.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-bold text-white">{r.title}</p>
                    <p className="text-xs text-white/40">{r.workType} · added {new Date(r.createdAt).toLocaleDateString()}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={() => cycleStatus(r.id)}
                      title="Tap to advance status"
                      className={`rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wider transition ${statusBadge(r.status)}`}
                    >
                      {r.status}
                    </button>
                    <button
                      onClick={() => setRegs((prev) => prev.filter((x) => x.id !== r.id))}
                      title="Remove"
                      className="rounded-lg p-1.5 text-white/30 transition hover:bg-white/10 hover:text-red-300"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── AI Q&A ── */}
        <section className="mt-12 rounded-3xl border border-primary/30 bg-gradient-to-b from-primary/[0.07] to-transparent p-6 sm:p-8">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f]">
              <MessageCircleQuestion className="h-6 w-6 text-black" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-2xl font-black">Ask about copyright</h2>
              <p className="text-sm text-white/50">GPT-6 answers your registration questions — fees, timelines, disputes, AI works.</p>
            </div>
          </div>

          <div className="mt-5 max-h-96 space-y-3 overflow-y-auto rounded-2xl border border-white/10 bg-black/50 p-4">
            {qaMessages.length === 0 && (
              <p className="text-center text-sm text-white/35">
                Try: "Should I register my song before or after I release it?" or "What happens if someone steals my beat?"
              </p>
            )}
            {qaMessages.map((m, i) => (
              <div key={i} className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${m.role === "user" ? "ml-auto bg-primary/20 text-white" : "bg-white/[0.05] text-white/80"}`}>
                {m.content}
              </div>
            ))}
            {qaLoading && (
              <div className="flex items-center gap-2 text-sm text-white/40">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Thinking…
              </div>
            )}
          </div>

          <div className="mt-4 flex gap-2">
            <input
              className={inputClass}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") askQuestion(); }}
              placeholder={user ? "Ask anything about copyright registration…" : "Sign in to ask questions"}
              maxLength={1000}
              disabled={!user || qaLoading}
            />
            <button
              onClick={askQuestion}
              disabled={!user || qaLoading || !question.trim()}
              className="shrink-0 rounded-xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-5 py-3 text-sm font-black text-black transition hover:scale-[1.03] active:scale-95 disabled:opacity-50"
            >
              Ask
            </button>
          </div>
          <p className="mt-2 text-xs text-white/35">{ASK_CREDIT_COST} credit per answer · powered by Thy Cheat Code</p>
          {qaOutOfCredits && <div className="mx-auto mt-4 max-w-md"><OutOfCredits /></div>}
          {qaError && !qaOutOfCredits && (
            <p className="mx-auto mt-4 max-w-md rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{qaError}</p>
          )}
        </section>

        {/* ── FAQ ── */}
        <section className="mt-12">
          <h2 className="text-2xl font-black">Common questions</h2>
          <div className="mt-4 space-y-2.5">
            {FAQ.map((f, i) => (
              <div key={i} className="rounded-2xl border border-white/10 bg-white/[0.03]">
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left font-bold text-white"
                >
                  {f.q}
                  <ChevronDown className={`h-5 w-5 shrink-0 text-primary transition-transform ${openFaq === i ? "rotate-180" : ""}`} aria-hidden="true" />
                </button>
                {openFaq === i && <p className="px-5 pb-5 text-sm leading-relaxed text-white/60">{f.a}</p>}
              </div>
            ))}
          </div>
        </section>

        {/* ── DISCLAIMER ── */}
        <div className="mt-10 flex gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] p-5">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-400" aria-hidden="true" />
          <p className="text-sm leading-relaxed text-white/60">{DISCLAIMER}</p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
