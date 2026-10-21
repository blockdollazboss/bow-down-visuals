import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Home, ArrowRight, X, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";

/* ── Move Home dashboard dock ───────────────────────────────────────────
   The concierge's front door on the dashboard: shows the resumable
   checklist progress and links into /move-home. Hides itself when the
   move is complete, and respects a 7-day dismissal. The checklist's
   truth lives server-side (GET /api/move-home) — this card only reads. */

interface MoveHomeStatusLite {
  steps: Array<{ status: string }>;
  completedAt: string | null;
}

const DISMISS_KEY = "bdv_move_home_dismissed_at";
const DISMISS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function MoveHomeCard() {
  const isLight = useIsLightTheme();
  const { user, getAccessToken } = useAuth();
  const [status, setStatus] = useState<MoveHomeStatusLite | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!user) return;
    try {
      const at = Number(localStorage.getItem(DISMISS_KEY) ?? "0");
      if (at && Date.now() - at < DISMISS_WINDOW_MS) {
        setDismissed(true);
        return;
      }
    } catch {
      /* private mode — the card just shows */
    }
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/move-home", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) return;
        const d = (await res.json()) as { moveHome?: MoveHomeStatusLite };
        if (!cancelled && d.moveHome) setStatus(d.moveHome);
      } catch {
        /* a failed read hides the card — never breaks the dashboard */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, getAccessToken]);

  if (!user || dismissed || !status || status.completedAt) return null;

  const done = status.steps.filter((s) => s.status === "approved" || s.status === "skipped").length;
  const started = status.steps.some((s) => s.status !== "pending");

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* noop */
    }
    setDismissed(true);
  };

  return (
    <div
      data-testid="move-home-card"
      className={`relative rounded-2xl border p-5 ${
        isLight ? "border-[#C9A84C]/50 bg-[#F7ECD2]" : "border-primary/25 bg-zinc-950"
      }`}
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss for now"
        className={`absolute right-3 top-3 rounded-full p-1 transition-colors ${
          isLight ? "text-zinc-500 hover:text-zinc-800" : "text-zinc-500 hover:text-zinc-200"
        }`}
      >
        <X className="h-4 w-4" />
      </button>
      <div className="flex items-start gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 border border-primary/25">
          <Home className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1 pr-6">
          <h3 className={`text-base font-black ${isLight ? "text-zinc-900" : "text-white"}`}>
            Move Home — your business lives here
          </h3>
          <p className={`mt-1 text-sm ${isLight ? "text-zinc-600" : "text-zinc-400"}`}>
            {started
              ? "Your move is in progress — pick it up exactly where you left it. Thy Cheat Code drafts each piece; nothing goes live until you approve it."
              : "Thy Cheat Code drafts your profile, starter store, press kit, email list, and launch posts from your work and your connected socials — you approve each piece before anything goes live. Free."}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Link
              href="/move-home"
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-black transition-opacity hover:opacity-90"
            >
              {started ? "Continue your move" : "Start the move"}
              <ArrowRight className="h-4 w-4" />
            </Link>
            <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${isLight ? "text-zinc-600" : "text-zinc-400"}`}>
              <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
              {done} of {status.steps.length} steps done
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
