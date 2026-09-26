import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import {
  Scale, Sparkles, Loader2, Send, CheckCircle2, Circle, ChevronDown,
  DollarSign, MapPin, FileText, Landmark, Wallet, BookOpen,
  AlertTriangle, ArrowRight, Building2, BadgeCheck, Search, RotateCcw,
} from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import {
  LLC_STATES,
  getLlcState,
  REGISTERED_AGENT_TIERS,
  getAgentTier,
  type RegisteredAgentTier,
} from "@/data/llc-state-fees";
import { usePageTitle } from "@/hooks/use-page-title";

/* ─── AI-powered LLC Formation Guide ──────────────────────────────────────
   Free: step-by-step checklist (localStorage progress), 50-state fee table,
   cost estimator, FAQ. Paid AI layer (1 credit each, GPT-6):
   "Ask about LLCs" Q&A chat + personalized AI filing plan generator.
   POSTs to /api/llc-guide/ask and /api/llc-guide/plan. */

const CREDIT_COST = 1;
const PROGRESS_KEY = "llc-guide-progress-v1";

type CreatorType = "musician" | "streamer" | "youtuber" | "podcaster" | "designer" | "other";

const CREATOR_TYPES: { key: CreatorType; label: string }[] = [
  { key: "musician", label: "Musician" },
  { key: "streamer", label: "Streamer" },
  { key: "youtuber", label: "YouTuber" },
  { key: "podcaster", label: "Podcaster" },
  { key: "designer", label: "Designer" },
  { key: "other", label: "Other" },
];

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

interface PlanStep {
  title: string;
  detail: string;
  estCost: string;
  timeline: string;
}

interface FilingPlan {
  title: string;
  steps: PlanStep[];
  totalEstimate: string;
  notes: string[];
}

const CHECKLIST: { title: string; detail: string }[] = [
  {
    title: "Choose your state",
    detail: "For 95% of creators, your home state is the right answer. Filing in Delaware or Wyoming while living elsewhere usually means paying for a foreign LLC registration in your home state too.",
  },
  {
    title: "Pick a name & check availability",
    detail: "Search your Secretary of State's business name database. Your LLC name must be unique in that state and usually has to include “LLC” or “Limited Liability Company”.",
  },
  {
    title: "Appoint a registered agent",
    detail: "Someone with a physical address in the state who can receive legal mail. You can be your own agent for free (your address becomes public record) or hire a service (~$100–$300/yr).",
  },
  {
    title: "File Articles of Organization",
    detail: "The one document that creates your LLC. File online with the Secretary of State and pay the state filing fee — see the fee table below for your state.",
  },
  {
    title: "Create an Operating Agreement",
    detail: "Even solo creators should have one — it defines ownership, how money moves, and what happens if you add a partner. Templates work for single-member LLCs.",
  },
  {
    title: "Get an EIN from the IRS",
    detail: "Your federal tax ID. Free directly from IRS.gov — never pay a service for this. You'll need it for the bank account and tax filings.",
  },
  {
    title: "Open a business bank account",
    detail: "Keep business money separate from personal money from day one. Bring your approved Articles, EIN letter, and ID to the bank.",
  },
  {
    title: "Handle licenses & sales tax",
    detail: "Most creators don't need special licenses, but check your city/county. If you sell merch, you may need a sales tax permit in your state.",
  },
  {
    title: "Set up simple bookkeeping",
    detail: "Track every dollar in and out. A spreadsheet works at first; accounting software pays for itself once brand deals and royalties start flowing.",
  },
  {
    title: "Stay compliant",
    detail: "File your annual/biennial report and pay the ongoing state fee on time. Missing them can dissolve your LLC — set a calendar reminder now.",
  },
];

