import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  AlertTriangle, Bookmark, BookmarkX, Clapperboard, Compass, Loader2, Music2, RotateCcw,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { apiFetch, apiJson, type FeedPost, type SocialAuthor } from "@/lib/social-api";
import { Avatar } from "@/components/social/Avatar";
import {
  SAVES_PATH, SAVE_KINDS, SAVE_KIND_LABELS, saveDeletePath, savesOfResponse,
  type SaveKind,
} from "@/lib/world/saved-desk";

/* ─── Saved — the member's bookmark shelf, docked in the Library ──────
   Stack-100 A16. The saves store already had three readers — the
   /saved page, the World SavedDesk, and this panel makes the Library
   the fourth: the Library is the collection home, so the things a
   member bookmarked across the site (posts, sounds, videos, creators)
   belong on its shelf, not only behind the /saved door (which stays).

   Same rail as every other reader (GET /api/saves/mine, FREE), same
   path/delete builders as the World desk (lib/world/saved-desk) so
   the surfaces can never drift apart, and the response is validated
   by the shared savesOfResponse: a malformed payload is a LOAD
   FAILURE with Retry — never an empty shelf dressed up as "nothing
   saved" (the empty-lie family). A save whose thing has gone or
   turned private since (the rail embeds null on purpose) renders as
   an honest "gone" row whose Unsave still works, so the shelf can
   always be cleaned. Unsave is optimistic and restored whole if the
   rail refuses. */

interface RawSave {
  kind: string;
  target_id: string;
  saved_at: string;
  post?: FeedPost | null;
  profile?: SocialAuthor | null;
  track?: { id: string; title: string; artwork_url: string | null; profile_id: string } | null;
  video?: { id: string; title: string; thumbnail_url: string | null; profile_id: string } | null;
}

type SavedFilter = "all" | SaveKind;

