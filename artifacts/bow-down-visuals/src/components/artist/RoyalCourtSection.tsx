import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Crown, AlertTriangle, RotateCcw, Plus } from "lucide-react";
import {
  fetchPublicCourt,
  courtViewState,
  type CourtMember,
  type CourtLoadStatus,
} from "@/lib/royal-court";
import { fetchMyProfile } from "@/lib/artist-profiles";

/* ─── The Royal Court — public profile section ────────────────────────────
   The creator's crowned circle: up to 8 creators in rank order, each a
   gold-framed card linking to their profile. Viewer side renders ONLY
   when populated (an empty Court is not a section). The owner viewing
   their own empty Court gets the "Add your Court" invitation instead.
   A failed load shows its own honest error + retry — never fake-empty. */

export default function RoyalCourtSection({ slug }: { slug: string }) {
  const [members, setMembers] = useState<CourtMember[]>([]);
  const [status, setStatus] = useState<CourtLoadStatus>("loading");
  const [isOwner, setIsOwner] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    (async () => {
      try {
        const court = await fetchPublicCourt(slug);
        if (!cancelled) {
          setMembers(court);
          setStatus("ready");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, retryNonce]);

  /* Owner detection: the signed-in creator's own slug matching this page.
     Anonymous / other creators just get the viewer experience. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mine = await fetchMyProfile();
        if (!cancelled) setIsOwner(!!mine && mine.slug === slug);
      } catch {
        if (!cancelled) setIsOwner(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const view = courtViewState({ status, members, isOwner });
  if (view === "loading" || view === "hidden") return null;

  return (
    <section className="ap-section" style={{ padding: "var(--ap-pad)" }} data-testid="royal-court">
      <div className="mb-3 flex items-center gap-2">
        <Crown className="h-5 w-5 text-[#d4af37]" />
        <h2
          className="text-xl font-bold tracking-wide sm:text-2xl"
          style={{ fontFamily: "var(--ap-heading-font)", color: "var(--ap-text)" }}
        >
          The Royal Court
        </h2>
      </div>

      {view === "error" && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-[#d4af37]/40 bg-black/30 px-4 py-6 text-center">
          <AlertTriangle className="h-6 w-6 text-[#d4af37]" />
          <p className="text-sm" style={{ color: "var(--ap-text)" }}>
            The Royal Court couldn't load right now.
          </p>
          <button
            type="button"
            onClick={() => setRetryNonce((n) => n + 1)}
            className="mt-1 inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-5 py-2 text-xs font-bold text-black transition hover:scale-105"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Try again
          </button>
        </div>
      )}

      {view === "owner-empty" && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-[#d4af37]/50 bg-black/20 px-4 py-6 text-center">
          <Crown className="h-6 w-6 text-[#d4af37]" />
          <p className="text-sm font-semibold" style={{ color: "var(--ap-text)" }}>
            Add your Court
          </p>
          <p className="max-w-sm text-xs" style={{ color: "var(--ap-muted)" }}>
            Crown up to 8 creators you ride with — your circle, ranked, front and center on your page.
          </p>
          <Link
            href="/artist-setup"
            className="mt-1 inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-5 py-2 text-xs font-bold text-black transition hover:scale-105"
          >
            <Plus className="h-3.5 w-3.5" /> Crown your Court
          </Link>
        </div>
      )}

      {view === "cards" && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {members.map((m) => (
            <Link
              key={m.profileId}
              href={m.profileUrl}
              className="group relative rounded-xl border border-[#d4af37]/60 bg-gradient-to-b from-[#d4af37]/15 to-transparent p-[1px] shadow-[0_0_18px_rgba(212,175,55,0.15)] transition hover:scale-[1.03]"
              data-testid="royal-court-card"
            >
              <span className="flex h-full flex-col items-center gap-2 rounded-[11px] px-3 py-4 text-center" style={{ backgroundColor: "var(--ap-card)" }}>
                <span className="absolute left-2 top-2 rounded-full bg-[#d4af37] px-1.5 py-0.5 text-[10px] font-black text-black">
                  #{m.position}
                </span>
                {m.avatarUrl ? (
                  <img
                    src={m.avatarUrl}
                    alt={m.displayName}
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                    className="h-16 w-16 rounded-full border-2 border-[#d4af37] object-cover"
                  />
                ) : (
                  <span className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-[#d4af37] bg-black/40 text-xl font-black text-[#d4af37]">
                    {m.displayName.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <span
                  className="w-full truncate text-sm font-bold"
                  style={{ color: "var(--ap-text)", fontFamily: "var(--ap-heading-font)" }}
                >
                  {m.displayName}
                </span>
                <span className="w-full truncate text-[11px]" style={{ color: "var(--ap-muted)" }}>
                  @{m.slug}
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
