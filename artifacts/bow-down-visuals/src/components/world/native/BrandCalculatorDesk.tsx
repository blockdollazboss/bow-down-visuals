/**
 * BrandCalculatorDesk — the Get Paid room's native Brand Deal
 * Calculator desk (stack1500 world parity wave #3, census
 * item 21).
 *
 * Price a brand deal from your real numbers — platform,
 * followers, average views, engagement, the deliverable, your
 * niche — and get the rate card in the room: the range, per-
 * post and 3-post package numbers, the per-deliverable
 * breakdown, usage-rights surcharges and negotiation tips.
 *
 * The run is 200 Visual Bucs through the World's
 * confirmed-spend seam (the page's plain fetch is upgraded,
 * per the wave's precedent): a decline runs nothing, and
 * running out of Bucs lands in the out-of-Bucs state pointing
 * at the Treasury's Visual Buc Packs desk. Every figure is an
 * industry estimate — the rail's disclaimer renders on the
 * card verbatim.
 */
import { useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { apiErrorMessage } from "../../../lib/api-error";
import {
  BRAND_CALC_CONTENT_TYPES,
  BRAND_CALC_COST,
  BRAND_CALC_FEATURE,
  BRAND_CALC_PATH,
  BRAND_CALC_PLATFORMS,
  brandCalcResultOf,
  buildBrandCalcPayload,
  formatMoney,
  type BrandCalcForm,
  type BrandCalcResult,
} from "@/lib/world/brand-calculator-desk";

function GuestGate({ isLight }: { isLight: boolean }) {
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  return (
    <div className="space-y-3" data-testid="world-brand-calc-desk">
      <p className={`text-base font-black ${strong}`}>Brand Deal Calculator</p>
      <p className={`text-sm ${muted}`}>
        You&rsquo;re visiting as a guest — the calculator prices off your own numbers and runs on
        your Bucs, so it needs your account.
      </p>
      <Link
        href="/login"
        data-testid="world-brand-calc-desk-signin"
        className="bdv-touch-target inline-flex items-center gap-1.5 rounded-full border border-[#d4af37] bg-[#d4af37] px-4 py-2 text-xs font-bold text-black"
      >
        Sign in to price a deal
      </Link>
    </div>
  );
}

const EMPTY_FORM: BrandCalcForm = {
  platform: "youtube",
  followers: "",
  avgViews: "",
  engagementRate: "",
  contentType: "dedicated_video",
  niche: "",
};

export function BrandCalculatorDesk({ isLight, isGuest }: { isLight: boolean; isGuest: boolean }) {
  const { confirmedFetch } = useConfirmedApi();
  const { refreshProfile } = useAuth();
  const [form, setForm] = useState<BrandCalcForm>(EMPTY_FORM);
  const [result, setResult] = useState<BrandCalcResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [out, setOut] = useState(false);

  if (isGuest) return <GuestGate isLight={isLight} />;

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const cardCls = isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5";
  const inputCls = `w-full rounded-lg border px-3 py-2 text-sm outline-none ${
    isLight
      ? "border-[#C9A84C]/40 bg-white/70 text-[#3D2E0A] placeholder:text-[#6B5B36]/60"
      : "border-white/15 bg-black/30 text-white placeholder:text-white/35"
  }`;
  const chipCls = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${
      active
        ? "border-[#d4af37] bg-[#d4af37] text-black"
        : isLight
          ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
          : "border-white/15 text-white/75 hover:text-white"
    }`;
  const goldBtn =
    "bdv-touch-target rounded-lg bg-[#d4af37] px-4 py-2 text-sm font-bold text-black disabled:cursor-not-allowed disabled:opacity-50";
  const errCls = `text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`;

  const set = (patch: Partial<BrandCalcForm>) => setForm((f) => ({ ...f, ...patch }));

  async function calculate() {
    const payload = buildBrandCalcPayload(form);
    if (!payload || running) {
      if (!payload) {
        setError("Fill in your numbers first — followers (100 or more), average views, engagement %, and your niche.");
      }
      return;
    }
    setRunning(true);
    setError(null);
    setOut(false);
    try {
      const res = await confirmedFetch(BRAND_CALC_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        overrideCost: BRAND_CALC_COST,
        overrideFeature: BRAND_CALC_FEATURE,
      });
      if (res === null) return;
      const data: unknown = await res.json().catch(() => ({}));
      if (res.status === 402) {
        setOut(true);
        void refreshProfile().catch(() => {});
        return;
      }
      const parsed = res.ok ? brandCalcResultOf(data) : null;
      if (!parsed) throw new Error(apiErrorMessage(data, "The calculator hiccupped — try again."));
      setResult(parsed);
      void refreshProfile().catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "The calculator hiccupped — try again.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-4" data-testid="world-brand-calc-desk">
      <div>
        <p className={`text-base font-black ${strong}`}>Brand Deal Calculator</p>
        <p className={`text-xs ${muted}`}>
          What to charge for a brand deal, priced off your real numbers.
        </p>
      </div>

      <div>
        <p className={`text-xs font-bold ${muted}`}>Platform</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {BRAND_CALC_PLATFORMS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={chipCls(form.platform === p.key)}
              onClick={() => set({ platform: p.key })}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <label className={`text-xs ${muted}`}>
          Followers
          <input
            className={`${inputCls} mt-1`}
            data-testid="world-brand-calc-desk-followers"
            inputMode="numeric"
            placeholder="50000"
            value={form.followers}
            onChange={(e) => set({ followers: e.target.value })}
          />
        </label>
        <label className={`text-xs ${muted}`}>
          Average views
          <input
            className={`${inputCls} mt-1`}
            inputMode="numeric"
            placeholder="20000"
            value={form.avgViews}
            onChange={(e) => set({ avgViews: e.target.value })}
          />
        </label>
        <label className={`text-xs ${muted}`}>
          Engagement rate %
          <input
            className={`${inputCls} mt-1`}
            inputMode="decimal"
            placeholder="4.5"
            value={form.engagementRate}
            onChange={(e) => set({ engagementRate: e.target.value })}
          />
        </label>
      </div>

      <div>
        <p className={`text-xs font-bold ${muted}`}>The deliverable</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {BRAND_CALC_CONTENT_TYPES.map((t) => (
            <button
              key={t.key}
              type="button"
              className={chipCls(form.contentType === t.key)}
              onClick={() => set({ contentType: t.key })}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <label className={`block text-xs ${muted}`}>
        Your niche
        <input
          className={`${inputCls} mt-1`}
          data-testid="world-brand-calc-desk-niche"
          placeholder="e.g. indie hip-hop production"
          maxLength={120}
          value={form.niche}
          onChange={(e) => set({ niche: e.target.value })}
        />
      </label>

      <button
        type="button"
        data-testid="world-brand-calc-desk-run"
        className={goldBtn}
        disabled={running}
        onClick={() => void calculate()}
      >
        {running ? "Pricing…" : `Price my deal — ${BRAND_CALC_COST} Bucs`}
      </button>
      {out ? (
        <p className={errCls}>
          You&rsquo;re out of Visual Bucs for the {BRAND_CALC_FEATURE}. Top up at the
          Treasury&rsquo;s Visual Buc Packs desk and run it again.
        </p>
      ) : null}
      {error ? <p className={errCls}>{error}</p> : null}

      {result ? (
        <div className={`rounded-xl border p-3 ${cardCls}`} data-testid="world-brand-calc-desk-result">
          <p className={`text-xs font-bold uppercase tracking-wide ${muted}`}>Your rate range</p>
          <p className={`mt-1 text-xl font-black ${strong}`}>
            {formatMoney(result.rateLow, result.currency)} – {formatMoney(result.rateHigh, result.currency)}
          </p>
          <p className={`mt-1 text-sm ${muted}`}>
            Per post: <span className={`font-bold ${strong}`}>{formatMoney(result.perPost, result.currency)}</span>
            {" · "}Package of 3:{" "}
            <span className={`font-bold ${strong}`}>{formatMoney(result.package3, result.currency)}</span>
          </p>
          {result.breakdown.length > 0 ? (
            <>
              <p className={`mt-3 text-xs font-bold uppercase tracking-wide ${muted}`}>By deliverable</p>
              <ul className="mt-1 space-y-1">
                {result.breakdown.map((b, i) => (
                  <li key={i} className={`text-sm ${muted}`}>
                    {b.deliverable} — {formatMoney(b.low, result.currency)} – {formatMoney(b.high, result.currency)}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {result.usageRights.length > 0 ? (
            <>
              <p className={`mt-3 text-xs font-bold uppercase tracking-wide ${muted}`}>Usage rights</p>
              <ul className="mt-1 space-y-1">
                {result.usageRights.map((u, i) => (
                  <li key={i} className={`text-sm ${muted}`}>
                    {u.term}
                    {u.surcharge ? ` — ${u.surcharge}` : ""}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {result.negotiationTips.length > 0 ? (
            <>
              <p className={`mt-3 text-xs font-bold uppercase tracking-wide ${muted}`}>Negotiation tips</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {result.negotiationTips.map((t, i) => (
                  <li key={i} className={`text-sm ${muted}`}>{t}</li>
                ))}
              </ul>
            </>
          ) : null}
          {result.disclaimer ? (
            <p className={`mt-3 text-xs italic ${muted}`} data-testid="world-brand-calc-desk-disclaimer">
              {result.disclaimer}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
