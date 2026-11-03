/**
 * TakeoversDesk — the Charts board's native Takeovers desk
 * (stack1500 world parity wave #3, census item 33).
 *
 * The two big placements, offered in the room: the Spotlight
 * Takeover (your video across the sign-in + sign-up screens)
 * and the Loading Screen Takeover (your brand on every
 * loading screen) — each with its real price, run length,
 * surfaces and specs from the rail's own offer, and an
 * inquiry form under it.
 *
 * An inquiry is a REQUEST, never a purchase: the rails store
 * it and take no charge (their own contract), and the desk
 * says so in plain words — sending one books nothing and
 * charges nothing. Both rails are public and free; the form
 * carries the name + email, so guests inquire in full.
 */
import { useCallback, useEffect, useState } from "react";
import { apiErrorMessage } from "../../../lib/api-error";
import {
  LOADING_INQUIRE_PATH,
  LOADING_OFFER_PATH,
  SPOTLIGHT_INQUIRE_PATH,
  SPOTLIGHT_OFFER_PATH,
  buildTakeoverInquiryPayload,
  takeoverInquiryOk,
  takeoverOfferOf,
  type TakeoverInquiryForm,
  type TakeoverOffer,
} from "@/lib/world/takeovers-desk";

const EMPTY_FORM: TakeoverInquiryForm = { name: "", email: "", videoUrl: "", targetUrl: "" };

interface OfferSlot {
  offer: TakeoverOffer | null;
  failed: boolean;
}

function OfferBlock({
  isLight,
  title,
  slot,
  inquirePath,
  formKey,
}: {
  isLight: boolean;
  title: string;
  slot: OfferSlot;
  inquirePath: string;
  formKey: string;
}) {
  const [form, setForm] = useState<TakeoverInquiryForm>(EMPTY_FORM);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const cardCls = isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5";
  const inputCls = `w-full rounded-lg border px-3 py-2 text-sm outline-none ${
    isLight
      ? "border-[#C9A84C]/40 bg-white/70 text-[#3D2E0A] placeholder:text-[#6B5B36]/60"
      : "border-white/15 bg-black/30 text-white placeholder:text-white/35"
  }`;
  const goldBtn =
    "bdv-touch-target rounded-lg bg-[#d4af37] px-4 py-2 text-sm font-bold text-black disabled:cursor-not-allowed disabled:opacity-50";
  const errCls = `text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`;

  const set = (patch: Partial<TakeoverInquiryForm>) => setForm((f) => ({ ...f, ...patch }));

  async function inquire() {
    const payload = buildTakeoverInquiryPayload(form);
    if (!payload || sending) {
      if (!payload) {
        setError("Add your name, a valid email, and a working link to your video (the click-through link is optional, but must be a real link if you add it).");
      }
      return;
    }
    setSending(true);
    setError(null);
    try {
      const res = await fetch(inquirePath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok || !takeoverInquiryOk(data)) {
        throw new Error(apiErrorMessage(data, "Could not save your request. Please try again later."));
      }
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your request. Please try again later.");
    } finally {
      setSending(false);
    }
  }

  if (slot.failed) {
    return (
      <section className={`rounded-xl border p-3 ${cardCls}`}>
        <p className={`text-sm font-bold ${strong}`}>{title}</p>
        <p className={`mt-1 text-sm ${muted}`}>This offer wouldn&rsquo;t load just now — try the board again in a moment.</p>
      </section>
    );
  }
  if (!slot.offer) {
    return (
      <section className={`rounded-xl border p-3 ${cardCls}`}>
        <p className={`text-sm font-bold ${strong}`}>{title}</p>
        <p className={`mt-1 text-sm ${muted}`}>Reading the offer…</p>
      </section>
    );
  }
  const offer = slot.offer;
  return (
    <section className={`rounded-xl border p-3 ${cardCls}`} data-testid={`world-takeovers-desk-offer-${formKey}`}>
      <div className="flex flex-wrap items-baseline gap-2">
        <p className={`text-sm font-black ${strong}`}>{offer.name}</p>
        <span className={`text-sm font-bold ${strong}`}>${offer.priceDollars.toLocaleString()}</span>
        <span className={`text-xs ${muted}`}>for {offer.durationDays} days</span>
      </div>
      {offer.surfaces.length > 0 ? (
        <p className={`mt-0.5 text-xs ${muted}`}>Runs on: {offer.surfaces.join(" · ")}</p>
      ) : null}
      {offer.specs.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {offer.specs.map((spec, i) => (
            <li key={i} className={`text-sm ${muted}`}>{spec}</li>
          ))}
        </ul>
      ) : null}
      {sent ? (
        <p className={`mt-3 text-sm font-semibold ${strong}`} data-testid={`world-takeovers-desk-sent-${formKey}`}>
          Request saved ✓ — the team reviews inquiries and replies by email. Nothing was charged
          and nothing is booked yet.
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className={`text-xs ${muted}`}>
              Your name
              <input className={`${inputCls} mt-1`} maxLength={200} value={form.name} onChange={(e) => set({ name: e.target.value })} />
            </label>
            <label className={`text-xs ${muted}`}>
              Email
              <input className={`${inputCls} mt-1`} maxLength={320} placeholder="you@brand.com" value={form.email} onChange={(e) => set({ email: e.target.value })} />
            </label>
            <label className={`text-xs ${muted}`}>
              Your video link
              <input className={`${inputCls} mt-1`} maxLength={2000} placeholder="https://…" value={form.videoUrl} onChange={(e) => set({ videoUrl: e.target.value })} />
            </label>
            <label className={`text-xs ${muted}`}>
              Click-through link (optional)
              <input className={`${inputCls} mt-1`} maxLength={2000} placeholder="https://…" value={form.targetUrl} onChange={(e) => set({ targetUrl: e.target.value })} />
            </label>
          </div>
          <button
            type="button"
            data-testid={`world-takeovers-desk-inquire-${formKey}`}
            className={goldBtn}
            disabled={sending}
            onClick={() => void inquire()}
          >
            {sending ? "Sending…" : "Send the inquiry"}
          </button>
          <p className={`text-xs ${muted}`}>
            An inquiry is a request, not a purchase — no charge is taken when you send it.
          </p>
          {error ? <p className={errCls}>{error}</p> : null}
        </div>
      )}
    </section>
  );
}

