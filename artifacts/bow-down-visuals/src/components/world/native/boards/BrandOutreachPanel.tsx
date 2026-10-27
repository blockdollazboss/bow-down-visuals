import { useState } from "react";
import { Link } from "wouter";
import { Check, Copy, Megaphone, Send, Sparkles } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  BRAND_OUTREACH_AUDIENCE_SIZES,
  BRAND_OUTREACH_COST_VB,
  BRAND_OUTREACH_DEAL_TYPES,
  BRAND_OUTREACH_DEFAULT_PLATFORMS,
  BRAND_OUTREACH_PLATFORMS,
  brandOutreachErrorMessage,
  buildBrandOutreachPayload,
  buildUgcBriefPayload,
  normalizeBrandOutreachResult,
  normalizeUgcBriefResult,
  ugcBriefErrorMessage,
  type BrandOutreachResult,
  type UgcBriefResult,
} from "@/lib/world/charts-board";
import { UGC_PAYMENT_NOTE, UGC_STYLES } from "@/lib/ugc-ads";
import { copyText } from "@/lib/streaming";

/* ─── BrandOutreachPanel — the For Brands tab's outreach, in-world ──
   (P3: the parity audit's Charts row — the tab scouted in-world
   but outreach doored to the website.) Both halves now work at the
   board, on the site's own rails — the same endpoints the
   website's surfaces post to, no new back-end:
   - the PITCH: POST /api/brand-deals/outreach, the Brand Deals
     page's draft rail. It charges BRAND_OUTREACH_COST_VB per draft
     (the credit registry's pin, stated on the button before the
     tap — the World's price-up-front discipline), and a failed
     generation is auto-refunded server-side. The answer renders
     here: subject, message, a Copy for the walker's own sending,
     the rail's tips, and the Bucs it actually moved.
   - the BRIEF: POST /api/ugc-briefs, the Promote page's board.
     A brief carries no charge (the honesty note below rides the
     panel, as it rides the board), and the posted brief confirms
     here — it is live on the Promote board for creators to claim.
   Payload shaping, vocabularies, and answer/error reading live in
   lib/world/charts-board.ts; this panel is the form only. Members
   only — the board mounts it behind the same !isGuest gate the
   doors stood behind. One quiet website footer stands at the end,
   as the native law allows — never auto-opened. */

