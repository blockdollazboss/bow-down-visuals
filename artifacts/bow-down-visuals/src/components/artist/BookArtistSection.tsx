import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { CalendarPlus, ShieldCheck, Loader2, ScrollText } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import type { CreatorProfile } from "@/lib/artist-profiles";
import {
  createPerformanceBooking,
  fetchMyPerformanceBookings,
  respondToPerformanceBooking,
  fundPerformanceBooking,
  confirmSandboxPerformanceFunding,
  performanceBookingStep,
  bookingNextActions,
  bookingMoney,
  BOOKING_STATUS_LABEL,
  ESCROW_STATUS_LABEL,
  type PerformanceBookingDto,
} from "@/lib/performance-bookings";

/* ─── Book the Artist (#158) — profile section ─────────────────────────
   The promoter-facing door of Paid Bookings, docked on the artist's
   profile (the profile IS the storefront): a signed-in visitor books
   this artist for a show — date, venue facts, fee — and the deal then
   walks the escrow steps right here: the artist accepts, the promoter
   funds the escrow, the artist marks the show complete, the promoter
   releases the fee. The plain-words terms the server generated ride
   every card, so both sides read the deal in plain English.
   Money is real dollars via Stripe escrow — never Visual Bucs.
   Styling rides the profile's --ap-* tokens, so the section exists
   as a designed surface in the light AND dark profile palettes. */

const inputStyle: React.CSSProperties = {
  backgroundColor: "var(--ap-surface)",
  borderColor: "var(--ap-border)",
  color: "var(--ap-text)",
  borderRadius: "var(--ap-radius)",
};
const labelCls = "block text-xs font-semibold uppercase tracking-wide opacity-70";
const inputCls = "mt-1 w-full border px-3 py-2 text-sm outline-none";

