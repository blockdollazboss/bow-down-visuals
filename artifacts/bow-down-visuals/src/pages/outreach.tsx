import { useEffect, useState } from "react";
import {
  Handshake, Loader2, Sparkles, Mail, MessageCircle, FileText,
  CalendarClock, Copy, Check, Send, Clock, Reply, BadgeCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import { CheatCodeName } from "@/components/pixel-headline";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";

/* ─── Sponsorship Outreach ────────────────────────────────────────────────
   AI-crafted outreach to brands for sponsorships. Pairs with the Sponsor
   Marketplace: brands list campaigns there, creators pitch them here.
   POST /api/outreach → 2 credits per kit (pitch email + DM version +
   media kit summary + 3-step follow-up sequence). The tracker is free
   client-side state (localStorage). */

const CREDIT_COST = 2;

const PLATFORM_OPTIONS = ["tiktok", "instagram", "youtube", "twitch", "twitter", "facebook"];

interface FollowUp {
  day: number;
  subject: string;
  body: string;
}

interface OutreachKit {
  pitchEmail: { subject: string; body: string };
  dmVersion: string;
  mediaKitSummary: string;
  followUps: FollowUp[];
  disclaimer: string;
}

interface OutreachResponse {
  kit?: OutreachKit;
  creditsUsed?: number;
  creditsRemaining?: number;
  error?: string;
  message?: string;
}

type TrackStatus = "sent" | "followed-up" | "replied" | "booked";

interface TrackedOutreach {
  id: string;
  brandName: string;
  creatorName: string;
  createdAt: string;
  status: TrackStatus;
}

const TRACK_KEY = "bdv-outreach-tracker";

const STATUS_META: Record<TrackStatus, { label: string; icon: LucideIcon; color: string }> = {
  sent: { label: "Sent", icon: Send, color: "text-sky-400" },
  "followed-up": { label: "Followed up", icon: Clock, color: "text-amber-400" },
  replied: { label: "Replied", icon: Reply, color: "text-violet-400" },
  booked: { label: "Booked", icon: BadgeCheck, color: "text-emerald-400" },
};

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

const labelClass = "mb-1.5 block text-xs font-semibold uppercase tracking-wider text-white/50";

function loadTracker(): TrackedOutreach[] {
  try {
    const raw = localStorage.getItem(TRACK_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(text).catch(() => undefined);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-white/60 transition hover:border-primary/40 hover:text-white"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export default function SponsorshipOutreach() {
  const { user, getAccessToken, refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();

  /* creator profile */
  const [creatorName, setCreatorName] = useState("");
  const [niche, setNiche] = useState("");
  const [audienceSize, setAudienceSize] = useState("");
  const [platforms, setPlatforms] = useState<string[]>(["tiktok", "instagram"]);
  const [engagement, setEngagement] = useState("");
  const [notableWins, setNotableWins] = useState("");

  /* brand / target */
  const [brandName, setBrandName] = useState("");
  const [product, setProduct] = useState("");
  const [campaignGoal, setCampaignGoal] = useState("");
  const [contactName, setContactName] = useState("");

  const [kit, setKit] = useState<OutreachKit | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  /* tracker (free, local) */
  const [tracked, setTracked] = useState<TrackedOutreach[]>([]);
  useEffect(() => {
    setTracked(loadTracker());
  }, []);

  function saveTracker(next: TrackedOutreach[]) {
    setTracked(next);
    try {
      localStorage.setItem(TRACK_KEY, JSON.stringify(next));
    } catch {
      /* storage full or unavailable — tracker just won't persist */
    }
  }

  function togglePlatform(p: string) {
    setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }

  async function generateKit() {
    if (loading || !user) return;
    if (!creatorName.trim() || !niche.trim() || !audienceSize.trim() || !brandName.trim() || platforms.length === 0) {
      setError("Fill in your name, niche, audience size, at least one platform, and the brand name.");
      return;
    }
    setLoading(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const token = await getAccessToken();
      const res = await confirmedFetch("/api/outreach", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        overrideCost: CREDIT_COST, // registry is stale at 1; backend + UI agree on 2
        overrideFeature: "Outreach",
        body: JSON.stringify({
          creatorName: creatorName.trim(),
          niche: niche.trim(),
          audienceSize: audienceSize.trim(),
          platforms,
          engagement: engagement.trim(),
          notableWins: notableWins.trim(),
          brandName: brandName.trim(),
          product: product.trim(),
          campaignGoal: campaignGoal.trim(),
          contactName: contactName.trim(),
        }),
      });
      if (!res) return; // user cancelled the credit confirmation (finally resets state)
      const data = (await res.json().catch(() => ({}))) as OutreachResponse;
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !data.kit) {
        throw new Error(data.message || data.error || "Outreach kit generation failed — try again.");
      }
      setKit(data.kit);
      refreshProfile();
      /* auto-add to tracker as sent */
      const entry: TrackedOutreach = {
        id: `${Date.now()}`,
        brandName: brandName.trim(),
        creatorName: creatorName.trim(),
        createdAt: new Date().toISOString(),
        status: "sent",
      };
      saveTracker([entry, ...loadTracker()]);
      setTimeout(() => {
        document.getElementById("outreach-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Outreach kit generation failed — try again.");
    } finally {
      setLoading(false);
    }
  }

  function setStatus(id: string, status: TrackStatus) {
    saveTracker(tracked.map((t) => (t.id === id ? { ...t, status } : t)));
  }

  function removeTracked(id: string) {
    saveTracker(tracked.filter((t) => t.id !== id));
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
            <Handshake className="h-3 w-3" aria-hidden="true" /> <CheatCodeName possessive /> money tools
          </p>
          <h1 className="font-display text-4xl font-black tracking-tight md:text-5xl">
            Sponsorship <span className="text-primary">Outreach</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-white/55">
            Stop waiting to be discovered. Tell us who you are and who you want
            to work with — AI writes the pitch email, the DM, and the follow-ups
            that actually get replies.
          </p>
        </div>

        {/* form */}
        <div className="relative mt-10 grid gap-6 md:grid-cols-2">
          {/* creator card */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-primary">
              <Sparkles className="h-4 w-4" /> Your creator profile
            </h2>
            <div className="mt-4 space-y-4">
              <div>
                <label className={labelClass} htmlFor="outreach-creator">Creator / artist name</label>
                <input id="outreach-creator" className={inputClass} value={creatorName} onChange={(e) => setCreatorName(e.target.value)} placeholder="King Shark" maxLength={100} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass} htmlFor="outreach-niche">Niche</label>
                  <input id="outreach-niche" className={inputClass} value={niche} onChange={(e) => setNiche(e.target.value)} placeholder="Music" maxLength={100} />
                </div>
                <div>
                  <label className={labelClass} htmlFor="outreach-audience">Audience size</label>
                  <input id="outreach-audience" className={inputClass} value={audienceSize} onChange={(e) => setAudienceSize(e.target.value)} placeholder="50K" maxLength={50} />
                </div>
              </div>
              <div>
                <span className={labelClass}>Platforms</span>
                <div className="flex flex-wrap gap-2">
                  {PLATFORM_OPTIONS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => togglePlatform(p)}
                      className={`rounded-full px-3.5 py-1.5 text-xs font-semibold capitalize transition ${
                        platforms.includes(p)
                          ? "bg-primary text-black"
                          : "border border-white/10 bg-white/[0.04] text-white/60 hover:border-primary/40 hover:text-white"
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className={labelClass} htmlFor="outreach-engagement">Engagement (optional)</label>
                <input id="outreach-engagement" className={inputClass} value={engagement} onChange={(e) => setEngagement(e.target.value)} placeholder="8% avg engagement" maxLength={200} />
              </div>
              <div>
                <label className={labelClass} htmlFor="outreach-wins">Notable wins (optional)</label>
                <textarea id="outreach-wins" className={inputClass} rows={2} value={notableWins} onChange={(e) => setNotableWins(e.target.value)} placeholder="1M streams on latest single" maxLength={500} />
              </div>
            </div>
          </div>

          {/* brand card */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-primary">
              <Handshake className="h-4 w-4" /> The brand
            </h2>
            <div className="mt-4 space-y-4">
              <div>
                <label className={labelClass} htmlFor="outreach-brand">Brand name</label>
                <input id="outreach-brand" className={inputClass} value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder="Wave Energy" maxLength={100} />
              </div>
              <div>
                <label className={labelClass} htmlFor="outreach-product">Product (optional)</label>
                <input id="outreach-product" className={inputClass} value={product} onChange={(e) => setProduct(e.target.value)} placeholder="Wave Energy Drink" maxLength={200} />
              </div>
              <div>
                <label className={labelClass} htmlFor="outreach-goal">Campaign goal (optional)</label>
                <input id="outreach-goal" className={inputClass} value={campaignGoal} onChange={(e) => setCampaignGoal(e.target.value)} placeholder="Launch to Gen Z" maxLength={300} />
              </div>
              <div>
                <label className={labelClass} htmlFor="outreach-contact">Contact name (optional)</label>
                <input id="outreach-contact" className={inputClass} value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Alex Rivera" maxLength={100} />
              </div>
              <p className="rounded-xl border border-white/10 bg-black/40 p-3 text-xs leading-relaxed text-white/45">
                Tip: check the <span className="text-primary">Sponsor Marketplace</span> for brands
                actively looking for creators — then pitch them here.
              </p>
            </div>
          </div>
        </div>

        {/* CTA */}
        <div className="relative mt-8 text-center">
          <button
            onClick={generateKit}
            disabled={loading || !user}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-8 py-3.5 text-sm font-bold text-black shadow-[0_0_24px_rgba(212,175,55,0.35)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {loading ? "Writing your kit…" : `Generate outreach kit · ${CREDIT_COST} credits`}
          </button>
          {!user && <p className="mt-3 text-xs text-white/40">Sign in to generate your outreach kit.</p>}
          {error && <p className="mx-auto mt-4 max-w-md text-sm text-red-400">{error}</p>}
          {outOfCredits && (
            <div className="mx-auto mt-4 max-w-md">
              <OutOfCredits />
            </div>
          )}
        </div>

        {/* results */}
        {kit && (
          <div id="outreach-results" className="relative mt-12 space-y-6">
            {/* pitch email */}
            <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-primary">
                  <Mail className="h-4 w-4" /> Pitch email
                </h2>
                <CopyButton text={`Subject: ${kit.pitchEmail.subject}\n\n${kit.pitchEmail.body}`} />
              </div>
              <p className="mt-4 text-sm font-semibold text-white">Subject: {kit.pitchEmail.subject}</p>
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-white/70">{kit.pitchEmail.body}</p>
            </section>

            {/* DM version */}
            <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-primary">
                  <MessageCircle className="h-4 w-4" /> DM version
                </h2>
                <CopyButton text={kit.dmVersion} />
              </div>
              <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-white/70">{kit.dmVersion}</p>
            </section>

            {/* media kit summary */}
            <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-primary">
                  <FileText className="h-4 w-4" /> Media kit summary
                </h2>
                <CopyButton text={kit.mediaKitSummary} />
              </div>
              <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-white/70">{kit.mediaKitSummary}</p>
            </section>

            {/* follow-ups */}
            <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
              <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-primary">
                <CalendarClock className="h-4 w-4" /> Follow-up sequence
              </h2>
              <div className="mt-4 space-y-4">
                {kit.followUps.map((f, i) => (
                  <div key={i} className="rounded-xl border border-white/10 bg-black/40 p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-bold uppercase tracking-wider text-white/50">
                        Day {f.day} · {f.subject}
                      </p>
                      <CopyButton text={`Subject: ${f.subject}\n\n${f.body}`} />
                    </div>
                    <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-white/70">{f.body}</p>
                  </div>
                ))}
              </div>
            </section>

            <p className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-4 text-xs leading-relaxed text-amber-200/80">
              {kit.disclaimer}
            </p>
          </div>
        )}

        {/* tracker */}
        <div className="relative mt-12">
          <h2 className="text-center text-sm font-bold uppercase tracking-widest text-white/60">
            Outreach tracker <span className="text-primary">· free</span>
          </h2>
          {tracked.length === 0 ? (
            <p className="mt-4 text-center text-sm text-white/40">
              No outreach tracked yet. Generate a kit and it lands here automatically.
            </p>
          ) : (
            <div className="mt-6 space-y-3">
              {tracked.map((t) => {
                const meta = STATUS_META[t.status];
                const Icon = meta.icon;
                return (
                  <div
                    key={t.id}
                    className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-white">{t.brandName}</p>
                      <p className="text-xs text-white/40">
                        {t.creatorName} · {new Date(t.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${meta.color}`}>
                      <Icon className="h-3.5 w-3.5" /> {meta.label}
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {(Object.keys(STATUS_META) as TrackStatus[]).map((s) => (
                        <button
                          key={s}
                          onClick={() => setStatus(t.id, s)}
                          className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                            t.status === s
                              ? "bg-primary text-black"
                              : "border border-white/10 text-white/50 hover:border-primary/40 hover:text-white"
                          }`}
                        >
                          {STATUS_META[s].label}
                        </button>
                      ))}
                      <button
                        onClick={() => removeTracked(t.id)}
                        className="rounded-full px-2.5 py-1 text-[11px] font-semibold text-white/40 transition hover:text-red-400"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
