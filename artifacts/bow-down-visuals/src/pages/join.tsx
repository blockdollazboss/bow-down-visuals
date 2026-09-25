import { useState, useEffect } from "react";
import { useRoute } from "wouter";
import { Mail, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";

/* ─── Hosted signup landing page: /join/:handle ─────────────────────────
   Public page (no auth) — fans land here from the creator's link-in-bio,
   QR codes, video descriptions. Posts to the public subscribe endpoint. */

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

interface JoinList {
  name: string;
  handle: string;
  description?: string | null;
}

export default function JoinList() {
  const [, params] = useRoute("/join/:handle");
  const handle = params?.handle ?? "";

  const [list, setList] = useState<JoinList | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!handle) return;
    fetch(`/api/email-list/join/${encodeURIComponent(handle)}`)
      .then(async (res) => {
        if (res.status === 404) { setNotFound(true); return; }
        const data = await res.json();
        setList(data.list ?? null);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [handle]);

  async function subscribe(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) { setError("Enter your email address."); return; }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/email-list/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle, email: email.trim(), name: name.trim(), source: "landing" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? data.error ?? "Signup failed — try again.");
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed — try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />
      <main className="mx-auto max-w-xl px-5 py-16">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
        ) : notFound || !list ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
            <AlertTriangle className="mx-auto h-10 w-10 text-amber-400/70" />
            <h1 className="mt-3 font-display text-2xl font-black">List not found</h1>
            <p className="mt-2 text-sm text-white/50">This signup link doesn't point anywhere. Double-check the URL.</p>
          </div>
        ) : done ? (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-8 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-400" />
            <h1 className="mt-3 font-display text-2xl font-black">You're in! 🎉</h1>
            <p className="mt-2 text-sm text-white/60">Welcome to <span className="font-semibold text-white">{list.name}</span>. Watch your inbox.</p>
          </div>
        ) : (
          <div className="rounded-2xl border border-primary/25 bg-gradient-to-b from-primary/[0.08] to-transparent p-8 text-center">
            <p className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
              <Mail className="h-3.5 w-3.5" /> Join the list
            </p>
            <h1 className="mt-4 font-display text-3xl font-black">{list.name}</h1>
            {list.description && <p className="mx-auto mt-2 max-w-md text-sm text-white/55">{list.description}</p>}

            <form onSubmit={subscribe} className="mx-auto mt-6 max-w-md space-y-3 text-left">
              <input className={inputClass} type="text" placeholder="Your name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
              <input className={inputClass} type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
              {error && (
                <p className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
                </p>
              )}
              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-xl bg-gradient-to-r from-primary to-amber-500 px-4 py-3.5 text-sm font-black uppercase tracking-widest text-black transition hover:brightness-110 disabled:opacity-60"
              >
                {submitting ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : "Count me in — it's free"}
              </button>
              <p className="text-center text-xs text-white/35">No spam, ever. Unsubscribe anytime.</p>
            </form>
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
