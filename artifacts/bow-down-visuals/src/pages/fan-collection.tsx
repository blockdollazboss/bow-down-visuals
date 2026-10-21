import { useEffect, useState } from "react";
import { useRoute, Link } from "wouter";
import { Loader2, AlertTriangle, RotateCcw, Lock, ShoppingBag, Music2, Clapperboard, Package } from "lucide-react";
import { usePageTitle } from "@/hooks/use-page-title";
import {
  fetchPublicCollection,
  fetchMyCollection,
  saveMyCollectionVisibility,
  collectionViewState,
  collectionMoney,
  type FanCollection,
  type CollectionLoadStatus,
} from "@/lib/profile-website";
import { fetchMyProfile } from "@/lib/artist-profiles";

/* ─── Fan collection — /collection/:slug (Stack 3, item 6) ──────────────
   The fan side of the loop: a public page showing what a fan has
   bought (music + store purchases) — social proof that real fans buy
   real work here. Privacy is part of the build: the fan's collection
   visibility setting (default public, like the house's other public
   surfaces) gates the page; a private collection shows an honest
   "this collection is private" state and nothing else. The owner
   viewing their own page always sees their collection, plus the
   visibility toggle. */

const KIND_ICON = { track: Music2, video: Clapperboard, product: Package } as const;

