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

/* ─── The Front Row — public profile section ──────────────────────────────
   The creator's chosen circle: up to 8 creators in rank order, seated
   under the Stage in the Grand Stage composition — the #1 seat front
   and center in a full-width featured card, the rest of the row beneath
   it, each card linking to that creator's profile. Viewer side renders
   ONLY when populated (an empty Front Row is not a section). The owner
   viewing their own empty Front Row gets the invitation instead. A
   failed load shows its own honest error + retry — never fake-empty.
   (Renamed from "The Royal Court" by the owner's pick, Oct 16 — the
   internal identifiers keep the court name; everything a person reads
   says The Front Row.) */

export default function RoyalCourtSection({
  slug,
  title = "The Front Row",
}: {
  slug: string;
  title?: string;
}) {
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

  const [featured, ...row] = members;

  return (
    <section className="ap-section" style={{ padding: "var(--ap-pad)" }} data-testid="front-row">
      <div className="mb-3 flex items-center gap-2">
        <Crown className="h-5 w-5" style={{ color: "var(--ap-primary)" }} />
        <h2
          className="text-xl font-bold tracking-wide sm:text-2xl"
          style={{ fontFamily: "var(--ap-heading-font)", color: "var(--ap-text)" }}
        >
          {title}
        </h2>
      </div>

      {view === "error" && (
        <div
          className="flex flex-col items-center gap-2 rounded-xl px-4 py-6 text-center"
          style={{ border: "1px solid var(--ap-border)", backgroundColor: "var(--ap-card)" }}
        >
          <AlertTriangle className="h-6 w-6" style={{ color: "var(--ap-primary)" }} />
          <p className="text-sm" style={{ color: "var(--ap-text)" }}>
            The Front Row couldn't load right now.
          </p>
          <button
            type="button"
            onClick={() => setRetryNonce((n) => n + 1)}
            className="mt-1 inline-flex items-center gap-2 rounded-full px-5 py-2 text-xs font-bold text-black transition hover:scale-105"
            style={{ backgroundColor: "var(--ap-primary)" }}
          >
            <RotateCcw className="h-3.5 w-3.5" /> Try again
          </button>
        </div>
      )}

      {view === "owner-empty" && (
        <div
          className="flex flex-col items-center gap-2 rounded-xl px-4 py-6 text-center"
          style={{ border: "1px dashed var(--ap-primary)", backgroundColor: "var(--ap-card)" }}
        >
          <Crown className="h-6 w-6" style={{ color: "var(--ap-primary)" }} />
          <p className="text-sm font-semibold" style={{ color: "var(--ap-text)" }}>
            Fill your Front Row
          </p>
          <p className="max-w-sm text-xs" style={{ color: "var(--ap-muted)" }}>
            Seat up to 8 creators you ride with — your people, ranked, front and center under your stage.
          </p>
          <Link
            href="/artist-setup"
            className="mt-1 inline-flex items-center gap-2 rounded-full px-5 py-2 text-xs font-bold text-black transition hover:scale-105"
            style={{ backgroundColor: "var(--ap-primary)" }}
          >
            <Plus className="h-3.5 w-3.5" /> Build your Front Row
          </Link>
        </div>
      )}

      {view === "cards" && featured && (
        <div className="space-y-3">
          {/* The #1 seat — front and center. */}
          <Link
            href={featured.profileUrl}
            className="group relative block overflow-hidden rounded-2xl p-[1.5px] transition hover:scale-[1.01]"
            style={{
              background: "linear-gradient(135deg, var(--ap-primary), transparent 55%, var(--ap-primary))",
              boxShadow: "0 0 28px rgba(201,168,76,0.22)",
            }}
            data-testid="front-row-featured"
          >
            <span
              className="flex items-center gap-4 rounded-[15px] px-5 py-5 sm:gap-6 sm:px-8"
              style={{ backgroundColor: "var(--ap-card)" }}
            >
              {featured.avatarUrl ? (
                <img
                  src={featured.avatarUrl}
                  alt={featured.displayName}
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                  className="h-20 w-20 shrink-0 rounded-full object-cover sm:h-24 sm:w-24"
                  style={{ border: "3px solid var(--ap-primary)" }}
                />
              ) : (
                <span
                  className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full text-3xl font-black sm:h-24 sm:w-24"
                  style={{ border: "3px solid var(--ap-primary)", color: "var(--ap-primary)", backgroundColor: "var(--ap-surface)" }}
                >
                  {featured.displayName.slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className="min-w-0">
                <span
                  className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.25em]"
                  style={{ color: "var(--ap-primary)" }}
                >
                  <Crown className="h-3.5 w-3.5" /> #1 in the Front Row
                </span>
                <span
                  className="mt-1 block truncate text-2xl font-bold sm:text-3xl"
                  style={{ color: "var(--ap-text)", fontFamily: "var(--ap-heading-font)" }}
                >
                  {featured.displayName}
                </span>
                <span className="block truncate text-sm" style={{ color: "var(--ap-muted)" }}>
                  @{featured.slug}
                </span>
              </span>
            </span>
          </Link>

          {/* The rest of the row. */}
          {row.length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {row.map((m) => (
                <Link
                  key={m.profileId}
                  href={m.profileUrl}
                  className="group relative rounded-xl p-[1px] transition hover:scale-[1.03]"
                  style={{
                    background: "linear-gradient(to bottom, var(--ap-primary), transparent)",
                    opacity: 0.95,
                  }}
                  data-testid="front-row-card"
                >
                  <span
                    className="flex h-full flex-col items-center gap-2 rounded-[11px] px-3 py-4 text-center"
                    style={{ backgroundColor: "var(--ap-card)" }}
                  >
                    <span
                      className="absolute left-2 top-2 rounded-full px-1.5 py-0.5 text-[10px] font-black text-black"
                      style={{ backgroundColor: "var(--ap-primary)" }}
                    >
                      #{m.position}
                    </span>
                    {m.avatarUrl ? (
                      <img
                        src={m.avatarUrl}
                        alt={m.displayName}
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                        }}
                        className="h-16 w-16 rounded-full object-cover"
                        style={{ border: "2px solid var(--ap-primary)" }}
                      />
                    ) : (
                      <span
                        className="flex h-16 w-16 items-center justify-center rounded-full text-xl font-black"
                        style={{ border: "2px solid var(--ap-primary)", color: "var(--ap-primary)", backgroundColor: "var(--ap-surface)" }}
                      >
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
        </div>
      )}
    </section>
  );
}