export default function BookArtistSection({ profile }: { profile: CreatorProfile }) {
  const { user, getAccessToken } = useAuth();
  const [bookings, setBookings] = useState<PerformanceBookingDto[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sandboxSessions, setSandboxSessions] = useState<Record<string, string>>({});
  const isOwner = !!user && user.id === profile.user_id;

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const all = await fetchMyPerformanceBookings(getAccessToken);
      setBookings(all.filter((b) => b.profileId === profile.id));
    } catch {
      setBookings([]);
    }
  }, [user, getAccessToken, profile.id]);

  useEffect(() => { void refresh(); }, [refresh]);

  /* Form state (promoter side). */
  const [form, setForm] = useState({
    promoterName: "", eventTitle: "", eventDate: "", venueName: "",
    venueAddress: "", venueCity: "", fee: "", performance: "",
    setLengthMin: "", productionNotes: "", cancellationTerms: "", notes: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setNotice(null);
    const feeCents = Math.round(Number(form.fee) * 100);
    if (!Number.isFinite(feeCents) || feeCents < 100) {
      setError("Set a fee of at least $1.");
      return;
    }
    if (!form.eventDate) {
      setError("Pick the show date and time.");
      return;
    }
    setSubmitting(true);
    try {
      const booking = await createPerformanceBooking(getAccessToken, {
        profileId: profile.id,
        promoterName: form.promoterName.trim(),
        eventTitle: form.eventTitle.trim(),
        eventDate: new Date(form.eventDate).toISOString(),
        venueName: form.venueName.trim(),
        venueAddress: form.venueAddress.trim(),
        venueCity: form.venueCity.trim(),
        feeCents,
        terms: {
          performance: form.performance.trim(),
          setLengthMin: form.setLengthMin ? Number(form.setLengthMin) : null,
          productionNotes: form.productionNotes.trim() || null,
          cancellationTerms: form.cancellationTerms.trim() || null,
        },
        notes: form.notes.trim() || undefined,
      });
      setBookings((list) => [booking, ...(list ?? [])]);
      setNotice(`Booking sent to ${profile.display_name}. They answer right here — the fee only moves when you fund the escrow after they accept.`);
      setForm({
        promoterName: "", eventTitle: "", eventDate: "", venueName: "",
        venueAddress: "", venueCity: "", fee: "", performance: "",
        setLengthMin: "", productionNotes: "", cancellationTerms: "", notes: "",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send that booking.");
    } finally {
      setSubmitting(false);
    }
  };

  const act = async (booking: PerformanceBookingDto, actionId: string) => {
    setError(null); setNotice(null);
    setBusyId(booking.id);
    try {
      if (actionId === "accept" || actionId === "decline") {
        const fresh = await respondToPerformanceBooking(
          getAccessToken, booking.id, actionId as "accept" | "decline",
        );
        setBookings((list) => (list ?? []).map((b) => (b.id === fresh.id ? fresh : b)));
      } else if (actionId === "fund") {
        const r = await fundPerformanceBooking(getAccessToken, booking.id);
        if (!r.sandbox && r.checkoutUrl) {
          window.location.href = r.checkoutUrl;
          return;
        }
        setSandboxSessions((s) => ({ ...s, [booking.id]: r.sessionId }));
        setNotice("Sandbox mode — no real money moved. Confirm the funding to walk the rest of the flow.");
        void refresh();
      } else if (actionId === "complete" || actionId === "release" || actionId === "cancel") {
        const fresh = await performanceBookingStep(
          getAccessToken, booking.id, actionId as "complete" | "release" | "cancel",
        );
        setBookings((list) => (list ?? []).map((b) => (b.id === fresh.id ? fresh : b)));
        if (actionId === "release") {
          setNotice(`Fee released: ${profile.display_name} receives ${bookingMoney(fresh.feePreview.netCents)}; the platform fee is ${bookingMoney(fresh.feePreview.feeCents)}.`);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "That step didn't go through.");
    } finally {
      setBusyId(null);
    }
  };

  const confirmSandbox = async (booking: PerformanceBookingDto) => {
    const sessionId = sandboxSessions[booking.id];
    if (!sessionId) return;
    setBusyId(booking.id); setError(null);
    try {
      await confirmSandboxPerformanceFunding(getAccessToken, booking.id, sessionId);
      setSandboxSessions((s) => { const next = { ...s }; delete next[booking.id]; return next; });
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not confirm the funding.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section aria-label={`Book ${profile.display_name} for a show`} className="px-4 py-8">
      <div
        className="mx-auto max-w-3xl border p-5 sm:p-6"
        style={{ borderColor: "var(--ap-border)", backgroundColor: "var(--ap-card)", borderRadius: "var(--ap-radius)" }}
      >
        <h2 className="flex items-center gap-2 text-xl font-bold" style={{ fontFamily: "var(--ap-heading-font)" }}>
          <CalendarPlus className="h-5 w-5" style={{ color: "var(--ap-accent)" }} />
          Book {profile.display_name} for a show
        </h2>
        <p className="mt-1 flex items-start gap-1.5 text-sm" style={{ color: "var(--ap-muted)" }}>
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--ap-accent)" }} />
          <span>
            Promoters and venues: name the date, the venue, and the fee. The fee is held in
            escrow and released to {profile.display_name} only after the show — Bow Down
            Visuals keeps 15% of the fee at release, and you never pay more than you agreed.
          </span>
        </p>

        {error && (
          <p role="alert" className="mt-3 border border-red-500/50 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300">
            {error}
          </p>
        )}
        {notice && (
          <p className="mt-3 border px-3 py-2 text-sm" style={{ borderColor: "var(--ap-accent)", color: "var(--ap-text)" }}>
            {notice}
          </p>
        )}

        {!user && (
          <p className="mt-4 text-sm" style={{ color: "var(--ap-muted)" }}>
            <Link href="/login" className="font-semibold underline underline-offset-4">Sign in</Link>{" "}
            to book {profile.display_name} — it takes a minute, and no money moves until they accept.
          </p>
        )}

        {user && !isOwner && (
          <form onSubmit={submit} className="mt-5 grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor="pb-promoter">Who is booking</label>
              <input id="pb-promoter" required value={form.promoterName} onChange={set("promoterName")} placeholder="Venue, company, or your name" className={inputCls} style={inputStyle} />
            </div>
            <div>
              <label className={labelCls} htmlFor="pb-title">Show name</label>
              <input id="pb-title" required value={form.eventTitle} onChange={set("eventTitle")} placeholder="Harbor Nights Live" className={inputCls} style={inputStyle} />
            </div>
            <div>
              <label className={labelCls} htmlFor="pb-date">Show date &amp; time</label>
              <input id="pb-date" required type="datetime-local" value={form.eventDate} onChange={set("eventDate")} className={inputCls} style={inputStyle} />
            </div>
            <div>
              <label className={labelCls} htmlFor="pb-fee">Fee (USD)</label>
              <input id="pb-fee" required inputMode="decimal" value={form.fee} onChange={set("fee")} placeholder="250.00" className={inputCls} style={inputStyle} />
            </div>
            <div>
              <label className={labelCls} htmlFor="pb-venue">Venue</label>
              <input id="pb-venue" required value={form.venueName} onChange={set("venueName")} placeholder="The Harbor Room" className={inputCls} style={inputStyle} />
            </div>
            <div>
              <label className={labelCls} htmlFor="pb-city">City</label>
              <input id="pb-city" required value={form.venueCity} onChange={set("venueCity")} placeholder="Norfolk" className={inputCls} style={inputStyle} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls} htmlFor="pb-address">Venue address</label>
              <input id="pb-address" required value={form.venueAddress} onChange={set("venueAddress")} placeholder="12 Pier Street" className={inputCls} style={inputStyle} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls} htmlFor="pb-performance">The performance</label>
              <input id="pb-performance" required value={form.performance} onChange={set("performance")} placeholder="A 45-minute headline set" className={inputCls} style={inputStyle} />
            </div>
            <div>
              <label className={labelCls} htmlFor="pb-set">Set length (minutes, optional)</label>
              <input id="pb-set" inputMode="numeric" value={form.setLengthMin} onChange={set("setLengthMin")} placeholder="45" className={inputCls} style={inputStyle} />
            </div>
            <div>
              <label className={labelCls} htmlFor="pb-production">Sound / lights / setup (optional)</label>
              <input id="pb-production" value={form.productionNotes} onChange={set("productionNotes")} placeholder="The venue provides sound and lights" className={inputCls} style={inputStyle} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls} htmlFor="pb-cancel">Cancellation terms (optional)</label>
              <input id="pb-cancel" value={form.cancellationTerms} onChange={set("cancellationTerms")} placeholder="Leave blank for a full refund if the show is cancelled" className={inputCls} style={inputStyle} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls} htmlFor="pb-notes">Anything else (optional)</label>
              <textarea id="pb-notes" value={form.notes} onChange={set("notes")} rows={2} className={inputCls} style={inputStyle} />
            </div>
            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-bold transition hover:scale-[1.02] disabled:opacity-60"
                style={{ backgroundColor: "var(--ap-primary)", color: "var(--ap-onart-text)", borderRadius: "var(--ap-radius)" }}
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarPlus className="h-4 w-4" />}
                Send this booking to {profile.display_name}
              </button>
            </div>
          </form>
        )}

        {user && bookings === null && (
          <p className="mt-4 flex items-center gap-2 text-sm" style={{ color: "var(--ap-muted)" }}>
            <Loader2 className="h-4 w-4 animate-spin" /> Loading bookings…
          </p>
        )}
        {user && bookings !== null && bookings.length === 0 && (
          <p className="mt-4 text-sm" style={{ color: "var(--ap-muted)" }}>
            {isOwner
              ? "No show bookings yet. When a promoter books you from this page, their offer lands here for your answer."
              : "You haven't booked this artist yet — your bookings with them will show here."}
          </p>
        )}
        {user && bookings !== null && bookings.length > 0 && (
          <div className="mt-5 grid gap-3">
            {bookings.map((b) => (
              <article
                key={b.id}
                className="border p-4"
                style={{ borderColor: "var(--ap-border)", backgroundColor: "var(--ap-surface)", borderRadius: "var(--ap-radius)" }}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-bold">{b.eventTitle}</h3>
                  <span className="text-sm font-semibold">{bookingMoney(b.feeCents)}</span>
                </div>
                <p className="mt-1 text-sm" style={{ color: "var(--ap-muted)" }}>
                  {new Date(b.eventDate).toLocaleString()} · {b.venueName}, {b.venueCity} ·{" "}
                  {b.role === "artist" ? `Booked by ${b.promoterName}` : `Artist: ${b.artistName}`}
                </p>
                <p className="mt-1 text-sm">
                  <span className="font-semibold">{BOOKING_STATUS_LABEL[b.status]}</span>
                  <span style={{ color: "var(--ap-muted)" }}> · Escrow: {ESCROW_STATUS_LABEL[b.escrowStatus]}</span>
                </p>
                {b.status === "paid" && (
                  <p className="mt-1 text-sm" style={{ color: "var(--ap-muted)" }}>
                    {b.artistName} received {bookingMoney(b.artistPayoutCents ?? b.feePreview.netCents)} ·
                    platform fee {bookingMoney(b.platformFeeCents ?? b.feePreview.feeCents)}.
                  </p>
                )}
                <details className="mt-2">
                  <summary className="flex cursor-pointer items-center gap-1.5 text-sm font-semibold">
                    <ScrollText className="h-4 w-4" style={{ color: "var(--ap-accent)" }} />
                    The deal, in plain words
                  </summary>
                  <p className="mt-2 whitespace-pre-line text-sm" style={{ color: "var(--ap-muted)" }}>
                    {b.plainWords}
                  </p>
                </details>
                <div className="mt-3 flex flex-wrap gap-2">
                  {bookingNextActions(b).map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      disabled={busyId === b.id}
                      onClick={() => void act(b, a.id)}
                      className="border px-3 py-1.5 text-sm font-semibold transition hover:scale-[1.02] disabled:opacity-60"
                      style={{ borderColor: "var(--ap-accent)", color: "var(--ap-text)", borderRadius: "var(--ap-radius)" }}
                    >
                      {busyId === b.id ? "Working…" : a.label}
                    </button>
                  ))}
                  {sandboxSessions[b.id] && (
                    <button
                      type="button"
                      disabled={busyId === b.id}
                      onClick={() => void confirmSandbox(b)}
                      className="px-3 py-1.5 text-sm font-bold disabled:opacity-60"
                      style={{ backgroundColor: "var(--ap-primary)", color: "var(--ap-onart-text)", borderRadius: "var(--ap-radius)" }}
                    >
                      Confirm sandbox funding
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
