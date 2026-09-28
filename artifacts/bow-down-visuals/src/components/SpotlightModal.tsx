import { useEffect, useState } from "react";
import { X, Sparkles, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/* Shared Spotlight Takeover inquiry modal, opened by the auth-screen
   floating badge (SpotlightPromo). */

type Offer = {
  name: string;
  priceDollars: number;
  durationDays: number;
  surfaces: string[];
  specs: string[];
};

export default function SpotlightModal({ open, onClose }: { open: boolean; onClose: () => void }) {
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
    fetch("/api/spotlight/offer")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.offer && setOffer(d.offer))
      .catch(() => {});
  }, [open ]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const r = await fetch("/api/spotlight/inquire", {
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
  const price = offer?.priceDollars ?? 99;
  const days = offer?.durationDays ?? 7;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Advertise on the sign-in screen"
    >
      <div
        className="w-full max-w-md rounded-2xl border border-[#c9a84c]/30 bg-[#0d0d0f] p-6 shadow-[0_0_60px_rgba(201,168,76,0.2)]"
        onClick={(e) => e.stopPropagation()}
      >
        {done ? (
          <div className="text-center py-6">
            <CheckCircle2 className="mx-auto h-12 w-12 text-[#e8c86a]" />
            <h3 className="mt-4 text-xl font-bold text-white">Request received</h3>
            <p className="mt-2 text-sm text-white/60">
              We'll review your video and reach out within 48 hours to get your
              Spotlight live.
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
                <p className="text-xs uppercase tracking-widest text-[#c9a84c]">Advertise here</p>
                <h3 className="mt-1 text-2xl font-bold text-white">
                  {offer?.name ?? "Spotlight Takeover"}
                </h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full p-1 text-white/40 hover:text-white"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="mt-3 text-sm text-white/70">
              Your video as the full-screen background on the sign-in{" "}
              <span className="text-white/40">and</span> sign-up screens —
              the first thing every visitor sees.
            </p>

            <div className="mt-4 flex items-baseline gap-2">
              <span className="text-4xl font-bold text-[#e8c86a]">${price}</span>
              <span className="text-sm text-white/50">for {days} days</span>
            </div>

            <ul className="mt-4 space-y-1.5 text-sm text-white/65">
              {(offer?.specs ?? [
                "Full-screen muted looping video background",
                "1080p MP4, up to 30 seconds",
                "Your link on the “Ad” badge click-through",
              ]).map((s) => (
                <li key={s} className="flex gap-2">
                  <Sparkles className="h-4 w-4 shrink-0 mt-0.5 text-[#c9a84c]" />
                  {s}
                </li>
              ))}
            </ul>

            <form onSubmit={submit} className="mt-5 space-y-3">
              <div>
                <Label htmlFor="sp-name" className="text-white/80">Your name</Label>
                <Input
                  id="sp-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Jane Creator"
                  required
                  maxLength={200}
                  className="mt-1 bg-white/5 border-white/10 focus:border-[#c9a84c]/60 placeholder:text-white/25"
                />
              </div>
              <div>
                <Label htmlFor="sp-email" className="text-white/80">Email</Label>
                <Input
                  id="sp-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  maxLength={320}
                  className="mt-1 bg-white/5 border-white/10 focus:border-[#c9a84c]/60 placeholder:text-white/25"
                />
              </div>
              <div>
                <Label htmlFor="sp-video" className="text-white/80">Video URL</Label>
                <Input
                  id="sp-video"
                  type="url"
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  placeholder="https://…/your-ad.mp4"
                  required
                  maxLength={2000}
                  className="mt-1 bg-white/5 border-white/10 focus:border-[#c9a84c]/60 placeholder:text-white/25"
                />
              </div>
              <div>
                <Label htmlFor="sp-link" className="text-white/80">
                  Link it clicks to <span className="text-white/35">(optional)</span>
                </Label>
                <Input
                  id="sp-link"
                  type="url"
                  value={targetUrl}
                  onChange={(e) => setTargetUrl(e.target.value)}
                  placeholder="https://yourbrand.com"
                  maxLength={2000}
                  className="mt-1 bg-white/5 border-white/10 focus:border-[#c9a84c]/60 placeholder:text-white/25"
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
              <p className="text-center text-xs text-white/35">
                No charge now — we confirm availability and approve your video first.
              </p>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
