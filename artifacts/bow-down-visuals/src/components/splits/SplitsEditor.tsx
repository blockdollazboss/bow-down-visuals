import { useState } from "react";
import { Loader2, Search, Users, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { apiJson } from "@/lib/social-api";
import { fetchPublicProfile } from "@/lib/artist-profiles";
import {
  MAX_CO_SELLERS,
  ownerSharePct,
  validateSplitsDraft,
  type SplitCoSellerDraft,
  type SplitsDraftError,
} from "@/lib/splits-editor";

/* ── Co-seller splits editor (Wave 4 #36, FE half) ───────────────────────
   The shared visual half of the splits machine, docked wherever a
   product is written (store dashboard form + product row, My Shop
   product form). The math lives in lib/splits-editor (pinned): the
   owner's share is DERIVED — 100 minus the co-sellers' total — so the
   list always sums to 100 unless the co-sellers crowd the owner out,
   which is the one refusal the editor must surface.

   The picker is creator_profiles-backed, the same discovery rail the
   close-friends panel uses: search returns profiles (name/slug), and
   picking one resolves its account id through the public profile —
   splits are keyed by account, and the server re-validates every
   seller against creator_profiles on save, so a stale pick reads as
   an honest error, never a silent drop. */

interface CreatorSearchHit {
  profile_id: string;
  slug: string;
  display_name: string;
  avatar_url: string | null;
}

const inputCls =
  "rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/35 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

function errorKey(reason: SplitsDraftError): string {
  switch (reason) {
    case "owner-crowded-out":
      return "splits.errOwner";
    case "too-many-sellers":
      return "splits.maxReached";
    case "duplicate-seller":
      return "splits.alreadyAdded";
    case "self-listed":
      return "splits.selfError";
    default:
      return "splits.errShare";
  }
}

export default function SplitsEditor({
  ownerUserId,
  ownerName,
  drafts,
  onChange,
  getAccessToken,
  disabled = false,
}: {
  ownerUserId: string;
  ownerName?: string | null;
  drafts: SplitCoSellerDraft[];
  onChange: (next: SplitCoSellerDraft[]) => void;
  getAccessToken: () => Promise<string | null>;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const isLight = useIsLightTheme();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<CreatorSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [addingSlug, setAddingSlug] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const validation = validateSplitsDraft(ownerUserId, drafts);
  const ownerPct = ownerSharePct(drafts);

  const setShare = (userId: string, sharePct: string) =>
    onChange(drafts.map((d) => (d.userId === userId ? { ...d, sharePct } : d)));
  const remove = (userId: string) => onChange(drafts.filter((d) => d.userId !== userId));

  const runSearch = async () => {
    const q = query.trim();
    if (!q || searching) return;
    setSearching(true);
    setNote(null);
    try {
      const d = await apiJson<{ creators?: CreatorSearchHit[] }>(
        getAccessToken,
        `/api/discovery/search?q=${encodeURIComponent(q)}&type=creator`,
      );
      const found = d.creators ?? [];
      setHits(found);
      if (found.length === 0) setNote(t("splits.noResults"));
    } catch {
      setNote(t("splits.searchFailed"));
    } finally {
      setSearching(false);
    }
  };

  const pick = async (hit: CreatorSearchHit) => {
    setNote(null);
    if (drafts.length >= MAX_CO_SELLERS) {
      setNote(t("splits.maxReached"));
      return;
    }
    setAddingSlug(hit.slug);
    try {
      /* The search hit carries the profile; splits are keyed by the
         account behind it — resolve through the public profile, whose
         client contract declares user_id. */
      const profile = await fetchPublicProfile(hit.slug);
      const userId = profile.user_id;
      if (userId === ownerUserId) {
        setNote(t("splits.selfError"));
        return;
      }
      if (drafts.some((d) => d.userId === userId)) {
        setNote(t("splits.alreadyAdded"));
        return;
      }
      /* Start from an even split of the owner's current share — a
         draft the creator then edits, never a saved number. */
      const suggested = Math.max(1, Math.floor(ownerPct / 2));
      onChange([
        ...drafts,
        {
          userId,
          name: profile.display_name ?? hit.display_name,
          slug: profile.slug ?? hit.slug,
          avatarUrl: profile.avatar_url ?? hit.avatar_url,
          sharePct: String(suggested),
        },
      ]);
      setHits((prev) => prev.filter((h) => h.profile_id !== hit.profile_id));
    } catch {
      setNote(t("splits.addFailed"));
    } finally {
      setAddingSlug(null);
    }
  };

  return (
    <div
      data-testid="splits-editor"
      className={`rounded-xl border p-4 ${isLight ? "border-[#C9A84C]/40 bg-[#FBF3DC]/70" : "border-white/10 bg-black/30"}`}
    >
      <p className="flex items-center gap-2 text-sm font-bold text-white">
        <Users className="h-4 w-4 text-amber-300" /> {t("splits.title")}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-white/45">{t("splits.blurb")}</p>

      {/* The owner row: identity locked, share derived. */}
      <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-amber-400/25 bg-amber-400/[0.04] px-3 py-2">
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-white">
            {ownerName ?? t("splits.youOwner")}
          </span>
          <span className="block text-[10px] text-white/40">{t("splits.autoNote")}</span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-[10px] font-bold uppercase tracking-wide text-white/40">{t("splits.yourShare")}</span>
          <span className={`text-base font-black ${validation.ok ? "text-amber-300" : "text-red-300"}`}>
            {Number.isInteger(ownerPct) ? ownerPct : ownerPct.toFixed(2)}%
          </span>
        </span>
      </div>

      {drafts.length === 0 ? (
        <p className="mt-3 text-xs text-white/40">{t("splits.noSplit")}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {drafts.map((d) => (
            <li key={d.userId} className="flex items-center gap-2">
              {d.avatarUrl ? (
                <img src={d.avatarUrl} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
              ) : (
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-400/20 text-xs font-bold text-amber-300">
                  {(d.name ?? d.slug ?? "?").charAt(0).toUpperCase()}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-white">{d.name ?? t("splits.creatorFallback")}</span>
                {d.slug && <span className="block truncate text-[10px] text-white/40">@{d.slug}</span>}
              </span>
              <label className="flex shrink-0 items-center gap-1.5">
                <span className="sr-only">{t("splits.sharePctLabel")}</span>
                <input
                  value={d.sharePct}
                  onChange={(e) => setShare(d.userId, e.target.value)}
                  inputMode="decimal"
                  disabled={disabled}
                  aria-label={t("splits.sharePctLabel")}
                  className="w-20 rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-right text-sm text-white outline-none focus:border-primary/60"
                />
                <span className="text-sm text-white/50">%</span>
              </label>
              <button
                type="button"
                onClick={() => remove(d.userId)}
                disabled={disabled}
                title={t("splits.remove")}
                aria-label={t("splits.remove")}
                className="shrink-0 rounded-full p-1.5 text-white/40 transition hover:bg-white/10 hover:text-red-300 disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {!validation.ok && drafts.length > 0 && (
        <p className="mt-2 text-xs font-semibold text-red-300">{t(errorKey(validation.reason))}</p>
      )}

      {/* The picker. */}
      <p className="mt-4 text-xs font-bold uppercase tracking-widest text-white/50">{t("splits.addTitle")}</p>
      <div className="mt-2 flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void runSearch();
            }
          }}
          placeholder={t("splits.searchPlaceholder")}
          disabled={disabled}
          className={`${inputCls} min-w-0 flex-1`}
        />
        <button
          type="button"
          onClick={() => void runSearch()}
          disabled={disabled || searching || !query.trim()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gradient-to-b from-amber-300 to-amber-500 px-4 py-2 text-xs font-black uppercase text-black transition hover:brightness-110 disabled:opacity-50"
        >
          {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          {searching ? t("splits.searching") : t("splits.find")}
        </button>
      </div>
      {note && <p className="mt-2 text-xs text-amber-200/90">{note}</p>}
      {hits.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {hits.slice(0, 6).map((h) => (
            <li key={h.profile_id} className="flex items-center gap-2 rounded-lg border border-white/[0.07] bg-black/30 px-3 py-2">
              {h.avatar_url ? (
                <img src={h.avatar_url} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
              ) : (
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-400/20 text-xs font-bold text-amber-300">
                  {h.display_name.charAt(0).toUpperCase()}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-white">{h.display_name}</span>
                <span className="block truncate text-[10px] text-white/40">@{h.slug}</span>
              </span>
              <button
                type="button"
                onClick={() => void pick(h)}
                disabled={disabled || addingSlug !== null}
                className="shrink-0 rounded-full border border-amber-400/40 px-3 py-1 text-[11px] font-black uppercase text-amber-300 transition hover:bg-amber-400/10 disabled:opacity-50"
              >
                {addingSlug === h.slug ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("splits.add")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
