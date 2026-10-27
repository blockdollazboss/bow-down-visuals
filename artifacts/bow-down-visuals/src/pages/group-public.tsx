import { useEffect, useState } from "react";
import { useRoute, Link } from "wouter";
import { Loader2, Link2Off, AlertTriangle, RotateCcw, Users, Store, Crown, Shield, User as UserIcon } from "lucide-react";
import { JsonLd } from "@/components/seo/json-ld";
import { usePageTitle } from "@/hooks/use-page-title";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import {
  fetchPublicGroupProfile,
  formatGroupPrice,
  groupKindLabel,
  splitTermRows,
  GroupProfileFetchError,
  type GroupProfilePageDto,
} from "@/lib/group-profile-view";

/* ─── Public duo/group profile — /group/:slug (Stack-200 UPGRADE N20) ──
   The public half of a team: ONE page under the group name — identity,
   the members credited (each linked to their own creator page), the
   group's WRITTEN split terms shown in the open, and the shared store.
   Store cards link to the one buy surface (/storefront/product/:id),
   so the price shown is the price charged. Unpublished groups 404 from
   the API, and the page tells a genuine 404 apart from a load failure
   — the same honesty split artist-public.tsx draws. Themed in both
   site themes: ivory + antique gold in light, gold on near-black in
   dark. */

const ROLE_ICON = { owner: Crown, admin: Shield, member: UserIcon } as const;

