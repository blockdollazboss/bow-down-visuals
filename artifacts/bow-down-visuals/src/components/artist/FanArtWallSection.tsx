import { plainErrorText } from "../../lib/api-error";
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Image as ImageIcon, AlertTriangle, RotateCcw, Send, CheckCircle2, Clock } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { fetchMyProfile } from "@/lib/artist-profiles";
import {
  fetchPublicFanArtWall,
  fetchMyFanArtSubmissions,
  submitFanArtPiece,
  fanArtWallViewState,
  fanArtStatusLabel,
  type FanArtPieceDto,
  type FanArtLoadStatus,
} from "@/lib/profile-website";
import { ReportButton } from "@/components/social/ReportButton";

/* ─── Fan Art Wall — public profile Gallery block (Stack-200 #157) ──────
   Fan-submitted art, CREATOR-APPROVED per piece, displayed in the
   profile's Gallery block. The server only ever sends approved pieces
   to this endpoint, so what renders here IS the wall — pending art has
   no path onto it. Every piece carries its artist's credit by
   construction (name always; profile link while their page is public).

   The submit door docks in the same block: a signed-in fan who isn't
   the profile owner can offer a piece; it is born PENDING and the form
   says so plainly — nothing appears until the creator approves that
   exact piece. The fan's own submissions ride under the wall with
   their live status. Reports reuse the shared member report rail
   (ReportButton, target "fan_art") — no second moderation system.
   Submitting and displaying are free: no price exists on this surface. */

function PieceCard({ piece }: { piece: FanArtPieceDto }) {
  return (
    <figure
      className="overflow-hidden rounded-xl"
      style={{ border: "1px solid var(--ap-border)", backgroundColor: "var(--ap-card)" }}
      data-testid="fan-art-piece"
    >
      <img
        src={piece.imageUrl}
        alt={`${piece.title} — fan art by ${piece.artistName}`}
        className="aspect-square w-full object-cover"
        loading="lazy"
      />
      <figcaption className="px-3 py-2.5">
        <p className="truncate text-sm font-semibold" style={{ color: "var(--ap-text)" }} title={piece.title}>
          {piece.title}
        </p>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs" style={{ color: "var(--ap-muted)" }}>
          <span>by</span>
          {piece.artistSlug ? (
            <Link
              href={`/artist/${piece.artistSlug}`}
              className="inline-flex items-center gap-1.5 font-semibold hover:underline"
              style={{ color: "var(--ap-text)" }}
            >
              {piece.artistAvatarUrl && (
                <img src={piece.artistAvatarUrl} alt="" className="h-4 w-4 rounded-full object-cover" />
              )}
              {piece.artistName}
            </Link>
          ) : (
            <span className="font-semibold" style={{ color: "var(--ap-text)" }}>
              {piece.artistName}
            </span>
          )}
          <span className="ml-auto">
            <ReportButton targetType="fan_art" targetId={piece.id} variant="icon" />
          </span>
        </p>
        {piece.note && (
          <p className="mt-1 line-clamp-2 text-xs italic" style={{ color: "var(--ap-muted)" }}>
            “{piece.note}”
          </p>
        )}
      </figcaption>
    </figure>
  );
}

