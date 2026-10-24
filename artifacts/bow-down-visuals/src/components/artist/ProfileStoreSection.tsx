import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Store, AlertTriangle, RotateCcw, Music2, Clapperboard, Package } from "lucide-react";
import {
  fetchStoreCatalog,
  storeViewState,
  collectionMoney,
  type StoreCatalogDto,
  type StoreLoadStatus,
} from "@/lib/profile-website";
import { fetchMyProfile } from "@/lib/artist-profiles";

/* ─── Store — public profile section ──────────────────────────────────────
   The creator's whole catalog for sale, right on the profile: priced
   tracks, videos and products in one grid (the store-catalog endpoint).
   Every card links to the surface that charges exactly the price shown
   — displayed price IS charged price, by construction. An empty store
   hides from visitors; the owner gets the set-up invitation. A failed
   load is an honest error + retry, never a fake-empty store. */

const KIND_ICON = { track: Music2, video: Clapperboard, product: Package } as const;
const KIND_LABEL = { track: "Track", video: "Video", product: "Product" } as const;

export default function ProfileStoreSection({
  slug,
  title = "Store",
}: {
  slug: string;
  title?: string;
}) {
  const [catalog, setCatalog] = useState<StoreCatalogDto | null>(null);
  const [status, setStatus] = useState<StoreLoadStatus>("loading");
  const [isOwner, setIsOwner] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    (async () => {
      try {
        const c = await fetchStoreCatalog(slug);
        if (!cancelled) {
          setCatalog(c);
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

  const view = storeViewState({ status, count: catalog?.items.length ?? 0, isOwner });
  if (view === "loading" || view === "hidden") return null;

  return (
    <section className="ap-section" style={{ padding: "var(--ap-pad)" }} data-testid="profile-store">
      <div className="mb-3 flex items-center gap-2">
        <Store className="h-5 w-5" style={{ color: "var(--ap-primary)" }} />
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
            The store couldn't load right now.
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
          <Store className="h-6 w-6" style={{ color: "var(--ap-primary)" }} />
          <p className="text-sm font-semibold" style={{ color: "var(--ap-text)" }}>
            Your store is empty
          </p>
          <p className="max-w-sm text-xs" style={{ color: "var(--ap-muted)" }}>
            Price a track, a video, or a product and it lands here on your page automatically — your profile is your store.
          </p>
          <Link
            href="/storefronts"
            className="mt-1 inline-flex items-center gap-2 rounded-full px-5 py-2 text-xs font-bold text-black transition hover:scale-105"
            style={{ backgroundColor: "var(--ap-primary)" }}
          >
            Set up your store
          </Link>
        </div>
      )}

      {view === "items" && catalog && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {catalog.items.map((item) => {
            const Icon = KIND_ICON[item.kind];
            const body = (
              <>
                <span className="block px-3 py-2.5">
                  <span
                    className="block truncate text-sm font-bold"
                    style={{ color: "var(--ap-text)", fontFamily: "var(--ap-heading-font)" }}
                  >
                    {item.title}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--ap-muted)" }}>
                      {KIND_LABEL[item.kind]}
                    </span>
                    {item.pwyw?.enabled ? (
                      <span
                        className="rounded-full px-1.5 py-0.5 text-[10px] font-black text-black"
                        style={{ backgroundColor: "var(--ap-primary)" }}
                      >
                        Name your price
                      </span>
                    ) : (
                      <>
                        <span className="text-sm font-black" style={{ color: "var(--ap-primary)" }}>
                          ${item.price}
                        </span>
                        {item.compareAtCents != null && item.compareAtCents > item.priceCents && (
                          <span className="text-xs line-through" style={{ color: "var(--ap-muted)" }}>
                            {collectionMoney(item.compareAtCents)}
                          </span>
                        )}
                      </>
                    )}
                  </span>
                </span>
              </>
            );
            /* A product with a pinned UGC ad (migration 0178) shows the
               ad itself, playable, at the top of its card — the card
               becomes a div so the video's controls never nest inside
               the buy link; the title block carries the link instead. */
            if (item.pinnedAd) {
              return (
                <div
                  key={`${item.kind}-${item.id}`}
                  className="group overflow-hidden rounded-xl"
                  style={{ border: "1px solid var(--ap-border)", backgroundColor: "var(--ap-card)" }}
                  data-testid="store-item"
                >
                  <video
                    src={item.pinnedAd.videoUrl}
                    controls
                    playsInline
                    preload="metadata"
                    className="aspect-[9/16] max-h-64 w-full bg-black object-contain"
                    data-testid="store-item-pinned-ad"
                  />
                  <a href={item.buyUrl} className="block transition hover:scale-[1.02]">
                    {body}
                  </a>
                </div>
              );
            }
            return (
              <a
                key={`${item.kind}-${item.id}`}
                href={item.buyUrl}
                className="group overflow-hidden rounded-xl transition hover:scale-[1.02]"
                style={{ border: "1px solid var(--ap-border)", backgroundColor: "var(--ap-card)" }}
                data-testid="store-item"
              >
                {item.artworkUrl ? (
                  <img
                    src={item.artworkUrl}
                    alt={item.artworkAlt ?? item.title}
                    className="aspect-square w-full object-cover"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                ) : (
                  <span
                    className="flex aspect-square w-full items-center justify-center"
                    style={{ backgroundColor: "var(--ap-surface)", color: "var(--ap-primary)" }}
                  >
                    <Icon className="h-10 w-10" />
                  </span>
                )}
                {body}
              </a>
            );
          })}
        </div>
      )}
    </section>
  );
}