export function TakeoversDesk({ isLight }: { isLight: boolean }) {
  const [spotlight, setSpotlight] = useState<OfferSlot>({ offer: null, failed: false });
  const [loading, setLoading] = useState<OfferSlot>({ offer: null, failed: false });

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";

  const load = useCallback(async () => {
    const read = async (path: string): Promise<OfferSlot> => {
      try {
        const res = await fetch(path);
        if (!res.ok) throw new Error("offer failed");
        const offer = takeoverOfferOf(await res.json().catch(() => ({})));
        if (!offer) throw new Error("offer failed");
        return { offer, failed: false };
      } catch {
        return { offer: null, failed: true };
      }
    };
    setSpotlight(await read(SPOTLIGHT_OFFER_PATH));
    setLoading(await read(LOADING_OFFER_PATH));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4" data-testid="world-takeovers-desk">
      <div>
        <p className={`text-base font-black ${strong}`}>Takeovers</p>
        <p className={`text-xs ${muted}`}>
          Put your brand on the house&rsquo;s biggest screens — send an inquiry and the team takes
          it from there.
        </p>
      </div>
      <OfferBlock isLight={isLight} title="Spotlight Takeover" slot={spotlight} inquirePath={SPOTLIGHT_INQUIRE_PATH} formKey="spotlight" />
      <OfferBlock isLight={isLight} title="Loading Screen Takeover" slot={loading} inquirePath={LOADING_INQUIRE_PATH} formKey="loading" />
    </div>
  );
}
