import { useEffect, useState } from "react";
import { X, Sparkles, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";

/* Shared Loading Screen Takeover inquiry modal. Triggered from the
   loading-screen promo in the WittyLoader rotation. Mirrors SpotlightModal.
   Theme-aware (2026-10-12): ivory panel + bronze ink in light mode via
   useIsLightTheme, authored black-gold in dark. */

type Offer = {
  name: string;
  priceDollars: number;
  durationDays: number;
  surfaces: string[];
  specs: string[];
};

export default function LoadingScreenModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const isLight = useIsLightTheme();
  const [offer, setOffer] = useState<Offer | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDone(false);
    setError(null);
    fetch("/api/loading-screen/offer")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.offer && setOffer(d.offer))
      .catch(() => {});
  }, [open ]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const r = await fetch("/api/loading-screen/inquire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, videoUrl, targetUrl: targetUrl || undefined }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        const first = d?.details?.[0]?.message;
        throw new Error(first || d?.error || "Something went wrong.");
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;
  const price = offer?.priceDollars ?? 2500;
  const days = offer?.durationDays ?? 7;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Advertise on the loading screens"
    >
      <div
        className={`w-full max-w-md rounded-2xl border p-6 ${isLight ? "border-[#C9A84C]/50 bg-[#FBF6E9] shadow-[0_24px_60px_rgba(122,90,18,0.35)]" : "border-[#c9a84c]/30 bg-[#0d0d0f] shadow-[0_0_60px_rgba(201,168,76,0.2)]"}`}
        onClick={(e) => e.stopPropagation()}
      >
        {done ? (
          <div className="text-center py-6">
            <CheckCircle2 className={`mx-auto h-12 w-12 ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`} />
            <h3 className={`mt-4 text-xl font-bold ${isLight ? "text-[#2A1E07]" : "text-white"}`}>Request received</h3>
            <p className={`mt-2 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/60"}`}>
              We'll review your creative and reach out within 48 hours to get your
              placement live.
            </p>
            <Button
              className="mt-6 bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] text-black font-semibold hover:brightness-110"
              onClick={onClose}
            >
              Done
            </Button>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between">
              <div>
                <p className={`text-xs uppercase tracking-widest ${isLight ? "text-[#7A5A12]" : "text-[#c9a84c]"}`}>Advertise here</p>
                <h3 className={`mt-1 text-2xl font-bold ${isLight ? "text-[#2A1E07]" : "text-white"}`}>
                  {offer?.name ?? "Loading Screen Takeover"}
                </h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                className={`rounded-full p-1 ${isLight ? "text-[#8A7A56] hover:text-[#2A1E07]" : "text-white/40 hover:text-white"}`}
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className={`mt-3 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/70"}`}>
              Your brand on every loading screen site-wide — the moment
              creators wait, they see you.
            </p>

            <div className="mt-4 flex items-baseline gap-2">
              <span className={`text-4xl font-bold ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>${price}</span>
              <span className={`text-sm ${isLight ? "text-[#8A7A56]" : "text-white/50"}`}>for {days} days</span>
            </div>

            <ul className={`mt-4 space-y-1.5 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/65"}`}>
              {(offer?.specs ?? [
                "Your brand across every loading screen site-wide",
                "1080p image or muted looping video",
                "Your link on the placement click-through",
              ]).map((s) => (
                <li key={s} className="flex gap-2">
                  <Sparkles className={`h-4 w-4 shrink-0 mt-0.5 ${isLight ? "text-[#7A5A12]" : "text-[#c9a84c]"}`} />
                  {s}
                </li>
              ))}
            </ul>

            <form onSubmit={submit} className="mt-5 space-y-3">
              <div>
                <Label htmlFor="ls-name" className={isLight ? "text-[#2A1E07]" : "text-white/80"}>Your name</Label>
                <Input
                  id="ls-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Jane Creator"
                  required
                  maxLength={200}
                  className={`mt-1 focus:border-[#c9a84c]/60 ${isLight ? "bg-white/70 border-[#C9A84C]/40 text-[#2A1E07] placeholder:text-[#8A7A56]/60" : "bg-white/5 border-white/10 placeholder:text-white/25"}`}
                />
              </div>
              <div>
                <Label htmlFor="ls-email" className={isLight ? "text-[#2A1E07]" : "text-white/80"}>Email</Label>
                <Input
                  id="ls-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  maxLength={320}
                  className={`mt-1 focus:border-[#c9a84c]/60 ${isLight ? "bg-white/70 border-[#C9A84C]/40 text-[#2A1E07] placeholder:text-[#8A7A56]/60" : "bg-white/5 border-white/10 placeholder:text-white/25"}`}
                />
              </div>
              <div>
                <Label htmlFor="ls-video" className={isLight ? "text-[#2A1E07]" : "text-white/80"}>Video or image URL</Label>
                <Input
                  id="ls-video"
                  type="url"
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  placeholder="https://…/your-ad.mp4"
                  required
                  maxLength={2000}
                  className={`mt-1 focus:border-[#c9a84c]/60 ${isLight ? "bg-white/70 border-[#C9A84C]/40 text-[#2A1E07] placeholder:text-[#8A7A56]/60" : "bg-white/5 border-white/10 placeholder:text-white/25"}`}
                />
              </div>
              <div>
                <Label htmlFor="ls-link" className={isLight ? "text-[#2A1E07]" : "text-white/80"}>
                  Link it clicks to <span className={isLight ? "text-[#8A7A56]" : "text-white/35"}>(optional)</span>
                </Label>
                <Input
                  id="ls-link"
                  type="url"
                  value={targetUrl}
                  onChange={(e) => setTargetUrl(e.target.value)}
                  placeholder="https://yourbrand.com"
                  maxLength={2000}
                  className={`mt-1 focus:border-[#c9a84c]/60 ${isLight ? "bg-white/70 border-[#C9A84C]/40 text-[#2A1E07] placeholder:text-[#8A7A56]/60" : "bg-white/5 border-white/10 placeholder:text-white/25"}`}
                />
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <Button
                type="submit"
                disabled={submitting}
                className="w-full bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] text-black font-semibold hover:brightness-110"
              >
                {submitting ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending…</>
                ) : (
                  <>Request this spot · ${price}</>
                )}
              </Button>
              <p className={`text-center text-xs ${isLight ? "text-[#8A7A56]" : "text-white/35"}`}>
                No charge now — we confirm availability and approve your creative first.
              </p>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