export default function FanCollectionPage() {
  const [, params] = useRoute("/collection/:slug");
  const slug = params?.slug ?? "";
  const [collection, setCollection] = useState<FanCollection | null>(null);
  const [status, setStatus] = useState<CollectionLoadStatus>("loading");
  const [retryNonce, setRetryNonce] = useState(0);
  const [isOwner, setIsOwner] = useState(false);
  const [savingVisibility, setSavingVisibility] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    (async () => {
      try {
        const c = await fetchPublicCollection(slug);
        if (!cancelled) {
          setCollection(c);
          setStatus("ready");
        }
      } catch (err) {
        if (!cancelled) {
          setStatus((err as { status?: number })?.status === 404 ? "not-found" : "error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, retryNonce]);

  /* Owner view: if this is the signed-in fan's own collection, load the
     owner copy (visible even when private) so they see what they have
     and control the setting from the same page. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mine = await fetchMyProfile();
        if (!mine || mine.slug !== slug) {
          if (!cancelled) setIsOwner(false);
          return;
        }
        if (!cancelled) setIsOwner(true);
        const c = await fetchMyCollection();
        if (!cancelled) {
          setCollection(c);
          setStatus("ready");
        }
      } catch {
        /* public copy already loaded (or honestly failed) — keep it */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  usePageTitle(
    collection ? `${collection.fan.displayName}'s collection` : "Fan Collection",
    "Music and merch a fan collected on Bow Down Visuals.",
  );

  /* The owner always sees their own shelf — the private state is only
     for everyone else. */
  const view =
    isOwner && status === "ready" && collection
      ? collection.items.length > 0
        ? "items"
        : "empty"
      : collectionViewState({ status, collection });

  const flipVisibility = async () => {
    if (!collection) return;
    const next = collection.visibility === "public" ? "private" : "public";
    setSavingVisibility(true);
    try {
      const saved = await saveMyCollectionVisibility(next);
      setCollection({ ...collection, visibility: saved });
    } catch {
      /* honest: the toggle just doesn't move; the label still shows the
         saved state */
    } finally {
      setSavingVisibility(false);
    }
  };

  if (view === "loading") {
    return (
      <div className="flex min-h-[70vh] items-center justify-center bg-black">
        <Loader2 className="h-8 w-8 animate-spin text-amber-400" />
      </div>
    );
  }

  if (view === "error") {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3 bg-black px-4 text-center">
        <AlertTriangle className="h-10 w-10 text-amber-400" />
        <h1 className="text-xl font-bold text-white">Couldn't load this collection.</h1>
        <p className="max-w-sm text-sm text-white/50">
          Something went wrong on our end — the collection may well exist, it just couldn't load right now.
        </p>
        <button
          type="button"
          onClick={() => setRetryNonce((n) => n + 1)}
          className="mt-2 inline-flex items-center gap-2 rounded-full bg-amber-400 px-6 py-2.5 text-sm font-bold text-black transition hover:scale-105"
        >
          <RotateCcw className="h-4 w-4" /> Try again
        </button>
      </div>
    );
  }

  if (view === "not-found" || !collection) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3 bg-black px-4 text-center">
        <ShoppingBag className="h-10 w-10 text-white/30" />
        <h1 className="text-xl font-bold text-white">No collection at this address.</h1>
        <p className="max-w-sm text-sm text-white/50">
          This fan doesn't have a public profile yet — collections live on the fan's page address.
        </p>
        <Link href="/browse" className="mt-2 rounded-full bg-amber-400 px-6 py-2.5 text-sm font-bold text-black transition hover:scale-105">
          Find creators to support
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="mb-2 flex items-center gap-2 text-[#d4af37]">
          <ShoppingBag className="h-5 w-5" />
          <span className="text-[11px] font-bold uppercase tracking-[0.25em]">The Collection</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {collection.fan.avatarUrl && (
            <img
              src={collection.fan.avatarUrl}
              alt=""
              className="h-12 w-12 rounded-full border-2 border-[#d4af37] object-cover"
              onError={(e) => { e.currentTarget.style.display = "none"; }}
            />
          )}
          <h1 className="text-2xl font-black tracking-tight sm:text-3xl">
            {collection.fan.displayName}'s collection
          </h1>
        </div>
        <p className="mt-2 text-sm text-white/50">
          Real purchases from real creators — proof the fans here put money behind the music.{" "}
          <Link href={collection.fan.profileUrl} className="font-semibold text-[#d4af37] underline">
            Visit their page
          </Link>
        </p>

        {isOwner && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-[#d4af37]/40 bg-[#d4af37]/5 px-4 py-3">
            <p className="text-xs text-white/70">
              Your collection is <strong className="text-white">{collection.visibility}</strong>.
              {collection.visibility === "private"
                ? " Only you can see it."
                : " Anyone with the link can see what you've collected."}
            </p>
            <button
              type="button"
              disabled={savingVisibility}
              onClick={() => void flipVisibility()}
              className="ml-auto inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50"
            >
              {collection.visibility === "public" ? <Lock className="h-3.5 w-3.5" /> : <ShoppingBag className="h-3.5 w-3.5" />}
              Make it {collection.visibility === "public" ? "private" : "public"}
            </button>
          </div>
        )}

        {view === "private" && (
          <div className="mt-8 flex flex-col items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-10 text-center" data-testid="collection-private">
            <Lock className="h-8 w-8 text-[#d4af37]" />
            <p className="text-base font-bold">This collection is private.</p>
            <p className="max-w-sm text-sm text-white/50">
              {collection.fan.displayName} keeps their collection to themselves. The creators they support still got paid — that's the part that counts.
            </p>
          </div>
        )}

        {view === "empty" && (
          <div className="mt-8 flex flex-col items-center gap-2 rounded-xl border border-dashed border-[#d4af37]/40 bg-white/5 px-4 py-10 text-center" data-testid="collection-empty">
            <ShoppingBag className="h-8 w-8 text-[#d4af37]" />
            <p className="text-base font-bold">Nothing collected yet.</p>
            <p className="max-w-sm text-sm text-white/50">
              When {collection.fan.displayName} buys music, videos, or merch here, it lands on this shelf.
            </p>
          </div>
        )}

        {view === "items" && (
          <ul className="mt-6 space-y-3">
            {collection.items.map((item) => {
              const Icon = KIND_ICON[item.kind];
              return (
                <li
                  key={`${item.kind}-${item.itemId}-${item.purchasedAt}`}
                  className="flex items-center gap-4 rounded-xl border border-[#d4af37]/30 bg-gradient-to-b from-[#d4af37]/10 to-transparent p-[1px]"
                >
                  <span className="flex w-full items-center gap-4 rounded-[11px] bg-zinc-950 px-4 py-3">
                    {item.artworkUrl ? (
                      <img
                        src={item.artworkUrl}
                        alt=""
                        className="h-14 w-14 shrink-0 rounded object-cover"
                        onError={(e) => { e.currentTarget.style.display = "none"; }}
                      />
                    ) : (
                      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded bg-[#d4af37]/15 text-[#d4af37]">
                        <Icon className="h-6 w-6" />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold">{item.title}</span>
                      <span className="block text-xs text-white/50">
                        by{" "}
                        {item.creatorUrl ? (
                          <Link href={item.creatorUrl} className="font-semibold text-[#d4af37] underline">
                            {item.creatorName}
                          </Link>
                        ) : (
                          item.creatorName
                        )}{" "}
                        · {new Date(item.purchasedAt).toLocaleDateString()}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-full bg-[#d4af37] px-2.5 py-1 text-xs font-black text-black">
                      {collectionMoney(item.amountCents)}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