export default function FanArtWallSection({
  slug,
  title = "Gallery",
  creatorName,
}: {
  slug: string;
  title?: string;
  creatorName: string;
}) {
  const { user } = useAuth();
  const [pieces, setPieces] = useState<FanArtPieceDto[]>([]);
  const [status, setStatus] = useState<FanArtLoadStatus>("loading");
  const [isOwner, setIsOwner] = useState(false);
  const [mine, setMine] = useState<FanArtPieceDto[]>([]);
  const [retryNonce, setRetryNonce] = useState(0);

  /* Submit form state */
  const [formOpen, setFormOpen] = useState(false);
  const [artTitle, setArtTitle] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [justSent, setJustSent] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    (async () => {
      try {
        const wall = await fetchPublicFanArtWall(slug);
        if (!cancelled) {
          setPieces(wall.pieces);
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mineProfile = await fetchMyProfile();
        if (!cancelled) setIsOwner(!!mineProfile && mineProfile.slug === slug);
      } catch {
        if (!cancelled) setIsOwner(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  /* The signed-in fan's own pieces on this wall, with live status. */
  useEffect(() => {
    if (!user || isOwner) return;
    let cancelled = false;
    (async () => {
      try {
        const all = await fetchMyFanArtSubmissions();
        if (!cancelled) setMine(all.filter((p) => p.creatorSlug === slug));
      } catch {
        /* the status strip is a courtesy — the wall itself already loaded */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, isOwner, slug, justSent]);

  const view = fanArtWallViewState({ status, count: pieces.length, isOwner });
  if (view === "loading") return null;
  /* A visitor-empty wall hides ONLY when there's no door to show: a
     signed-in fan still gets the submit invitation below. */
  if (view === "hidden" && !user) return null;

  async function send() {
    setSending(true);
    setFormError(null);
    try {
      const piece = await submitFanArtPiece(slug, {
        title: artTitle,
        imageUrl,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setMine((prev) => [piece, ...prev]);
      setArtTitle("");
      setImageUrl("");
      setNote("");
      setFormOpen(false);
      setJustSent(true);
    } catch (e) {
      setFormError(plainErrorText(e, "Couldn't send your piece. Please try again."));
    } finally {
      setSending(false);
    }
  }

  const inputCls =
    "w-full rounded-lg px-3 py-2 text-sm outline-none";
  const inputStyle = {
    border: "1px solid var(--ap-border)",
    backgroundColor: "var(--ap-bg)",
    color: "var(--ap-text)",
  } as const;

  return (
    <section className="ap-section" style={{ padding: "var(--ap-pad)" }} data-testid="profile-fan-art-wall">
      <div className="mb-3 flex items-center gap-2">
        <ImageIcon className="h-5 w-5" style={{ color: "var(--ap-primary)" }} />
        <h2
          className="text-xl font-bold tracking-wide sm:text-2xl"
          style={{ fontFamily: "var(--ap-heading-font)", color: "var(--ap-text)" }}
        >
          {title}
        </h2>
        <span className="text-xs font-semibold" style={{ color: "var(--ap-muted)" }}>
          Fan art — approved by {creatorName}
        </span>
      </div>

      {view === "error" && (
        <div
          className="flex flex-col items-center gap-2 rounded-xl px-4 py-6 text-center"
          style={{ border: "1px solid var(--ap-border)", backgroundColor: "var(--ap-card)" }}
        >
          <AlertTriangle className="h-6 w-6" style={{ color: "var(--ap-primary)" }} />
          <p className="text-sm" style={{ color: "var(--ap-text)" }}>
            The fan art wall couldn't load right now.
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
          <ImageIcon className="h-6 w-6" style={{ color: "var(--ap-primary)" }} />
          <p className="text-sm font-semibold" style={{ color: "var(--ap-text)" }}>
            Your fan art wall is waiting for its first piece
          </p>
          <p className="max-w-sm text-xs" style={{ color: "var(--ap-muted)" }}>
            When a fan submits art for you, it lands in your review queue in your page setup — nothing
            shows here until you approve that exact piece, and you can take any piece down at any time.
          </p>
          <Link
            href="/artist-setup"
            className="mt-1 inline-flex items-center gap-2 rounded-full px-5 py-2 text-xs font-bold text-black transition hover:scale-105"
            style={{ backgroundColor: "var(--ap-primary)" }}
          >
            Review fan art
          </Link>
        </div>
      )}

      {view === "wall" && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {pieces.map((p) => (
            <PieceCard key={p.id} piece={p} />
          ))}
        </div>
      )}

      {/* The fan's own submissions on this wall — status is always
          visible to the artist, credit attached. */}
      {user && !isOwner && mine.length > 0 && (
        <div className="mt-4 space-y-1.5" data-testid="fan-art-mine">
          {mine.map((p) => (
            <p key={p.id} className="flex items-center gap-2 text-xs" style={{ color: "var(--ap-muted)" }}>
              {p.status === "approved" ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
              ) : (
                <Clock className="h-3.5 w-3.5 shrink-0" />
              )}
              <span className="font-semibold" style={{ color: "var(--ap-text)" }}>
                “{p.title}”
              </span>
              — {fanArtStatusLabel(p.status)}
            </p>
          ))}
        </div>
      )}

      {justSent && (
        <p className="mt-3 flex items-center gap-2 text-xs font-semibold text-emerald-500" role="status">
          <CheckCircle2 className="h-4 w-4" />
          Sent! Your piece is with {creatorName} now — it joins the wall only if they approve it.
        </p>
      )}

      {/* Submit door — signed-in fans only, never the owner (their own
          work belongs in their own sections). */}
      {user && !isOwner && view !== "error" && (
        <div className="mt-4">
          {!formOpen ? (
            <button
              type="button"
              onClick={() => setFormOpen(true)}
              className="inline-flex items-center gap-2 rounded-full px-5 py-2 text-xs font-bold text-black transition hover:scale-105"
              style={{ backgroundColor: "var(--ap-primary)" }}
              data-testid="fan-art-submit-open"
            >
              <Send className="h-3.5 w-3.5" /> Submit fan art for {creatorName}
            </button>
          ) : (
            <form
              className="space-y-2 rounded-xl p-4"
              style={{ border: "1px solid var(--ap-border)", backgroundColor: "var(--ap-card)" }}
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <p className="text-xs" style={{ color: "var(--ap-muted)" }}>
                Your piece goes to {creatorName} for review first — it appears on this wall only if
                they approve it. Your name rides on the piece as its artist, always. Submitting is free.
              </p>
              <div>
                <label className="mb-1 block text-xs font-semibold" style={{ color: "var(--ap-text)" }} htmlFor="fan-art-title">
                  Title
                </label>
                <input
                  id="fan-art-title"
                  value={artTitle}
                  onChange={(e) => setArtTitle(e.target.value)}
                  maxLength={120}
                  required
                  placeholder="Name your piece"
                  className={inputCls}
                  style={inputStyle}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold" style={{ color: "var(--ap-text)" }} htmlFor="fan-art-url">
                  Artwork link
                </label>
                <input
                  id="fan-art-url"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  required
                  inputMode="url"
                  placeholder="https://… link to your artwork image"
                  className={inputCls}
                  style={inputStyle}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold" style={{ color: "var(--ap-text)" }} htmlFor="fan-art-note">
                  Note for {creatorName} (optional)
                </label>
                <textarea
                  id="fan-art-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={500}
                  rows={2}
                  placeholder="What inspired it?"
                  className={inputCls}
                  style={inputStyle}
                />
              </div>
              {formError && (
                <p className="text-xs font-semibold text-red-500" role="alert">
                  {formError}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={sending}
                  className="inline-flex items-center gap-2 rounded-full px-5 py-2 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-60"
                  style={{ backgroundColor: "var(--ap-primary)" }}
                >
                  <Send className="h-3.5 w-3.5" /> {sending ? "Sending…" : "Send for approval"}
                </button>
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="rounded-full px-4 py-2 text-xs font-semibold"
                  style={{ border: "1px solid var(--ap-border)", color: "var(--ap-text)" }}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {!user && view !== "error" && (
        <p className="mt-3 text-xs" style={{ color: "var(--ap-muted)" }}>
          <Link href="/login" className="font-semibold hover:underline" style={{ color: "var(--ap-text)" }}>
            Sign in
          </Link>{" "}
          to submit your own fan art for {creatorName}.
        </p>
      )}
    </section>
  );
}
