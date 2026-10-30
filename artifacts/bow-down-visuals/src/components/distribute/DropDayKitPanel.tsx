import { plainErrorText } from "../../lib/api-error";
import { useEffect, useState } from "react";
import { Package, Loader2, Check, AlertTriangle, Clapperboard, LayoutTemplate, Timer, MailCheck, ExternalLink } from "lucide-react";

/* ── Drop Day Kit panel (UPGRADE #169) ─────────────────────────────────
   Docked in the release editor on /distribute, under the presave
   actions. ONE TAP assembles the release's Drop Day Kit server-side
   from the release's own art + track: a teaser-short spec, a banner
   set, the countdown bound to the presave page, and the land-time
   fan heads-up riding the presave rail. The kit lands as a DRAFT —
   the creator reviews it here and activates it; activation is
   refused (by the server, named blockers shown) while the release
   has no date or no presave page. Nothing here posts, sends, or
   publishes: the teaser and banners open in Create pre-loaded, and
   the heads-up email is the presave sweeper's, exactly once. */

interface KitTeaser {
  createLink: string;
  durationSec: number;
}
interface KitBanner {
  size: string;
  width: number;
  height: number;
  createLink: string;
}
interface KitView {
  id: string;
  status: string;
  captures: number;
  kit: {
    teaser: KitTeaser | null;
    banners: KitBanner[];
    countdown: { presaveUrl: string | null; releaseDate: string | null };
    missing: string[];
  };
}

type AuthFetch = (path: string, init?: RequestInit) => Promise<Response>;

const MISSING_LABELS: Record<string, string> = {
  audio: "No track audio on the release yet — the teaser needs it",
  artwork: "No cover art on the release yet — the banner set needs it",
  release_date: "No release date set — the countdown needs it",
  presave_page: "No presave page yet — tap “Send to Presave” above first",
};

