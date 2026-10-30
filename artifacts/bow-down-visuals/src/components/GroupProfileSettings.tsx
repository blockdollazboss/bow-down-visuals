import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Users, Loader2, ExternalLink, PackagePlus } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import {
  GROUP_PRODUCT_KINDS,
  buildSplitTerms,
  canManageGroupProfile,
  formatGroupPrice,
  groupKindLabel,
  normalizeGroupSlugInput,
  parsePriceToCents,
  type GroupOwnView,
  type GroupProfileOwnDto,
} from "@/lib/group-profile-view";

/* ─── Duo/Group Profile editor (Stack-200 UPGRADE N20) ─────────────────
   Docked on the Team page — the team's public identity lives where the
   team is managed, not on a standalone surface. Owner/admins edit the
   handle, name, bio, art, publish switch and the WRITTEN split terms
   (one % per credited member; the API re-validates through the same
   sum-to-100 machine and stamps the terms onto shared-store products).
   Members see the current state read-only. Both themes. */

interface Props {
  teamId: string;
  myRole: string | null;
}

export function GroupProfileSettings({ teamId, myRole }: Props) {
  const { getAccessToken } = useAuth();
  const isLight = useIsLightTheme();
  const canManage = canManageGroupProfile(myRole);

  const [dto, setDto] = useState<GroupProfileOwnDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [slug, setSlug] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [bannerUrl, setBannerUrl] = useState("");
  const [isPublished, setIsPublished] = useState(false);
  const [shares, setShares] = useState<Record<string, string>>({});

  const [productKind, setProductKind] = useState<string>("download");
  const [productTitle, setProductTitle] = useState("");
  const [productPrice, setProductPrice] = useState("");
  const [addingProduct, setAddingProduct] = useState(false);

  async function api(path: string, opts?: RequestInit) {
    const token = await getAccessToken();
    const res = await fetch(path, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token ?? ""}`,
        ...(opts?.headers ?? {}),
      },
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(
        (typeof data["message"] === "string" && data["message"]) ||
          (typeof data["error"] === "string" && data["error"]) ||
          `Request failed (${res.status})`,
      );
    }
    return data;
  }

  function fillForm(data: GroupProfileOwnDto) {
    setDto(data);
    const g = data.group;
    setSlug(g?.slug ?? "");
    setDisplayName(g?.displayName ?? "");
    setBio(g?.bio ?? "");
    setAvatarUrl(g?.avatarUrl ?? "");
    setBannerUrl(g?.bannerUrl ?? "");
    setIsPublished(g?.isPublished ?? false);
    const next: Record<string, string> = {};
    for (const m of data.members) next[m.userId] = m.sharePct != null ? String(m.sharePct) : "";
    setShares(next);
  }

  async function load() {
    setLoading(true);
    setLoadFailed(false);
    try {
      const data = (await api(`/api/teams/${teamId}/group-profile`)) as unknown as GroupProfileOwnDto;
      fillForm(data);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  const ownerUserId = dto?.members.find((m) => m.role === "owner")?.userId ?? "";

  async function handleSave() {
    if (!dto) return;
    setError(null);
    setMsg(null);
    const normalized = normalizeGroupSlugInput(slug);
    if (!normalized) {
      setError("The group handle needs 3–64 characters: lowercase letters, numbers and dashes, starting and ending with a letter or number.");
      return;
    }
    const built = buildSplitTerms(
      ownerUserId,
      dto.members.map((m) => ({ userId: m.userId, pct: shares[m.userId] ?? "" })),
    );
    if (!built.ok) {
      setError(built.error);
      return;
    }
    setSaving(true);
    try {
      const data = (await api(`/api/teams/${teamId}/group-profile`, {
        method: "POST",
        body: JSON.stringify({
          slug: normalized,
          displayName: displayName.trim(),
          bio,
          avatarUrl: avatarUrl.trim() ? avatarUrl.trim() : null,
          bannerUrl: bannerUrl.trim() ? bannerUrl.trim() : null,
          isPublished,
          splitTerms: built.terms,
        }),
      })) as unknown as { group: GroupOwnView };
      setMsg("Group profile saved.");
      /* Reload so members/products reflect the saved state exactly. */
      await load();
      void data;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the group profile.");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddProduct() {
    if (!dto?.group) return;
    setError(null);
    setMsg(null);
    const title = productTitle.trim();
    if (!title) {
      setError("Give the product a title.");
      return;
    }
    const priceCents = parsePriceToCents(productPrice);
    if (priceCents == null) {
      setError("The price must be 0 or more, in dollars (e.g. 5 or 5.25).");
      return;
    }
    setAddingProduct(true);
    try {
      await api(`/api/teams/${teamId}/group-profile/products`, {
        method: "POST",
        body: JSON.stringify({ kind: productKind, title, priceCents }),
      });
      setProductTitle("");
      setProductPrice("");
      setMsg("Added to the shared store — it sells under the group's split terms.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add this product.");
    } finally {
      setAddingProduct(false);
    }
  }

  const cardCls = isLight
    ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]"
    : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]";
  const labelCls = `block text-xs font-semibold uppercase tracking-wider ${isLight ? "text-[#6B5B36]" : "text-white/40"}`;
  const inputCls = `mt-1 w-full rounded-lg border px-3 py-2 text-sm ${
    isLight
      ? "border-[#C9A84C]/40 bg-white/80 text-[#241C0A]"
      : "border-white/10 bg-white/[0.05] text-white"
  }`;

  if (loading) {
    return (
      <section className={`rounded-2xl border p-5 md:p-6 ${cardCls}`} data-testid="group-profile-settings">
        <p className={`flex items-center gap-2 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
          <Loader2 className="h-4 w-4 animate-spin text-[#C9A84C]" /> Loading the group's public profile…
        </p>
      </section>
    );
  }

  if (loadFailed || !dto) {
    return (
      <section className={`rounded-2xl border p-5 md:p-6 ${cardCls}`} data-testid="group-profile-settings">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <Users className="h-5 w-5 text-[#C9A84C]" /> Group public profile
        </h2>
        <p className="mt-2 text-sm text-red-400">The group profile couldn't load — it isn't hidden, it just didn't arrive.</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-3 rounded-full bg-[#C9A84C] px-5 py-2 text-xs font-bold text-black hover:brightness-110"
        >
          Try again
        </button>
      </section>
    );
  }

  const group = dto.group;

  return (
    <section className={`rounded-2xl border p-5 md:p-6 ${cardCls}`} data-testid="group-profile-settings">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <Users className="h-5 w-5 text-[#C9A84C]" /> Group public profile
        </h2>
        {group?.isPublished ? (
          <Link
            href={`/group/${group.slug}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-[#C9A84C]/50 px-3 py-1.5 text-xs font-bold text-[#C9A84C] transition hover:bg-[#C9A84C]/10"
          >
            <ExternalLink className="h-3.5 w-3.5" /> View the public page
          </Link>
        ) : (
          <span className={`text-xs ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
            {group ? "Draft — not public yet" : "Not set up yet"}
          </span>
        )}
      </div>
      <p className={`mt-1 text-xs ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
        One public page and one shared store under the group's name. The split terms written here are
        published on the page and divide every shared-store sale.
      </p>

      {msg && <p className="mt-3 rounded-lg bg-green-500/10 px-4 py-2 text-sm text-green-300">✓ {msg}</p>}
      {error && <p className="mt-3 rounded-lg bg-red-500/10 px-4 py-2 text-sm text-red-300">{error}</p>}

      {!canManage ? (
        <div className={`mt-4 text-sm ${isLight ? "text-[#4A3F22]" : "text-white/60"}`}>
          {group ? (
            <>
              <p className="font-semibold">{group.displayName}</p>
              <p className="mt-1">
                Handle: @{group.slug} · {group.isPublished ? "Published" : "Draft"}
              </p>
              <p className="mt-2">Only the team's owner and admins can change the public profile.</p>
            </>
          ) : (
            <p>The team's owner and admins set up the public profile here.</p>
          )}
        </div>
      ) : (
        <>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor="gp-name">Group name</label>
              <input id="gp-name" className={inputCls} value={displayName} maxLength={120}
                onChange={(e) => setDisplayName(e.target.value)} placeholder="e.g. Crown Duo" />
            </div>
            <div>
              <label className={labelCls} htmlFor="gp-slug">Public handle — bowdownvisuals.com/group/…</label>
              <input id="gp-slug" className={inputCls} value={slug} maxLength={64}
                onChange={(e) => setSlug(e.target.value)} placeholder="crown-duo" />
              <p className="mt-1 text-xs opacity-50">3–64 characters: lowercase letters, numbers and dashes, starting and ending with a letter or number.</p>
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls} htmlFor="gp-bio">Bio</label>
              <textarea id="gp-bio" className={inputCls} value={bio} maxLength={2000} rows={3}
                onChange={(e) => setBio(e.target.value)} placeholder="Who the group is, in the group's own words." />
            </div>
            <div>
              <label className={labelCls} htmlFor="gp-avatar">Avatar image URL</label>
              <input id="gp-avatar" className={inputCls} value={avatarUrl}
                onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://…" />
            </div>
            <div>
              <label className={labelCls} htmlFor="gp-banner">Banner image URL</label>
              <input id="gp-banner" className={inputCls} value={bannerUrl}
                onChange={(e) => setBannerUrl(e.target.value)} placeholder="https://…" />
            </div>
          </div>

          {/* Written split terms — one share per credited member */}
          <div className="mt-5">
            <p className={labelCls}>Split terms — % of each shared-store sale</p>
            <div className="mt-2 space-y-2">
              {dto.members.map((m) => (
                <div key={m.userId} className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 ${isLight ? "bg-black/[0.03]" : "bg-white/[0.04]"}`}>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{m.displayName}</span>
                    <span className={`block text-xs capitalize ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>{m.role}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step="0.01"
                      value={shares[m.userId] ?? ""}
                      onChange={(e) => setShares((prev) => ({ ...prev, [m.userId]: e.target.value }))}
                      className={`w-24 rounded-lg border px-2 py-1.5 text-sm ${isLight ? "border-[#C9A84C]/40 bg-white/80 text-[#241C0A]" : "border-white/10 bg-white/[0.05] text-white"}`}
                      placeholder="—"
                      aria-label={`Share for ${m.displayName}`}
                    />
                    <span className={`text-sm ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>%</span>
                  </span>
                </div>
              ))}
            </div>
            <p className={`mt-2 text-xs ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
              Leave every share blank for no written terms. When shares are set they must total exactly
              100%, and the team owner must hold one.
            </p>
          </div>

          <div className="mt-5 flex items-center justify-between gap-3 flex-wrap">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                checked={isPublished}
                onChange={(e) => setIsPublished(e.target.checked)}
                className="h-4 w-4 accent-[#C9A84C]"
              />
              Publish the public page
            </label>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl bg-[#C9A84C] px-4 py-2.5 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {group ? "Save group profile" : "Create group profile"}
            </button>
          </div>

          {/* Shared store */}
          {group && (
            <div className={`mt-6 border-t pt-5 ${isLight ? "border-[#C9A84C]/30" : "border-white/10"}`}>
              <h3 className="text-sm font-bold uppercase tracking-wider">Shared store</h3>
              {dto.products.length > 0 ? (
                <div className="mt-3 space-y-1.5">
                  {dto.products.map((p) => (
                    <div key={p.id} className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${isLight ? "bg-black/[0.03]" : "bg-white/[0.04]"}`}>
                      <span className="font-semibold">{p.title}</span>
                      <span className={`${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
                        {groupKindLabel(p.kind)} · <span className="font-bold text-[#C9A84C]">{formatGroupPrice(p.priceCents)}</span>
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className={`mt-2 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
                  Nothing in the shared store yet.
                </p>
              )}
              <div className="mt-4 flex flex-wrap items-end gap-2">
                <div>
                  <label className={labelCls} htmlFor="gp-product-kind">Kind</label>
                  <select id="gp-product-kind" value={productKind} onChange={(e) => setProductKind(e.target.value)} className={`${inputCls} w-auto`}>
                    {GROUP_PRODUCT_KINDS.map((k) => (
                      <option key={k} value={k}>{groupKindLabel(k)}</option>
                    ))}
                  </select>
                </div>
                <div className="min-w-[180px] flex-1">
                  <label className={labelCls} htmlFor="gp-product-title">Title</label>
                  <input id="gp-product-title" className={inputCls} value={productTitle} maxLength={200}
                    onChange={(e) => setProductTitle(e.target.value)} placeholder="Product title" />
                </div>
                <div>
                  <label className={labelCls} htmlFor="gp-product-price">Price ($)</label>
                  <input id="gp-product-price" className={`${inputCls} w-28`} value={productPrice} inputMode="decimal"
                    onChange={(e) => setProductPrice(e.target.value)} placeholder="5.00" />
                </div>
                <button
                  type="button"
                  onClick={() => void handleAddProduct()}
                  disabled={addingProduct || !productTitle.trim()}
                  className="inline-flex items-center gap-2 rounded-xl border border-[#C9A84C]/50 px-4 py-2.5 text-sm font-bold text-[#C9A84C] transition hover:bg-[#C9A84C]/10 disabled:opacity-50"
                >
                  {addingProduct ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackagePlus className="h-4 w-4" />}
                  Add product
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