export function BrandOutreachPanel({ isLight }: { isLight: boolean }) {
  const { getAccessToken, user } = useAuth();

  const authHeaders = async (): Promise<Record<string, string>> => {
    const token = await getAccessToken().catch(() => null);
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const inputCls = `w-full rounded-xl border px-3 py-2 text-sm outline-none transition focus:border-[#d4af37] ${
    isLight
      ? "border-[#C9A84C]/40 bg-white/60 text-[#2a1e07]"
      : "border-white/10 bg-white/5 text-white"
  }`;
  const labelCls = `block text-xs font-bold ${isLight ? "text-[#6B5B36]" : "text-white/60"}`;
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const chipBtn = (active: boolean) =>
    `rounded-full px-3 py-1.5 text-xs font-bold transition ${
      active
        ? "bg-[#d4af37] text-black"
        : isLight
          ? "border border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
          : "border border-white/15 text-white/75 hover:text-white"
    }`;

  /* ── The pitch draft ─────────────────────────────────────────── */
  const [brand, setBrand] = useState("");
  const [dealTypeKey, setDealTypeKey] = useState("");
  const [creatorName, setCreatorName] = useState(
    () => (user?.user_metadata?.["display_name"] as string | undefined) ?? "",
  );
  const [niche, setNiche] = useState("");
  const [audienceSize, setAudienceSize] = useState<string>("10k-50k");
  const [platforms, setPlatforms] = useState<string[]>([...BRAND_OUTREACH_DEFAULT_PLATFORMS]);
  const [contentStyle, setContentStyle] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [draft, setDraft] = useState<BrandOutreachResult | null>(null);
  const [outreachError, setOutreachError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const outreachPayload = buildBrandOutreachPayload({
    brand,
    dealTypeKey,
    creatorName,
    niche,
    audienceSize,
    platforms,
    contentStyle,
  });

  const togglePlatform = (p: string) =>
    setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));

  const submitOutreach = async () => {
    if (!outreachPayload || drafting) return;
    setDrafting(true);
    setOutreachError(null);
    try {
      const res = await fetch("/api/brand-deals/outreach", {
        method: "POST",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify(outreachPayload),
      });
      const body: unknown = await res.json().catch(() => null);
      const result = res.ok ? normalizeBrandOutreachResult(body) : null;
      if (result) {
        setDraft(result);
        setCopied(false);
      } else {
        setOutreachError(brandOutreachErrorMessage(body, res.status));
      }
    } catch {
      setOutreachError("The draft didn't go through — try again.");
    } finally {
      setDrafting(false);
    }
  };

  const copyDraft = async () => {
    if (!draft) return;
    if (await copyText(`${draft.subject}\n\n${draft.message}`)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  /* ── The brief ───────────────────────────────────────────────── */
  const [productName, setProductName] = useState("");
  const [productUrl, setProductUrl] = useState("");
  const [details, setDetails] = useState("");
  const [style, setStyle] = useState<string>(UGC_STYLES[0].key);
  const [deadline, setDeadline] = useState("");
  const [posting, setPosting] = useState(false);
  const [posted, setPosted] = useState<UgcBriefResult | null>(null);
  const [briefError, setBriefError] = useState<string | null>(null);

  const briefPayload = buildUgcBriefPayload({ productName, productUrl, details, style, deadline });

  const submitBrief = async () => {
    if (!briefPayload || posting) return;
    setPosting(true);
    setBriefError(null);
    try {
      const res = await fetch("/api/ugc-briefs", {
        method: "POST",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify(briefPayload),
      });
      const body: unknown = await res.json().catch(() => null);
      const result = res.ok ? normalizeUgcBriefResult(body) : null;
      if (result) {
        setPosted(result);
      } else {
        setBriefError(ugcBriefErrorMessage(body, res.status));
      }
    } catch {
      setBriefError("That brief couldn't post — try again.");
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="space-y-5 px-1" data-testid="world-charts-brand-outreach">
      <div className="space-y-1">
        <p className={`flex items-center gap-2 text-sm font-black ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
          <Megaphone className="h-4 w-4 text-[#d4af37]" /> Brand outreach — right here in the hall
        </p>
        <p className={`text-xs ${muted}`}>
          Pitch a brand with a drafted message, or post a brief and let creators claim it. Both
          happen here — no trip to the website.
        </p>
      </div>

      {/* ── Pitch a brand ─────────────────────────────────────── */}
      <div className="space-y-3" data-testid="world-charts-outreach-form">
        <p className={`text-xs font-black uppercase tracking-wide ${muted}`}>Draft a pitch</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className={labelCls} htmlFor="world-outreach-brand">The brand</label>
            <input
              id="world-outreach-brand"
              data-testid="world-outreach-brand"
              className={inputCls}
              placeholder="e.g. Goldline Headphones"
              maxLength={120}
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className={labelCls} htmlFor="world-outreach-deal-type">Deal type</label>
            <select
              id="world-outreach-deal-type"
              data-testid="world-outreach-deal-type"
              className={inputCls}
              value={dealTypeKey}
              onChange={(e) => setDealTypeKey(e.target.value)}
            >
              <option value="">Any deal type</option>
              {BRAND_OUTREACH_DEAL_TYPES.map((d) => (
                <option key={d.key} value={d.key}>{d.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className={labelCls} htmlFor="world-outreach-creator-name">Your creator name</label>
            <input
              id="world-outreach-creator-name"
              data-testid="world-outreach-creator-name"
              className={inputCls}
              maxLength={100}
              value={creatorName}
              onChange={(e) => setCreatorName(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className={labelCls} htmlFor="world-outreach-niche">Your niche</label>
            <input
              id="world-outreach-niche"
              data-testid="world-outreach-niche"
              className={inputCls}
              placeholder="e.g. Hip-hop production"
              maxLength={100}
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className={labelCls} htmlFor="world-outreach-audience">Audience size</label>
            <select
              id="world-outreach-audience"
              data-testid="world-outreach-audience"
              className={inputCls}
              value={audienceSize}
              onChange={(e) => setAudienceSize(e.target.value)}
            >
              {BRAND_OUTREACH_AUDIENCE_SIZES.map((a) => (
                <option key={a.key} value={a.key}>{a.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className={labelCls} htmlFor="world-outreach-style">Content style (optional)</label>
            <input
              id="world-outreach-style"
              data-testid="world-outreach-style"
              className={inputCls}
              placeholder="e.g. Studio sessions, gear reviews"
              maxLength={200}
              value={contentStyle}
              onChange={(e) => setContentStyle(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1">
          <span className={labelCls}>Your platforms</span>
          <div className="flex flex-wrap gap-1.5">
            {BRAND_OUTREACH_PLATFORMS.map((p) => (
              <button
                key={p}
                type="button"
                data-testid={`world-outreach-platform-${p}`}
                aria-pressed={platforms.includes(p)}
                onClick={() => togglePlatform(p)}
                className={chipBtn(platforms.includes(p))}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          data-testid="world-outreach-submit"
          onClick={() => void submitOutreach()}
          disabled={!outreachPayload || drafting}
          className="inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-4 py-2 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50 disabled:hover:scale-100"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {drafting ? "Drafting…" : `Draft my pitch — ${BRAND_OUTREACH_COST_VB} Visual Bucs`}
        </button>
        {!outreachPayload && (
          <p className={`text-xs ${muted}`}>
            Add the brand, your name, your niche and at least one platform — then the draft can
            ride. A failed draft is refunded automatically.
          </p>
        )}
        {outreachError && (
          <p role="alert" data-testid="world-outreach-error" className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
            {outreachError}
          </p>
        )}
        {draft && (
          <div
            data-testid="world-outreach-result"
            className={`space-y-2 rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/40 bg-white/60" : "border-white/10 bg-white/5"}`}
          >
            <p className={`text-sm font-black ${isLight ? "text-[#2a1e07]" : "text-white"}`}>{draft.subject}</p>
            <p className={`whitespace-pre-wrap text-sm ${isLight ? "text-[#2a1e07]/85" : "text-white/85"}`}>{draft.message}</p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="world-outreach-copy"
                onClick={() => void copyDraft()}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition ${
                  isLight
                    ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
                    : "border-white/15 text-white/75 hover:text-white"
                }`}
              >
                {copied ? <Check className="h-3.5 w-3.5 text-[#d4af37]" /> : <Copy className="h-3.5 w-3.5 text-[#d4af37]" />}
                {copied ? "Copied — send it your way" : "Copy the pitch"}
              </button>
              {draft.creditsUsed !== null && (
                <span className={`text-xs ${muted}`}>
                  Drafted for {draft.creditsUsed} Visual Bucs
                  {draft.creditsRemaining !== null ? ` — ${draft.creditsRemaining} left` : ""}.
                </span>
              )}
            </div>
            {draft.tips.length > 0 && (
              <ul className={`list-disc space-y-0.5 pl-4 text-xs ${muted}`}>
                {draft.tips.map((tip) => (
                  <li key={tip}>{tip}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* ── Post a brief ──────────────────────────────────────── */}
      <div className="space-y-3" data-testid="world-charts-brief-form">
        <p className={`text-xs font-black uppercase tracking-wide ${muted}`}>Post a brief instead</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className={labelCls} htmlFor="world-brief-product">Product or brand</label>
            <input
              id="world-brief-product"
              data-testid="world-brief-product"
              className={inputCls}
              maxLength={120}
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className={labelCls} htmlFor="world-brief-style">Style</label>
            <select
              id="world-brief-style"
              data-testid="world-brief-style"
              className={inputCls}
              value={style}
              onChange={(e) => setStyle(e.target.value)}
            >
              {UGC_STYLES.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="space-y-1">
          <label className={labelCls} htmlFor="world-brief-details">What you want</label>
          <textarea
            id="world-brief-details"
            data-testid="world-brief-details"
            className={inputCls}
            rows={3}
            maxLength={2000}
            placeholder="The video you want, the points it must hit, anything creators should know…"
            value={details}
            onChange={(e) => setDetails(e.target.value)}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className={labelCls} htmlFor="world-brief-url">Product link (optional)</label>
            <input
              id="world-brief-url"
              data-testid="world-brief-url"
              className={inputCls}
              placeholder="https://…"
              maxLength={2048}
              value={productUrl}
              onChange={(e) => setProductUrl(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className={labelCls} htmlFor="world-brief-deadline">Deadline (optional)</label>
            <input
              id="world-brief-deadline"
              data-testid="world-brief-deadline"
              type="date"
              className={inputCls}
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
            />
          </div>
        </div>
        <button
          type="button"
          data-testid="world-brief-submit"
          onClick={() => void submitBrief()}
          disabled={!briefPayload || posting}
          className="inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-4 py-2 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50 disabled:hover:scale-100"
        >
          <Send className="h-3.5 w-3.5" />
          {posting ? "Posting…" : "Post the brief"}
        </button>
        {!briefPayload && (
          <p className={`text-xs ${muted}`}>
            Name the product and say what you want in at least a sentence — posting a brief costs
            nothing.
          </p>
        )}
        {briefError && (
          <p role="alert" data-testid="world-brief-error" className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
            {briefError}
          </p>
        )}
        {posted && (
          <p data-testid="world-brief-posted" className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
            “{posted.productName}” is on the Promote board — creators can claim it now.
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <p className={`text-xs ${muted}`}>{UGC_PAYMENT_NOTE}</p>
        <p className={`text-xs ${muted}`}>
          Prefer the full pages?{" "}
          <Link
            href="/brand-deals"
            data-testid="world-charts-brands-website"
            className="font-bold text-[#d4af37] underline underline-offset-2"
          >
            Open Brand Deals on the website
          </Link>
        </p>
      </div>
    </div>
  );
}