export default function SavedPanel({ onCountChange }: { onCountChange?: (n: number) => void }) {
  const { t } = useTranslation();
  const isLight = useIsLightTheme();
  const { user, getAccessToken } = useAuth();
  const [items, setItems] = useState<RawSave[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /* The failure state carries a working Retry: bumping the nonce
     re-runs the load instead of leaving a reload as the only way back. */
  const [retryNonce, setRetryNonce] = useState(0);
  const [filter, setFilter] = useState<SavedFilter>("all");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setItems([]);
      return;
    }
    let alive = true;
    setError(null);
    (async () => {
      try {
        const data = await apiJson<{ saves: RawSave[] }>(getAccessToken, SAVES_PATH);
        /* Shared validation: a payload that isn't a saves list is a
           failure, not an empty shelf. Rows the validator drops
           (kind outside the enum, no target id) never render. */
        const parsed = savesOfResponse(data);
        if (!parsed) throw new Error("malformed saves payload");
        if (!alive) return;
        const accepted = new Set(parsed.map((p) => `${p.kind}:${p.targetId}`));
        const rows = (Array.isArray(data.saves) ? data.saves : []).filter((r) =>
          accepted.has(`${r.kind}:${r.target_id}`),
        );
        setItems(rows);
        onCountChange?.(rows.length);
      } catch {
        if (alive) {
          setError(t("library.savedError", { defaultValue: "Your saved items couldn't load just now — your bookmarks are safe, this page just couldn't reach them." }));
        }
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, getAccessToken, retryNonce]);

  const counts = useMemo(() => {
    const c: Record<SaveKind, number> = { post: 0, track: 0, video: 0, profile: 0 };
    for (const item of items ?? []) {
      if ((SAVE_KINDS as readonly string[]).includes(item.kind)) c[item.kind as SaveKind] += 1;
    }
    return c;
  }, [items]);

  const visible = useMemo(
    () => (items ?? []).filter((s) => filter === "all" || s.kind === filter),
    [items, filter],
  );

  async function unsave(item: RawSave) {
    const key = `${item.kind}:${item.target_id}`;
    if (busyKey) return;
    setBusyKey(key);
    setNote(null);
    /* Optimistic removal, restored whole if the rail refuses. */
    setItems((prev) => {
      const next = (prev ?? []).filter((x) => !(x.kind === item.kind && x.target_id === item.target_id));
      onCountChange?.(next.length);
      return next;
    });
    try {
      const res = await apiFetch(getAccessToken, saveDeletePath(item.kind as SaveKind, item.target_id), {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("unsave failed");
    } catch {
      setNote(t("library.savedUnsaveFailed", { defaultValue: "That unsave didn't land — the item is back on your shelf. Try again in a moment." }));
      setRetryNonce((n) => n + 1);
    } finally {
      setBusyKey(null);
    }
  }

  const cardCls = isLight ? "border-[#C9A84C]/40 bg-[#FCF7EA]" : "border-white/10 bg-black/40";
  const subCls = isLight ? "text-black/50" : "text-white/40";
  const chipCls = (active: boolean) =>
    `shrink-0 rounded-full border px-4 py-1.5 text-sm font-semibold transition ${
      active
        ? "border-[#c9a84c] bg-[#c9a84c] text-black"
        : isLight
          ? "border-black/15 text-black/60 hover:border-[#c9a84c]/60 hover:text-black"
          : "border-white/10 text-white/60 hover:border-[#c9a84c]/40 hover:text-white"
    }`;

  if (!user) {
    return (
      <div className="py-16 text-center">
        <Bookmark className="mx-auto h-10 w-10 text-white/25" />
        <p className="mt-4 text-sm text-white/50">
          {t("library.savedSignIn", { defaultValue: "Sign in to see everything you've saved — posts, sounds, videos, and creators live here." })}
        </p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="py-16 text-center" data-testid="library-saved-error">
        <AlertTriangle className="mx-auto h-10 w-10 text-[#d4af37]" />
        <p className="mt-3 text-sm text-red-300" role="alert">{error}</p>
        <button
          type="button"
          onClick={() => setRetryNonce((n) => n + 1)}
          className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#c9a84c] px-6 py-2.5 text-sm font-bold text-black hover:brightness-110"
        >
          <RotateCcw className="h-4 w-4" />
          {t("library.savedRetry", { defaultValue: "Try again" })}
        </button>
      </div>
    );
  }
  if (items === null) {
    return (
      <div className="flex justify-center py-16" data-testid="library-saved-loading">
        <Loader2 className="h-8 w-8 animate-spin text-amber-400" />
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="py-16 text-center" data-testid="library-saved-empty">
        <Bookmark className="mx-auto h-10 w-10 text-white/25" />
        <p className="mt-4 font-bold">
          {t("library.savedEmptyTitle", { defaultValue: "Nothing saved yet" })}
        </p>
        <p className="mx-auto mt-1.5 max-w-sm text-sm text-white/50">
          {t("library.savedEmpty", { defaultValue: "Tap the bookmark on any post, sound, video, or creator to stash it here." })}
        </p>
        <Link
          href="/explore"
          data-testid="library-saved-explore-door"
          className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#c9a84c] px-6 py-2.5 text-sm font-bold text-black hover:brightness-110"
        >
          <Compass className="h-4 w-4" />
          {t("library.savedExplore", { defaultValue: "Explore what's out there" })}
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl" data-testid="library-saved">
      <div className="mb-5 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Saved kinds">
        <button type="button" role="tab" aria-selected={filter === "all"} onClick={() => setFilter("all")} className={chipCls(filter === "all")}>
          {t("library.savedFilterAll", { defaultValue: "All" })} ({items.length})
        </button>
        {SAVE_KINDS.map((kind) => (
          <button
            key={kind} type="button" role="tab" aria-selected={filter === kind}
            onClick={() => setFilter(kind)} className={chipCls(filter === kind)}
          >
            {SAVE_KIND_LABELS[kind]} ({counts[kind]})
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className={`py-10 text-center text-sm ${subCls}`} data-testid="library-saved-filter-empty">
          {t("library.savedFilterEmpty", {
            defaultValue: "Nothing saved under {{label}} yet.",
            label: filter === "all" ? "" : SAVE_KIND_LABELS[filter as SaveKind],
          })}
        </p>
      ) : (
        <div className="space-y-3">
          {visible.map((item) => (
            <SavedRow
              key={`${item.kind}:${item.target_id}`}
              item={item}
              cardCls={cardCls}
              subCls={subCls}
              busy={busyKey === `${item.kind}:${item.target_id}`}
              anyBusy={busyKey !== null}
              onUnsave={() => void unsave(item)}
              t={t}
            />
          ))}
        </div>
      )}
      {note ? (
        <p className={`mt-4 text-center text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`} role="alert">
          {note}
        </p>
      ) : null}
    </div>
  );
}

/* ─── One shelf row ───────────────────────────────────────────────────
   The row's body is the door to the thing itself; a save whose thing
   has gone renders the honest "gone" body with no door. Unsave sits
   outside the door so it never navigates. */
function SavedRow({ item, cardCls, subCls, busy, anyBusy, onUnsave, t }: {
  item: RawSave;
  cardCls: string;
  subCls: string;
  busy: boolean;
  anyBusy: boolean;
  onUnsave: () => void;
  t: (k: string, o?: any) => string;
}) {
  const savedDate = item.saved_at ? new Date(item.saved_at).toLocaleDateString() : "";
  const unsaveBtn = (
    <button
      type="button"
      onClick={onUnsave}
      disabled={anyBusy}
      data-testid={`library-saved-unsave-${item.kind}-${item.target_id}`}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 px-3.5 py-2 text-xs font-bold text-white/60 transition hover:border-[#c9a84c]/50 hover:text-white disabled:opacity-50"
    >
      <BookmarkX className="h-3.5 w-3.5" />
      {busy
        ? t("library.savedUnsaving", { defaultValue: "Unsaving…" })
        : t("library.savedUnsave", { defaultValue: "Unsave" })}
    </button>
  );

  /* The media/avatar sits OUTSIDE the text door: Avatar carries its
     own profile link, and anchors never nest. */
  let body: React.ReactNode;
  if (item.kind === "post" && item.post) {
    body = (
      <span className="flex min-w-0 flex-1 items-center gap-3">
        <Avatar author={item.post.author} size={48} />
        <Link href={`/post/${item.post.id}`} className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold">
            {item.post.author?.display_name ?? t("library.savedPostFallback", { defaultValue: "Post" })}
          </span>
          <span className="block truncate text-xs text-white/45">{item.post.body}</span>
          <span className={`mt-0.5 block text-[11px] ${subCls}`}>
            {t("library.savedKindPost", { defaultValue: "Post" })}{savedDate ? ` · ${savedDate}` : ""}
          </span>
        </Link>
      </span>
    );
  } else if (item.kind === "profile" && item.profile) {
    body = (
      <span className="flex min-w-0 flex-1 items-center gap-3">
        <Avatar author={item.profile} size={48} />
        <Link href={`/artist/${item.profile.slug}`} className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold">{item.profile.display_name}</span>
          <span className={`mt-0.5 block text-[11px] ${subCls}`}>
            @{item.profile.slug} · {t("library.savedKindProfile", { defaultValue: "Creator" })}{savedDate ? ` · ${savedDate}` : ""}
          </span>
        </Link>
      </span>
    );
  } else if (item.kind === "track" && item.track) {
    body = (
      <Link href={`/track/${item.track.id}`} className="flex min-w-0 flex-1 items-center gap-3">
        {item.track.artwork_url ? (
          <img src={item.track.artwork_url} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" loading="lazy" />
        ) : (
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[#c9a84c]/15">
            <Music2 className="h-6 w-6 text-[#e8c86a]" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold">{item.track.title}</span>
          <span className={`mt-0.5 block text-[11px] ${subCls}`}>
            {t("library.savedKindTrack", { defaultValue: "Sound" })}{savedDate ? ` · ${savedDate}` : ""}
          </span>
        </span>
      </Link>
    );
  } else if (item.kind === "video" && item.video) {
    body = (
      <Link href={`/watch/${item.video.id}`} className="flex min-w-0 flex-1 items-center gap-3">
        {item.video.thumbnail_url ? (
          <img src={item.video.thumbnail_url} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" loading="lazy" />
        ) : (
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[#c9a84c]/15">
            <Clapperboard className="h-6 w-6 text-[#e8c86a]" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold">{item.video.title}</span>
          <span className={`mt-0.5 block text-[11px] ${subCls}`}>
            {t("library.savedKindVideo", { defaultValue: "Video" })}{savedDate ? ` · ${savedDate}` : ""}
          </span>
        </span>
      </Link>
    );
  } else {
    /* The rail embeds null when the thing has gone or become
       invisible since the save — say so plainly, keep Unsave. */
    body = (
      <span className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-white/5">
          <Bookmark className="h-6 w-6 text-white/30" />
        </span>
        <span className={`min-w-0 flex-1 text-sm ${subCls}`}>
          {t("library.savedGone", {
            defaultValue: "This {{kind}} isn't available anymore — it has gone or been made private since you saved it.",
            kind: item.kind,
          })}
        </span>
      </span>
    );
  }

  return (
    <div className={`flex items-center gap-3 rounded-2xl border p-4 ${cardCls}`} data-testid={`library-saved-item-${item.kind}-${item.target_id}`}>
      {body}
      {unsaveBtn}
    </div>
  );
}
