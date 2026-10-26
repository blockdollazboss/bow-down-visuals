import { useCallback, useEffect, useState } from "react";
import { Gift, Loader2, CheckCircle2, Clock, Send } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";

/* ─── Gifts for you (Wave-4 #45) ───────────────────────────────────────
   The recipient + buyer gift desk inside the existing Library — no
   standalone page. Received gifts claim HERE (the claim lands the
   product in the buyer's-name store_orders the purchases surfaces
   read); sent gifts can be re-sent (nudged) while unclaimed. Both
   themes are designed: warm ivory in light, black-gold in dark. */

interface GiftView {
  id: string;
  productId: string | null;
  productTitle: string;
  storeName: string | null;
  giftMessage: string | null;
  amountCents: number;
  claimableCents: number;
  status: "scheduled" | "awaiting_claim" | "claimed";
  deliveryAt: string;
  resendCount: number;
}

export default function GiftsForYou() {
  const isLight = useIsLightTheme();
  const { user, getAccessToken } = useAuth();
  const [received, setReceived] = useState<GiftView[]>([]);
  const [sent, setSent] = useState<GiftView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/product-gifts/mine", {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      if (!res.ok) return;
      const body = (await res.json().catch(() => ({}))) as { received?: GiftView[]; sent?: GiftView[] };
      setReceived(body.received ?? []);
      setSent(body.sent ?? []);
    } catch {
      /* The section simply doesn't render on failure — the rest of
         the Library is untouched (one bad section never takes the
         whole page down). */
    } finally {
      setLoaded(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  async function act(id: string, action: "claim" | "resend") {
    setBusyId(id);
    setNote(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/product-gifts/${id}/${action}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: "{}",
      });
      const body = (await res.json().catch(() => ({}))) as { note?: string; message?: string; error?: string };
      if (!res.ok) throw new Error(body.message || body.error || "That didn't work — try again.");
      setNote(body.note ?? (action === "claim" ? "Claimed — it's yours now." : "Re-sent."));
      await load();
    } catch (err) {
      setNote(err instanceof Error ? err.message : "That didn't work — try again.");
    } finally {
      setBusyId(null);
    }
  }

  if (!user || !loaded) return null;
  const pending = received.filter((g) => g.status !== "claimed");
  const claimed = received.filter((g) => g.status === "claimed");
  const sentOpen = sent.filter((g) => g.status !== "claimed");
  if (received.length === 0 && sent.length === 0) return null;

  const card = isLight
    ? "border-[#b98a2f]/40 bg-gradient-to-b from-[#F7ECD2] to-[#FCF7EA] text-[#3d2f10]"
    : "border-amber-500/30 bg-gradient-to-b from-[#171204] to-[#0d0a04] text-amber-50";
  const subtle = isLight ? "text-[#3d2f10]/60" : "text-amber-100/50";

  function GiftRow({ g, mode }: { g: GiftView; mode: "received" | "sent" }) {
    return (
      <div className={`flex flex-wrap items-center gap-3 rounded-2xl border p-4 ${card}`}>
        <Gift className="h-6 w-6 shrink-0 text-amber-500" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{g.productTitle}</p>
          <p className={`text-xs ${subtle}`}>
            {g.storeName ? `from ${g.storeName}'s store · ` : ""}
            worth ${(g.amountCents / 100).toFixed(2)}
            {g.status === "scheduled" && ` · lands ${new Date(g.deliveryAt).toLocaleDateString()}`}
            {g.status === "awaiting_claim" && g.claimableCents > 0 && ` · $${(g.claimableCents / 100).toFixed(2)} held as your claimable credit until you claim`}
          </p>
          {g.giftMessage && <p className={`mt-1 text-sm italic ${subtle}`}>“{g.giftMessage}”</p>}
        </div>
        {mode === "received" && g.status === "awaiting_claim" && (
          <button
            type="button"
            onClick={() => act(g.id, "claim")}
            disabled={busyId === g.id}
            className="inline-flex items-center gap-2 rounded-full bg-amber-500 px-4 py-2 text-sm font-bold text-black transition hover:bg-amber-400 disabled:opacity-50"
          >
            {busyId === g.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Claim gift
          </button>
        )}
        {mode === "received" && g.status === "scheduled" && (
          <span className={`inline-flex items-center gap-1 text-xs ${subtle}`}>
            <Clock className="h-3.5 w-3.5" /> On its way
          </span>
        )}
        {mode === "received" && g.status === "claimed" && (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-500">
            <CheckCircle2 className="h-4 w-4" /> Claimed — in your purchases
          </span>
        )}
        {mode === "sent" && (
          <button
            type="button"
            onClick={() => act(g.id, "resend")}
            disabled={busyId === g.id}
            className="inline-flex items-center gap-2 rounded-full border border-amber-500/40 px-4 py-2 text-sm font-bold transition hover:bg-amber-500/10 disabled:opacity-50"
          >
            {busyId === g.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Re-send{g.resendCount > 0 ? ` (${g.resendCount})` : ""}
          </button>
        )}
      </div>
    );
  }

  return (
    <section className="relative mx-auto mb-10 max-w-5xl" data-testid="gifts-for-you">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-[#e8c86a]">
        <Gift className="h-4 w-4" /> Gifts
      </h2>
      <p className={`mb-4 text-sm ${isLight ? "text-black/50" : "text-white/40"}`}>
        Gifts sent to you are held as your claimable credit until you claim them — they never expire into anyone else&apos;s pocket.
      </p>
      {note && <p className={`mb-3 text-sm ${isLight ? "text-black/70" : "text-amber-100/70"}`}>{note}</p>}
      <div className="space-y-3">
        {pending.map((g) => <GiftRow key={g.id} g={g} mode="received" />)}
        {sentOpen.map((g) => <GiftRow key={g.id} g={g} mode="sent" />)}
        {claimed.map((g) => <GiftRow key={g.id} g={g} mode="received" />)}
      </div>
    </section>
  );
}