export default function GroupPublic() {
  const [, params] = useRoute("/group/:slug");
  const isLight = useIsLightTheme();
  const slug = params?.slug ?? "";
  const [dto, setDto] = useState<GroupProfilePageDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    setLoadError(false);
    (async () => {
      try {
        const data = await fetchPublicGroupProfile(slug);
        if (!cancelled) setDto(data);
      } catch (err) {
        if (!cancelled) {
          if (err instanceof GroupProfileFetchError && err.status === 404) setNotFound(true);
          else setLoadError(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, retryNonce]);

  usePageTitle(
    dto ? dto.group.displayName : "Group Profile",
    dto?.group.bio
      ? dto.group.bio.split("\n")[0]
      : "A duo / group creator page on Bow Down Visuals — music, videos and a shared store under one name.",
  );

  const shell = isLight ? "bg-[#FAF7F0] text-[#241C0A]" : "bg-black text-white";
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const cardCls = isLight
    ? "border-[#C9A84C]/40 bg-white/70"
    : "border-white/10 bg-white/[0.03]";

  if (loading) {
    return (
      <div className={`flex min-h-[70vh] items-center justify-center ${shell}`}>
        <Loader2 className="h-8 w-8 animate-spin text-[#C9A84C]" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className={`flex min-h-[70vh] flex-col items-center justify-center gap-3 px-4 text-center ${shell}`}>
        <AlertTriangle className="h-10 w-10 text-[#C9A84C]" />
        <h1 className="text-xl font-bold">Couldn't load this group.</h1>
        <p className={`max-w-sm text-sm ${muted}`}>
          Something went wrong on our end — this group's page may well exist, it just couldn't load right now.
        </p>
        <button
          type="button"
          onClick={() => setRetryNonce((n) => n + 1)}
          className="mt-2 inline-flex items-center gap-2 rounded-full bg-[#C9A84C] px-6 py-2.5 text-sm font-bold text-black transition hover:scale-105"
        >
          <RotateCcw className="h-4 w-4" /> Try again
        </button>
      </div>
    );
  }

  if (notFound || !dto) {
    return (
      <div className={`flex min-h-[70vh] flex-col items-center justify-center gap-3 px-4 text-center ${shell}`}>
        <Link2Off className={`h-10 w-10 ${isLight ? "text-[#241C0A]/30" : "text-white/30"}`} />
        <h1 className="text-xl font-bold">This group page doesn't exist — yet.</h1>
        <p className={`max-w-sm text-sm ${muted}`}>
          The group hasn't published their page, or the link is off. Teams publish theirs from the Team page.
        </p>
        <Link
          href="/team"
          className="mt-2 rounded-full bg-[#C9A84C] px-6 py-2.5 text-sm font-bold text-black transition hover:scale-105"
        >
          Go to my team
        </Link>
      </div>
    );
  }

  const { group, members, products } = dto;
  const termRows = splitTermRows(group.splitTerms, members);

  return (
    <div className={`min-h-screen ${shell}`} data-testid="group-public">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "ProfilePage",
          name: `${group.displayName} — Bow Down Visuals`,
          description: group.bio?.split("\n")[0] || `${group.displayName}'s group page`,
          url: `/group/${group.slug}`,
          mainEntity: {
            "@type": "MusicGroup",
            name: group.displayName,
            description: group.bio || undefined,
            image: group.avatarUrl || undefined,
          },
        }}
      />

      {/* Masthead */}
      {group.bannerUrl ? (
        <div className="h-40 w-full overflow-hidden sm:h-56">
          <img src={group.bannerUrl} alt="" className="h-full w-full object-cover" />
        </div>
      ) : (
        <div className={`h-24 w-full sm:h-32 ${isLight ? "bg-gradient-to-r from-[#EFE3C2] to-[#C9A84C]/40" : "bg-gradient-to-r from-[#14100a] to-[#C9A84C]/25"}`} />
      )}
      <div className="mx-auto max-w-4xl px-4">
        <div className="-mt-10 flex items-end gap-4">
          {group.avatarUrl ? (
            <img
              src={group.avatarUrl}
              alt={group.displayName}
              className={`h-20 w-20 rounded-2xl border-2 object-cover sm:h-24 sm:w-24 ${isLight ? "border-[#FAF7F0]" : "border-black"}`}
            />
          ) : (
            <span className={`flex h-20 w-20 items-center justify-center rounded-2xl border-2 sm:h-24 sm:w-24 ${isLight ? "border-[#FAF7F0] bg-[#EFE3C2]" : "border-black bg-[#1a1408]"}`}>
              <Users className="h-9 w-9 text-[#C9A84C]" />
            </span>
          )}
          <div className="pb-1">
            <h1 className="text-2xl font-black sm:text-3xl">{group.displayName}</h1>
            <p className={`text-sm ${muted}`}>@{group.slug} · Duo / Group</p>
          </div>
        </div>

        {group.bio ? (
          <p className={`mt-5 max-w-2xl whitespace-pre-line text-sm leading-relaxed ${isLight ? "text-[#4A3F22]" : "text-white/70"}`}>
            {group.bio}
          </p>
        ) : null}

        {/* Members credited */}
        {members.length > 0 && (
          <section className={`mt-8 rounded-2xl border p-5 ${cardCls}`} data-testid="group-members">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-bold">
              <Users className="h-5 w-5 text-[#C9A84C]" /> The members
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {members.map((m) => {
                const Icon = ROLE_ICON[m.role as keyof typeof ROLE_ICON] ?? UserIcon;
                const inner = (
                  <>
                    {m.avatarUrl ? (
                      <img src={m.avatarUrl} alt="" className="h-11 w-11 rounded-full object-cover" />
                    ) : (
                      <span className={`flex h-11 w-11 items-center justify-center rounded-full ${isLight ? "bg-[#EFE3C2]" : "bg-white/10"}`}>
                        <Icon className="h-5 w-5 text-[#C9A84C]" />
                      </span>
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold">{m.displayName}</span>
                      <span className={`block text-xs capitalize ${muted}`}>
                        {m.role}
                        {m.sharePct != null ? ` · ${m.sharePct}% split` : ""}
                      </span>
                    </span>
                  </>
                );
                const cls = `flex items-center gap-3 rounded-xl px-3 py-2.5 ${isLight ? "bg-black/[0.03]" : "bg-white/[0.04]"}`;
                return m.slug ? (
                  <Link key={m.userId} href={`/artist/${m.slug}`} className={`${cls} transition hover:scale-[1.01]`}>
                    {inner}
                  </Link>
                ) : (
                  <div key={m.userId} className={cls}>
                    {inner}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* The written split terms, in the open */}
        {termRows.length > 0 && (
          <section className={`mt-6 rounded-2xl border p-5 ${cardCls}`} data-testid="group-split-terms">
            <h2 className="mb-1 text-lg font-bold">How this group splits its sales</h2>
            <p className={`mb-4 text-xs ${muted}`}>
              The group's published terms. Sales from the shared store divide by exactly these shares.
            </p>
            <div className="space-y-1.5">
              {termRows.map((row) => (
                <div
                  key={row.userId}
                  className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${isLight ? "bg-black/[0.03]" : "bg-white/[0.04]"}`}
                >
                  <span className="font-semibold">{row.displayName}</span>
                  <span className="font-black text-[#C9A84C]">{row.sharePct}%</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* The shared store */}
        {products.length > 0 && (
          <section className="mt-6 pb-14" data-testid="group-store">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-bold">
              <Store className="h-5 w-5 text-[#C9A84C]" /> The shared store
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {products.map((p) => (
                <Link
                  key={p.id}
                  href={`/storefront/product/${p.id}`}
                  className={`group overflow-hidden rounded-xl border transition hover:scale-[1.02] ${cardCls}`}
                >
                  {p.mediaUrls[0] ? (
                    <img src={p.mediaUrls[0]} alt="" className="aspect-square w-full object-cover" loading="lazy" />
                  ) : (
                    <span className={`flex aspect-square w-full items-center justify-center ${isLight ? "bg-[#EFE3C2]/60" : "bg-white/[0.04]"}`}>
                      <Store className="h-8 w-8 text-[#C9A84C]/60" />
                    </span>
                  )}
                  <span className="block px-3 py-2.5">
                    <span className="block truncate text-sm font-bold">{p.title}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2">
                      <span className={`text-[10px] font-bold uppercase tracking-wider ${muted}`}>
                        {groupKindLabel(p.kind)}
                      </span>
                      <span className="text-sm font-black text-[#C9A84C]">{formatGroupPrice(p.priceCents)}</span>
                      {p.compareAtCents != null && p.compareAtCents > p.priceCents ? (
                        <span className={`text-xs line-through ${muted}`}>{formatGroupPrice(p.compareAtCents)}</span>
                      ) : null}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {products.length === 0 && <div className="pb-14" />}
      </div>
    </div>
  );
}