export function DropDayKitPanel(props: { releaseId: string; authFetch: AuthFetch }) {
  const { releaseId, authFetch } = props;
  const [view, setView] = useState<KitView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [working, setWorking] = useState<"assemble" | "activate" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch(`/api/drop-day-kits/${releaseId}`);
        if (cancelled) return;
        if (res.status === 404) {
          setView(null);
        } else if (res.ok) {
          setView((await res.json()) as KitView);
        }
      } catch {
        /* A failed read just leaves the assemble state — the POST is
           idempotent (one kit per release), so retrying is safe. */
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [releaseId, authFetch]);

  async function assemble() {
    setWorking("assemble");
    setError(null);
    setNotice(null);
    try {
      const res = await authFetch("/api/drop-day-kits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ releaseId }),
      });
      const d = (await res.json().catch(() => null)) as KitView | { error?: string } | null;
      if (!res.ok) throw new Error((d as { error?: string } | null)?.error ?? "Assembly failed");
      setView(d as KitView);
      setNotice("Kit assembled as a draft — review it below, then activate.");
    } catch (e) {
      setError(plainErrorText(e, "Assembly failed"));
    } finally {
      setWorking(null);
    }
  }

  async function activate() {
    setWorking("activate");
    setError(null);
    setNotice(null);
    try {
      const res = await authFetch(`/api/drop-day-kits/${releaseId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      });
      const d = (await res.json().catch(() => null)) as KitView | { error?: string } | null;
      if (!res.ok) throw new Error((d as { error?: string } | null)?.error ?? "Activation failed");
      setView(d as KitView);
      setNotice("Kit is live. On release day, every fan on the presave list gets the heads-up — exactly once.");
    } catch (e) {
      setError(plainErrorText(e, "Activation failed"));
    } finally {
      setWorking(null);
    }
  }

  const goldBtn =
    "inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-bold text-black transition hover:brightness-110 disabled:opacity-50";
  const ghostBtn =
    "inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3.5 py-2 text-xs font-bold text-white/80 transition hover:bg-white/5 disabled:opacity-50";

  return (
    <div className="mt-6 rounded-2xl border border-primary/25 bg-primary/[0.04] p-4 md:p-5" data-testid="drop-day-kit-panel">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/[0.12]">
          <Package className="h-4.5 w-4.5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black text-white">Drop Day Kit</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-white/40">
            One tap assembles the teaser, the banner set, the countdown, and the release-day fan heads-up — from this
            release's own art and track.
          </p>
        </div>
        {view && (
          <span className="shrink-0 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-primary">
            {view.status}
          </span>
        )}
      </div>

      {error && (
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/[0.06] p-3 text-xs text-red-200/85">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}
      {notice && (
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] p-3 text-xs text-emerald-200/85">
          <Check className="h-4 w-4 shrink-0" /> {notice}
        </div>
      )}

      {!loaded ? (
        <p className="mt-3 text-xs text-white/35">Checking for an assembled kit…</p>
      ) : !view ? (
        <div className="mt-4">
          <button type="button" onClick={() => void assemble()} disabled={working !== null} className={goldBtn}>
            {working === "assemble" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Package className="h-4 w-4" />}
            Assemble the Drop Day Kit
          </button>
          <p className="mt-2 text-[11px] text-white/35">
            It lands as a draft for your review — nothing goes live until you activate it.
          </p>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {/* Teaser */}
          <div className="flex items-center gap-3">
            <Clapperboard className="h-4 w-4 shrink-0 text-primary" />
            {view.kit.teaser ? (
              <p className="flex-1 text-xs text-white/70">
                <span className="font-bold text-white">Teaser short</span> — {view.kit.teaser.durationSec}s spec from
                your track + cover art.{" "}
                <a href={view.kit.teaser.createLink} className="font-bold text-primary hover:brightness-110">
                  Open in Create <ExternalLink className="inline h-3 w-3" />
                </a>
              </p>
            ) : (
              <p className="flex-1 text-xs text-white/40">Teaser short — not assembled (no track audio yet).</p>
            )}
          </div>
          {/* Banners */}
          <div className="flex items-center gap-3">
            <LayoutTemplate className="h-4 w-4 shrink-0 text-primary" />
            {view.kit.banners.length > 0 ? (
              <p className="flex-1 text-xs text-white/70">
                <span className="font-bold text-white">Banner set</span> —{" "}
                {view.kit.banners.map((b, i) => (
                  <span key={b.size}>
                    {i > 0 && " · "}
                    <a href={b.createLink} className="font-bold text-primary hover:brightness-110">
                      {b.size} {b.width}×{b.height}
                    </a>
                  </span>
                ))}{" "}
                — each pre-loaded with your cover art.
              </p>
            ) : (
              <p className="flex-1 text-xs text-white/40">Banner set — not assembled (no cover art yet).</p>
            )}
          </div>
          {/* Countdown + heads-up */}
          <div className="flex items-center gap-3">
            <Timer className="h-4 w-4 shrink-0 text-primary" />
            {view.kit.countdown.presaveUrl ? (
              <p className="flex-1 text-xs text-white/70">
                <span className="font-bold text-white">Countdown</span> — live on your{" "}
                <a href={view.kit.countdown.presaveUrl} className="font-bold text-primary hover:brightness-110">
                  presave page
                </a>
                {view.kit.countdown.releaseDate ? `, counting down to ${view.kit.countdown.releaseDate}.` : "."}
              </p>
            ) : (
              <p className="flex-1 text-xs text-white/40">Countdown — waiting on a presave page.</p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <MailCheck className="h-4 w-4 shrink-0 text-primary" />
            <p className="flex-1 text-xs text-white/70">
              <span className="font-bold text-white">Fan heads-up</span> — {view.captures}{" "}
              {view.captures === 1 ? "fan" : "fans"} on the presave list get one email the moment the release lands.
              Never twice, never early.
            </p>
          </div>

          {view.kit.missing.length > 0 && (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <p className="text-[11px] font-bold uppercase tracking-widest text-white/40">Still missing</p>
              <ul className="mt-1.5 space-y-1">
                {view.kit.missing.map((m) => (
                  <li key={m} className="text-xs text-white/55">
                    {MISSING_LABELS[m] ?? m}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            {view.status === "draft" && (
              <button type="button" onClick={() => void activate()} disabled={working !== null} className={goldBtn}>
                {working === "activate" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Activate the kit
              </button>
            )}
            <button type="button" onClick={() => void assemble()} disabled={working !== null} className={ghostBtn}>
              {working === "assemble" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Package className="h-4 w-4" />}
              Re-assemble
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