const FAQS: { q: string; a: string }[] = [
  {
    q: "Do I actually need an LLC as a content creator?",
    a: "Not on day one — but once you're earning real money (brand deals, ad revenue, royalties, merch), an LLC separates your personal assets from business liability and makes you look professional to sponsors. Many creators form one once they cross a few thousand dollars a year in income.",
  },
  {
    q: "LLC vs. sole proprietor — what's the difference?",
    a: "A sole proprietor IS you — no separation, so a lawsuit or debt can reach your personal assets. An LLC is a separate legal entity: business debts and most lawsuits stop at the company. LLCs also unlock business bank accounts and cleaner taxes as you grow.",
  },
  {
    q: "Should I file in Delaware, Wyoming, or Nevada instead of my home state?",
    a: "Almost certainly not. If you live and work in your home state, you'll still have to register there as a “foreign LLC” — paying both states' fees. The out-of-state hype mostly benefits the formation companies selling it. File where you live.",
  },
  {
    q: "How are LLCs taxed?",
    a: "By default the IRS treats a single-member LLC like a sole proprietor: profits flow to your personal tax return (pass-through taxation). No double tax. As income grows, some creators elect S-corp taxation to save on self-employment tax — that's a conversation for a CPA.",
  },
  {
    q: "How much does it really cost?",
    a: "The state filing fee is the only mandatory cost — $35 to $500 depending on your state (see the table). Add the ongoing annual fee ($0–$800/yr depending on state). An EIN is free from the IRS. Budget services will happily charge you hundreds extra — you don't need them for a standard filing.",
  },
  {
    q: "Can I be my own registered agent?",
    a: "Yes, in every state. It's free. The tradeoff: your name and address go on public record, and you must be available at that address during business hours to receive legal documents. Many creators start DIY and switch to a service later.",
  },
  {
    q: "How long does it take?",
    a: "Online filings are often approved in days (Colorado can be same-day); mailed filings take weeks. Check the processing column in the fee table for your state.",
  },
];

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

