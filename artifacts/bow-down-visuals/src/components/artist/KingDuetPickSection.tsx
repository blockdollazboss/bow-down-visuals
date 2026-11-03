import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Crown, AlertTriangle, RotateCcw } from "lucide-react";
import {
  fetchKingDuetRail,
  kingDuetProfileViewState,
  type KingDuetProfileLoadStatus,
  type KingDuetRail,
} from "@/lib/king-duet";

/* ─── The King's featured pick — on the King's profile (ruling #38,
   stack1400) ────────────────────────────────────────────────────────
   The featured duet pick has always lived on /shorts; the ruling
   puts it on the King's own profile too — the profile is the
   website, and everything is linked. The pick is a FAN's duet of
   the King's clip, so it can never ride the King's own video list:
   it gets this dedicated section, fed by the same public rail
   (GET /api/shorts/king-duet through normalizeKingDuetRail) and
   presented in the /shorts section's idiom — thumbnail, the fan
   credited by name with a link to their profile, the clip it duets,
   and the HOUSE PICK stamp.

   Shown ONLY on the official (King's) profile: the parent passes
   isOfficial from profile.is_official, a non-official profile never
   fetches the rail and never renders a shell, and an official
   profile with no pick renders nothing either. A failed load is a
   quiet honest error + retry — never a fake "no pick yet" state.
   Themed head-to-toe in the profile's --ap-* tokens, so it exists
   as a designed surface in both site themes like every other
   profile section. Display only — setting/lifting the pick stays
   the house control on /shorts. */

export default function KingDuetPickSection({ isOfficial }: { isOfficial: boolean }) {
  const [rail, setRail] = useState<KingDuetRail | null>(null);
  const [status, setStatus] = useState<KingDuetProfileLoadStatus>("loading");
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    /* Non-official profiles don't carry this section at all — the
       rail isn't even consulted for them. */
    if (!isOfficial) return;
    let cancelled = false;
    setStatus("loading");
    (async () => {
      try {
        const r = await fetchKingDuetRail();
        if (!cancelled) {
          setRail(r);
          setStatus("ready");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOfficial, retryNonce]);

  const view = kingDuetProfileViewState({
    isOfficial,
    status,
    featuredCount: rail?.featured.length ?? 0,
  });
  if (view === "loading" || view === "hidden") return null;

  if (view === "error") {
    return (
      <section className="ap-section" style={{ padding: "var(--ap-pad)" }} data-testid="king-duet-profile-error">
        <div
          className="flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3"
          style={{ borderColor: "var(--ap-border)", backgroundColor: "var(--ap-card)" }}
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-[#d4af37]" />
          <p className="flex-1 text-sm" style={{ color: "var(--ap-muted)" }}>
            The King&apos;s featured pick couldn&apos;t load.
          </p>
          <button
            type="button"
            onClick={() => setRetryNonce((n) => n + 1)}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-4 py-1.5 text-xs font-bold text-black transition hover:scale-105"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Try again
          </button>
        </div>
      </section>
    );
  }

  const kingName = rail?.king?.display_name ?? "Thy Cheat Code";
  return (
    <section className="ap-section" style={{ padding: "var(--ap-pad)" }} data-testid="king-duet-profile-pick">
      <div className="mb-3 flex items-center gap-2">
        <Crown className="h-5 w-5 text-[#d4af37]" />
        <h2
          className="text-xl font-bold tracking-wide sm:text-2xl"
          style={{ fontFamily: "var(--ap-heading-font)", color: "var(--ap-text)" }}
        >
          The King&apos;s featured pick
        </h2>
      </div>
      <div className="space-y-2">
        {rail!.featured.map((f) => (
          <div
            key={f.id}
            className="rounded-xl border border-[#d4af37]/50 p-3"
            style={{ backgroundColor: "var(--ap-card)" }}
          >
            <div className="flex gap-3">
              <Link
                href={`/shorts?start=${f.id}`}
                className="h-20 w-14 shrink-0 overflow-hidden rounded-lg"
                style={{ backgroundColor: "var(--ap-surface)" }}
              >
                {f.thumbnail_url ? <img src={f.thumbnail_url} alt={f.title} className="h-full w-full object-cover" /> : null}
              </Link>
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold" style={{ color: "var(--ap-text)" }}>{f.title}</p>
                <p className="text-xs" style={{ color: "var(--ap-muted)" }}>
                  duet by{" "}
                  <Link href={`/artist/${f.creator?.slug ?? ""}`} className="font-bold text-[#d4af37] hover:underline">
                    @{f.creator?.display_name ?? "a fan"}
                  </Link>
                  {f.duet_parent ? <> of the King&apos;s “{f.duet_parent.title ?? "clip"}”</> : null}
                </p>
                <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-[#d4af37] px-2 py-0.5 text-[10px] font-black text-black">
                  <Crown className="h-3 w-3" /> HOUSE PICK — {kingName.toUpperCase()}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