function money(n: number): string {
  return n % 1 === 0 ? `$${n.toLocaleString()}` : `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function SectionLabel({ icon: Icon, children }: { icon: typeof Scale; children: React.ReactNode }) {
  return (
    <p className="mb-4 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary/80">
      <Icon className="h-3.5 w-3.5" aria-hidden="true" /> {children}
    </p>
  );
}

export default function LlcGuide() {
  usePageTitle("LLC Guide", "Start your music business right — step-by-step LLC formation guide for creators.");
  const { user, getAccessToken, refreshProfile } = useAuth();

  /* ── AI Q&A chat ─────────────────────────────────────────────────── */
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [question, setQuestion] = useState("");
  const [chatState, setChatState] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatOutOfCredits, setChatOutOfCredits] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  /* ── AI filing plan ──────────────────────────────────────────────── */
  const [planState, setPlanState] = useState("CA");
  const [creatorType, setCreatorType] = useState<CreatorType>("musician");
  const [businessName, setBusinessName] = useState("");
  const [plan, setPlan] = useState<FilingPlan | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planOutOfCredits, setPlanOutOfCredits] = useState(false);

  /* ── Free tools: checklist / estimator / fee table ──────────────── */
  const [checked, setChecked] = useState<boolean[]>(() => {
    try {
      const raw = localStorage.getItem(PROGRESS_KEY);
      if (raw) {
        const arr = JSON.parse(raw) as boolean[];
        if (Array.isArray(arr) && arr.length === CHECKLIST.length) return arr;
      }
    } catch { /* fresh start */ }
    return Array(CHECKLIST.length).fill(false);
  });
  const [feeSearch, setFeeSearch] = useState("");
  const [estState, setEstState] = useState("CA");
  const [agentTier, setAgentTier] = useState<RegisteredAgentTier>("diy");
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(checked));
    } catch { /* storage unavailable */ }
  }, [checked]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages]);

  const progress = useMemo(
    () => Math.round((checked.filter(Boolean).length / CHECKLIST.length) * 100),
    [checked],
  );

  const filteredStates = useMemo(() => {
    const q = feeSearch.trim().toLowerCase();
    if (!q) return LLC_STATES;
    return LLC_STATES.filter(
      (s) => s.name.toLowerCase().includes(q) || s.code.toLowerCase() === q,
    );
  }, [feeSearch]);

  const estimate = useMemo(() => {
    const st = getLlcState(estState);
    const agent = getAgentTier(agentTier);
    if (!st) return null;
    const filing = st.filingFee;
    const agentCost = agent.yearly;
    const yearOne = filing + agentCost;
    return { st, agent, filing, agentCost, yearOne, ongoing: st.ongoingYearly + agentCost };
  }, [estState, agentTier]);

  function toggleCheck(i: number) {
    setChecked((prev) => prev.map((v, idx) => (idx === i ? !v : v)));
  }

  function resetChecklist() {
    setChecked(Array(CHECKLIST.length).fill(false));
  }

  async function authedPost(path: string, body: unknown) {
    const token = await getAccessToken();
    return fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  function handleOutOfCredits(setter: (v: boolean) => void) {
    setter(true);
    refreshProfile();
  }

  async function askQuestion() {
    const q = question.trim();
    if (!q || chatLoading || !user) return;
    setChatLoading(true);
    setChatError(null);
    setChatOutOfCredits(false);
    const nextMessages: ChatMsg[] = [...messages, { role: "user" as const, content: q }];
    setMessages(nextMessages);
    setQuestion("");
    try {
      const res = await authedPost("/api/llc-guide/ask", {
        question: q,
        state: chatState || undefined,
        history: nextMessages.slice(-10),
      });
      const data = (await res.json().catch(() => ({}))) as {
        answer?: string; error?: string; message?: string;
      };
      if (res.status === 402 || data.error === "out_of_credits") {
        handleOutOfCredits(setChatOutOfCredits);
        setMessages(messages);
        return;
      }
      if (!res.ok || !data.answer) {
        throw new Error(data.message || data.error || "Couldn't get an answer — try again.");
      }
      setMessages([...nextMessages, { role: "assistant", content: data.answer }]);
      refreshProfile();
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "Couldn't get an answer — try again.");
      setMessages(messages);
    } finally {
      setChatLoading(false);
    }
  }

  async function buildPlan() {
    if (planLoading || !user) return;
    setPlanLoading(true);
    setPlanError(null);
    setPlanOutOfCredits(false);
    try {
      const res = await authedPost("/api/llc-guide/plan", {
        state: planState,
        creatorType,
        businessName: businessName.trim(),
      });
      const data = (await res.json().catch(() => ({}))) as {
        plan?: FilingPlan; error?: string; message?: string;
      };
      if (res.status === 402 || data.error === "out_of_credits") {
        handleOutOfCredits(setPlanOutOfCredits);
        return;
      }
      if (!res.ok || !data.plan || !Array.isArray(data.plan.steps) || data.plan.steps.length === 0) {
        throw new Error(data.message || data.error || "Plan generation failed — try again.");
      }
      setPlan(data.plan);
      refreshProfile();
      setTimeout(() => {
        document.getElementById("llc-plan-results")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : "Plan generation failed — try again.");
    } finally {
      setPlanLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />

      <main className="relative mx-auto max-w-4xl px-5 pb-24 pt-14 md:pt-20">
        {/* glow */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center" aria-hidden="true">
          <div className="h-[280px] w-[560px] rounded-full bg-yellow-600/10 blur-[110px]" />
        </div>

        {/* hero */}
        <div className="relative text-center">
          <p className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-primary">
            <Scale className="h-3 w-3" aria-hidden="true" /> AI-powered business tools
          </p>
          <h1 className="font-display text-4xl font-black tracking-tight md:text-5xl">
            LLC Formation <span className="text-primary">Guide</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-white/55">
            Everything a creator needs to form an LLC — ask the AI anything,
            get a filing plan tailored to your state and craft, then work the
            free step-by-step checklist.
          </p>
          <p className="mx-auto mt-4 flex max-w-xl items-start justify-center gap-1.5 text-xs text-white/40">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400/70" aria-hidden="true" />
            <span>Informational only — not legal advice. For complex situations, consult a business attorney.</span>
          </p>
        </div>

        {/* ── AI Q&A ─────────────────────────────────────────────── */}
        <section className="relative mt-10 overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-8">
          <SectionLabel icon={Sparkles}>Ask about LLCs · AI answers</SectionLabel>
          <h2 className="text-2xl font-black tracking-tight">
            Ask Thy Cheat Code <span className="text-primary">anything</span>
          </h2>
          <p className="mt-2 text-sm text-white/55">
            “Should I file in Delaware or my home state?” “What's a registered agent?”
            Straight answers, grounded in real 2026 state fees.
          </p>

          <div className="mt-5 rounded-2xl border border-white/10 bg-black/50 p-4">
            <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
              {messages.length === 0 && (
                <p className="py-6 text-center text-sm text-white/30">
                  🦈 No questions yet — ask your first one below. Try “Do I need an LLC as a streamer?”
                </p>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                      m.role === "user"
                        ? "bg-primary/15 text-white"
                        : "border border-white/10 bg-white/[0.04] text-white/85"
                    }`}
                  >
                    {m.role === "assistant" && (
                      <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-primary/70">🦈 Cheat Code</p>
                    )}
                    <p className="whitespace-pre-wrap">{m.content}</p>
                  </div>
                </div>
              ))}
              {chatLoading && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm text-white/50">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Thinking…
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            <div className="mt-4 flex flex-col gap-2.5 sm:flex-row">
              <select
                value={chatState}
                onChange={(e) => setChatState(e.target.value)}
                aria-label="Your state (optional, for fee-accurate answers)"
                className="rounded-xl border border-white/10 bg-black/60 px-3 py-3 text-sm text-white outline-none transition focus:border-primary/60 sm:max-w-[180px]"
              >
                <option value="">My state…</option>
                {LLC_STATES.map((s) => (
                  <option key={s.code} value={s.code}>{s.name}</option>
                ))}
              </select>
              <div className="flex flex-1 gap-2">
                <input
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") askQuestion(); }}
                  maxLength={1000}
                  placeholder={user ? "Ask about LLCs…" : "Sign in to ask the AI…"}
                  disabled={!user || chatLoading}
                  className={inputClass}
                />
                <button
                  onClick={askQuestion}
                  disabled={!user || chatLoading || !question.trim()}
                  aria-label="Ask"
                  className="flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-4 text-black shadow-[0_4px_20px_rgba(212,175,55,0.35)] transition hover:scale-105 active:scale-95 disabled:opacity-40"
                >
                  {chatLoading ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <Send className="h-5 w-5" aria-hidden="true" />}
                </button>
              </div>
            </div>

            {!user && (
              <p className="mt-3 text-center text-sm text-white/40">
                <Link href="/login" className="font-semibold text-primary hover:underline">Sign in</Link> to ask the AI — {CREDIT_COST} credit per answer.
              </p>
            )}
            {user && (
              <p className="mt-2.5 text-center text-xs text-white/35">
                {CREDIT_COST} credit per answer · powered by Thy Cheat Code · credit refunded if the AI fails
              </p>
            )}
            {chatOutOfCredits && <div className="mx-auto mt-4 max-w-md"><OutOfCredits /></div>}
            {chatError && !chatOutOfCredits && (
              <p className="mx-auto mt-4 max-w-md rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{chatError}</p>
            )}
          </div>
        </section>

        {/* ── AI filing plan ─────────────────────────────────────── */}
        <section className="relative mt-8 overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-8">
          <SectionLabel icon={FileText}>AI filing plan · personalized</SectionLabel>
          <h2 className="text-2xl font-black tracking-tight">
            Your tailored <span className="text-primary">filing plan</span>
          </h2>
          <p className="mt-2 text-sm text-white/55">
            Tell the AI your state and what kind of creator you are — it builds a
            step-by-step plan with your state's real fees and creator-specific advice.
          </p>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-white/40">Filing state</p>
              <select
                value={planState}
                onChange={(e) => setPlanState(e.target.value)}
                aria-label="Filing state"
                className="w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white outline-none transition focus:border-primary/60"
              >
                {LLC_STATES.map((s) => (
                  <option key={s.code} value={s.code}>{s.name} — ${s.filingFee} filing fee</option>
                ))}
              </select>
            </div>
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-white/40">Business name <span className="text-white/25">(optional)</span></p>
              <input
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                maxLength={120}
                placeholder="e.g. Shark King Media LLC"
                className={inputClass}
              />
            </div>
          </div>

          <p className="mb-2 mt-5 text-[11px] font-bold uppercase tracking-widest text-white/40">What kind of creator are you?</p>
          <div className="flex flex-wrap gap-2">
            {CREATOR_TYPES.map((t) => {
              const selected = creatorType === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setCreatorType(t.key)}
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                    selected
                      ? "bg-primary text-black shadow-[0_0_16px_rgba(212,175,55,0.3)]"
                      : "border border-white/10 bg-white/[0.03] text-white/60 hover:border-primary/40 hover:text-white"
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          <div className="mt-6 text-center">
            {user ? (
              <button
                onClick={buildPlan}
                disabled={planLoading}
                className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-8 py-4 text-lg font-black text-black shadow-[0_4px_28px_rgba(212,175,55,0.4)] transition hover:scale-[1.03] active:scale-95 disabled:opacity-50"
              >
                {planLoading ? <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" /> : <Sparkles className="h-6 w-6" aria-hidden="true" />}
                {planLoading ? "Building your plan…" : "Generate my filing plan"}
              </button>
            ) : (
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-2xl border border-primary/50 bg-primary/10 px-8 py-4 text-lg font-bold text-primary transition hover:bg-primary hover:text-black"
              >
                <Sparkles className="h-6 w-6" aria-hidden="true" />
                Sign in to generate your plan
                <ArrowRight className="h-5 w-5" aria-hidden="true" />
              </Link>
            )}
            <p className="mt-2.5 text-xs text-white/35">
              {CREDIT_COST} credit per plan · powered by Thy Cheat Code · credit refunded if the AI fails
            </p>
            {planOutOfCredits && <div className="mx-auto mt-4 max-w-md"><OutOfCredits /></div>}
            {planError && !planOutOfCredits && (
              <p className="mx-auto mt-4 max-w-md rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{planError}</p>
            )}
          </div>

          {plan && (
            <div id="llc-plan-results" className="mt-8">
              <p className="mb-4 text-[11px] font-bold uppercase tracking-widest text-primary/80">
                <BadgeCheck className="mr-1.5 inline h-3.5 w-3.5" aria-hidden="true" />
                {plan.title}
              </p>
              <div className="grid gap-3">
                {plan.steps.map((s, i) => (
                  <div key={i} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                    <div className="flex items-start gap-3.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-black text-primary">{i + 1}</span>
                      <div className="min-w-0">
                        <p className="font-bold text-white">{s.title}</p>
                        <p className="mt-1 text-sm leading-relaxed text-white/65">{s.detail}</p>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs">
                          {s.estCost && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 font-semibold text-primary">
                              <DollarSign className="h-3 w-3" aria-hidden="true" />{s.estCost}
                            </span>
                          )}
                          {s.timeline && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-white/55">
                              {s.timeline}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {plan.totalEstimate && (
                <div className="mt-4 rounded-2xl border border-primary/30 bg-primary/[0.07] p-5 text-center">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-white/40">Estimated first-year total</p>
                  <p className="font-display mt-1 text-2xl font-black text-primary">{plan.totalEstimate}</p>
                </div>
              )}
              {plan.notes.length > 0 && (
                <ul className="mt-4 space-y-2">
                  {plan.notes.map((n, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-white/55">
                      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/60" aria-hidden="true" />
                      {n}
                    </li>
                  ))}
                </ul>
              )}
              {user && (
                <div className="mt-6 text-center">
                  <button
                    onClick={buildPlan}
                    disabled={planLoading}
                    className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 px-5 py-2.5 text-sm font-bold text-primary transition hover:bg-primary hover:text-black disabled:opacity-50"
                  >
                    {planLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RotateCcw className="h-4 w-4" aria-hidden="true" />}
                    Regenerate plan ({CREDIT_COST} credit)
                  </button>
                </div>
              )}
            </div>
          )}
        </section>

        {/* ── Free: interactive checklist ──────────────────────────── */}
        <section className="relative mt-8 rounded-3xl border border-white/10 bg-white/[0.02] p-6 md:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <SectionLabel icon={CheckCircle2}>Free · your progress saves automatically</SectionLabel>
              <h2 className="text-2xl font-black tracking-tight">The 10-step <span className="text-primary">checklist</span></h2>
            </div>
            <button
              onClick={resetChecklist}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-4 py-2 text-xs font-semibold text-white/50 transition hover:border-primary/40 hover:text-white"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Reset
            </button>
          </div>

          <div className="mt-5 flex items-center gap-3">
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#8a6d1f] via-primary to-[#f5d67b] transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="font-display text-xl font-black text-primary">{progress}%</p>
          </div>

          <div className="mt-5 grid gap-2.5">
            {CHECKLIST.map((step, i) => {
              const done = checked[i];
              return (
                <button
                  key={i}
                  onClick={() => toggleCheck(i)}
                  className={`flex items-start gap-3.5 rounded-2xl border p-4 text-left transition ${
                    done
                      ? "border-primary/30 bg-primary/[0.06]"
                      : "border-white/10 bg-black/40 hover:border-primary/25"
                  }`}
                >
                  {done
                    ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                    : <Circle className="mt-0.5 h-5 w-5 shrink-0 text-white/25" aria-hidden="true" />}
                  <span>
                    <span className={`block text-sm font-bold ${done ? "text-white/50 line-through" : "text-white"}`}>
                      {i + 1}. {step.title}
                    </span>
                    <span className={`mt-1 block text-sm leading-relaxed ${done ? "text-white/30" : "text-white/55"}`}>
                      {step.detail}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          {progress === 100 && (
            <p className="mt-5 rounded-2xl border border-primary/40 bg-primary/10 p-4 text-center text-sm font-bold text-primary">
              🎉 Checklist complete — you're running a real business. Bow down. 🦈
            </p>
          )}
        </section>

        {/* ── Free: state fee explorer + cost estimator ─────────────── */}
        <section className="relative mt-8 rounded-3xl border border-white/10 bg-white/[0.02] p-6 md:p-8">
          <SectionLabel icon={MapPin}>Free · 2026 state fees</SectionLabel>
          <h2 className="text-2xl font-black tracking-tight">What it costs <span className="text-primary">in your state</span></h2>
          <p className="mt-2 text-sm text-white/55">
            One-time filing fees and ongoing costs for all 50 states. Fees change —
            verify with your Secretary of State before filing.
          </p>

          {/* estimator */}
          <div className="mt-5 rounded-2xl border border-primary/25 bg-black/50 p-5">
            <p className="mb-3 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-white/40">
              <Wallet className="h-3.5 w-3.5" aria-hidden="true" /> First-year cost estimator
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <select
                value={estState}
                onChange={(e) => setEstState(e.target.value)}
                aria-label="Estimator state"
                className="rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white outline-none transition focus:border-primary/60"
              >
                {LLC_STATES.map((s) => (
                  <option key={s.code} value={s.code}>{s.name}</option>
                ))}
              </select>
              <select
                value={agentTier}
                onChange={(e) => setAgentTier(e.target.value as RegisteredAgentTier)}
                aria-label="Registered agent option"
                className="rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white outline-none transition focus:border-primary/60"
              >
                {REGISTERED_AGENT_TIERS.map((t) => (
                  <option key={t.key} value={t.key}>{t.label} ({t.yearly === 0 ? "free" : `$${t.yearly}/yr`})</option>
                ))}
              </select>
            </div>
            {estimate && (
              <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5 text-center">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-white/35">State filing</p>
                  <p className="font-display mt-1 text-xl font-black text-white">{money(estimate.filing)}</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5 text-center">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-white/35">Agent (yr 1)</p>
                  <p className="font-display mt-1 text-xl font-black text-white">{money(estimate.agentCost)}</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5 text-center">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-white/35">EIN (IRS)</p>
                  <p className="font-display mt-1 text-xl font-black text-emerald-400">Free</p>
                </div>
                <div className="rounded-xl border border-primary/40 bg-primary/10 p-3.5 text-center">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-primary/70">Year 1 total</p>
                  <p className="font-display mt-1 text-xl font-black text-primary">{money(estimate.yearOne)}</p>
                </div>
              </div>
            )}
            {estimate && (
              <p className="mt-3 text-center text-xs text-white/40">
                Ongoing after year 1: ~{money(estimate.ongoing)}/yr ({estimate.st.ongoing} + agent).
              </p>
            )}
          </div>

          {/* fee table */}
          <div className="relative mt-5">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/25" aria-hidden="true" />
            <input
              value={feeSearch}
              onChange={(e) => setFeeSearch(e.target.value)}
              placeholder="Search states…"
              aria-label="Search states"
              className={`${inputClass} pl-10`}
            />
          </div>
          <div className="mt-3 max-h-96 overflow-y-auto rounded-2xl border border-white/10">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-[#0d0b08]">
                <tr className="text-[10px] uppercase tracking-widest text-white/35">
                  <th className="px-4 py-3 font-bold">State</th>
                  <th className="px-4 py-3 text-right font-bold">Filing fee</th>
                  <th className="hidden px-4 py-3 font-bold sm:table-cell">Ongoing</th>
                  <th className="hidden px-4 py-3 font-bold md:table-cell">Processing</th>
                </tr>
              </thead>
              <tbody>
                {filteredStates.map((s) => (
                  <tr key={s.code} className="border-t border-white/5 transition hover:bg-primary/[0.04]">
                    <td className="px-4 py-2.5 font-semibold text-white/90">
                      {s.name} <span className="text-white/30">({s.code})</span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-black text-primary">{money(s.filingFee)}</td>
                    <td className="hidden px-4 py-2.5 text-white/55 sm:table-cell">{s.ongoing}</td>
                    <td className="hidden px-4 py-2.5 text-white/55 md:table-cell">{s.processing}</td>
                  </tr>
                ))}
                {filteredStates.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-sm text-white/35">
                      No states match “{feeSearch}”.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-white/30">
            Sources: llc.org &amp; boostsuite.com, 2026. New York's publication requirement can add $50–$1,500+.
          </p>
        </section>

        {/* ── Free: FAQ ────────────────────────────────────────────── */}
        <section className="relative mt-8 rounded-3xl border border-white/10 bg-white/[0.02] p-6 md:p-8">
          <SectionLabel icon={BookOpen}>Free · creator FAQ</SectionLabel>
          <h2 className="text-2xl font-black tracking-tight">Questions creators <span className="text-primary">actually ask</span></h2>
          <div className="mt-5 grid gap-2.5">
            {FAQS.map((f, i) => {
              const open = openFaq === i;
              return (
                <div key={i} className={`overflow-hidden rounded-2xl border transition ${open ? "border-primary/30 bg-primary/[0.05]" : "border-white/10 bg-black/40"}`}>
                  <button
                    onClick={() => setOpenFaq(open ? null : i)}
                    aria-expanded={open}
                    className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
                  >
                    <span className="text-[15px] font-bold text-white">{f.q}</span>
                    <ChevronDown className={`h-4 w-4 shrink-0 text-primary transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
                  </button>
                  {open && (
                    <p className="px-5 pb-5 text-sm leading-relaxed text-white/60">{f.a}</p>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* disclaimer */}
        <div className="relative mt-8 rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] p-5">
          <p className="flex items-start gap-2.5 text-sm leading-relaxed text-white/60">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
            <span>
              <span className="font-bold text-white/85">Not legal advice.</span> This guide
              (including AI answers) is for informational purposes only and doesn't create an
              attorney–client relationship. LLC rules, fees, and tax treatment vary by state
              and change over time — verify everything with your Secretary of State and
              consult a licensed business attorney or CPA for your situation.
            </span>
          </p>
        </div>

        {/* cross-link */}
        <p className="relative mt-8 text-center text-sm text-white/40">
          Business formed? Ask{" "}
          <Link href="/coach" className="font-semibold text-primary hover:underline">Thy Cheat Code's Money Coach</Link>{" "}
          how to make it pay. 🦈
        </p>
      </main>

      <SiteFooter />
    </div>
  );
}
