import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BadgeCheck, Crown } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { NativeCard } from "./NativeCard";
import { NativeLoadingState } from "./NativeStates";
import {
  CREATOR_PROFILE_VERTICALS,
  buildCreatorProfilePayload,
  creatorProfileErrorLine,
  creatorProfileFormProblem,
  creatorProfileStrings,
  creatorSlugProblem,
  normalizeCreatorSlug,
  parseMyCreatorProfile,
  parseSlugCheck,
  profileCreateSuggestedBio,
  slugCheckLine,
  slugifyCreatorSlug,
  type MyCreatorProfile,
  type SlugCheckState,
} from "@/lib/world/creator-profile-create";

/* The vertical labels render from the catalog (the seam's table
   stays the rail's key list + the English fallback). */
const VERTICAL_LABEL_KEYS: Record<string, string> = {
  music: "worldCreatorRooms.profileVerticalMusic",
  video: "worldCreatorRooms.profileVerticalVideo",
  gaming: "worldCreatorRooms.profileVerticalGaming",
  podcast: "worldCreatorRooms.profileVerticalPodcast",
  film: "worldCreatorRooms.profileVerticalFilm",
  tv: "worldCreatorRooms.profileVerticalTv",
  influencer: "worldCreatorRooms.profileVerticalInfluencer",
  education: "worldCreatorRooms.profileVerticalEducation",
  other: "worldCreatorRooms.profileVerticalOther",
};

/* ─── Creator-profile creation, in-world (Stack-100 #48) ──────────
   A member with no creator profile was blocked at their first
   in-world publish and sent to the website. This card is the
   creation flow on the site's real rails: GET /creator-profiles/me
   (have one? the card just shows it — no duplicate creation),
   GET /creator-profiles/check-slug as the handle is typed (live
   availability), POST /creator-profiles to create. The rail's own
   errors (409 handle taken, 400 validation) surface in its words.
   Creating a profile is free. */

function useProfileAuthHeaders() {
  const { getAccessToken } = useAuth();
  return async (): Promise<Record<string, string>> => {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  };
}

const inputCls = (isLight: boolean) =>
  `w-full rounded-xl border px-3 py-2 text-sm outline-none transition focus:border-[#d4af37] bdv-touch-target ${
    isLight
      ? "border-[#C9A84C]/40 bg-white/60 text-[#2a1e07] placeholder:text-[#6B5B36]/60"
      : "border-white/10 bg-white/5 text-white placeholder:text-white/35"
  }`;

export function CreatorProfileCreateCard({
  isLight,
  onCreated,
  compact = false,
}: {
  isLight: boolean;
  /** Fires once, when THIS card creates the profile. */
  onCreated?: (profile: MyCreatorProfile) => void;
  /** In the publish rail the card leads with why it's here. */
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const strings = creatorProfileStrings((k) => t(k));
  const authHeaders = useProfileAuthHeaders();
  const { user } = useAuth();
  const [state, setState] = useState<"loading" | "hidden" | "has" | "create" | "failed">("loading");
  const [mine, setMine] = useState<MyCreatorProfile | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [bio, setBio] = useState("");
  const [vertical, setVertical] = useState("music");
  const [slugCheck, setSlugCheck] = useState<SlugCheckState>({ kind: "idle" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const checkSeq = useRef(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/creator-profiles/me", { headers: await authHeaders() });
        if (cancelled) return;
        if (res.status === 404) {
          setState("create");
          return;
        }
        if (res.status === 401 || res.status === 403) {
          // Not signed in (a guest at a board): this card isn't theirs.
          setState("hidden");
          return;
        }
        if (!res.ok) throw new Error("me");
        const profile = parseMyCreatorProfile(await res.json().catch(() => null));
        if (!profile) {
          setState("create");
          return;
        }
        setMine(profile);
        setState("has");
      } catch {
        if (!cancelled) setState("failed");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Prefill from the signed-in member until they type their own. */
  useEffect(() => {
    if (state !== "create") return;
    const name = (user?.user_metadata?.["display_name"] as string | undefined) ?? "";
    if (name && !displayName) {
      setDisplayName(name);
      if (!slugTouched) setSlug(slugifyCreatorSlug(name));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, user]);

  /* Live handle check — debounced, sequenced so a slow answer for a
     stale handle never overwrites the current one's state. */
  useEffect(() => {
    if (state !== "create") return;
    const candidate = normalizeCreatorSlug(slug);
    if (!candidate) {
      setSlugCheck({ kind: "idle" });
      return;
    }
    if (creatorSlugProblem(candidate, strings)) {
      setSlugCheck({ kind: "invalid", slug: candidate, message: creatorSlugProblem(candidate, strings)! });
      return;
    }
    setSlugCheck({ kind: "checking" });
    const seq = ++checkSeq.current;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/creator-profiles/check-slug?slug=${encodeURIComponent(candidate)}`, {
          headers: await authHeaders(),
        });
        if (seq !== checkSeq.current) return;
        if (!res.ok) {
          setSlugCheck({ kind: "invalid", slug: candidate, message: t("worldCreatorRooms.profileCheckDidntAnswer") });
          return;
        }
        setSlugCheck(parseSlugCheck(await res.json().catch(() => null), candidate, strings));
      } catch {
        if (seq === checkSeq.current) {
          setSlugCheck({ kind: "invalid", slug: candidate, message: t("worldCreatorRooms.profileCheckDidntAnswer") });
        }
      }
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, state]);

  const create = async () => {
    if (busy) return;
    const problem = creatorProfileFormProblem({ displayName, slug, slugCheck }, strings);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/creator-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(buildCreatorProfilePayload({ displayName, slug, bio, vertical })),
      });
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(creatorProfileErrorLine(data, t("worldCreatorRooms.profileCreateFallback")));
        // A 409 means the handle went between check and create:
        // re-run the live check so the form says so plainly.
        if (res.status === 409) {
          setSlugCheck({ kind: "taken", slug: normalizeCreatorSlug(slug) });
        }
        return;
      }
      const profile = parseMyCreatorProfile(data);
      if (!profile) {
        setError(t("worldCreatorRooms.profileCreatedUnread"));
        return;
      }
      setMine(profile);
      setState("has");
      onCreated?.(profile);
    } catch {
      setError(t("worldCreatorRooms.profileDeskNoAnswer"));
    } finally {
      setBusy(false);
    }
  };

  if (state === "hidden") return null;

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const checkLine = slugCheckLine(slugCheck, strings);
  const verticalLabel = (key: string): string => {
    const labelKey = VERTICAL_LABEL_KEYS[key];
    return labelKey ? t(labelKey) : CREATOR_PROFILE_VERTICALS.find((v) => v.key === key)?.label ?? key;
  };

  return (
    <NativeCard isLight={isLight} title={t("worldCreatorRooms.profileCardTitle")}>
      <div data-testid="world-profile-create-card">
        {state === "loading" ? (
          <NativeLoadingState isLight={isLight} message={t("worldCreatorRooms.profileLoading")} />
        ) : state === "failed" ? (
          <p className={`text-sm ${muted}`}>
            {t("worldCreatorRooms.profileLoadFailed")}
          </p>
        ) : state === "has" && mine ? (
          <div className="space-y-1" data-testid="world-profile-mine">
            <p className={`inline-flex items-center gap-2 text-sm font-black ${strong}`}>
              <BadgeCheck className="h-4 w-4 text-[#d4af37]" /> {mine.displayName}
            </p>
            <p className={`text-xs ${muted}`}>
              {t("worldCreatorRooms.profileMineLine", { slug: mine.slug, vertical: verticalLabel(mine.vertical) })}
            </p>
          </div>
        ) : (
          <div className="space-y-2" data-testid="world-profile-create-form">
            <p className={`text-sm ${muted}`}>
              {compact
                ? t("worldCreatorRooms.profileIntroCompact")
                : t("worldCreatorRooms.profileIntro")}
            </p>
            <input
              aria-label={t("worldCreatorRooms.profileNameAria")}
              data-testid="world-profile-create-name"
              className={inputCls(isLight)}
              placeholder={t("worldCreatorRooms.profileNamePlaceholder")}
              maxLength={80}
              value={displayName}
              onChange={(e) => {
                setDisplayName(e.target.value);
                if (!slugTouched) setSlug(slugifyCreatorSlug(e.target.value));
              }}
            />
            <div>
              <input
                aria-label={t("worldCreatorRooms.profileSlugAria")}
                data-testid="world-profile-create-slug"
                className={inputCls(isLight)}
                placeholder="your-handle"
                maxLength={40}
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(normalizeCreatorSlug(e.target.value));
                }}
              />
              {checkLine ? (
                <p
                  data-testid="world-profile-slug-check"
                  className={`mt-1 text-xs font-semibold ${
                    slugCheck.kind === "available"
                      ? isLight
                        ? "text-emerald-800"
                        : "text-emerald-300"
                      : slugCheck.kind === "taken" || slugCheck.kind === "invalid"
                        ? isLight
                          ? "text-[#92600a]"
                          : "text-amber-300"
                        : muted
                  }`}
                >
                  {checkLine}
                </p>
              ) : null}
            </div>
            <textarea
              aria-label={t("worldCreatorRooms.profileBioAria")}
              data-testid="world-profile-create-bio"
              className={inputCls(isLight)}
              rows={2}
              maxLength={2000}
              placeholder={t("worldCreatorRooms.profileBioPlaceholder")}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
            />
            {/* One suggestion brain (lib/suggest): a starter bio derived
                from the name + vertical already on this form. Offered,
                never forced — it only appears while the bio is empty
                and the member has given the form a name to work from. */}
            {!bio.trim() && displayName.trim() ? (() => {
              const suggested = profileCreateSuggestedBio({ displayName, vertical });
              return suggested ? (
                <button
                  type="button"
                  data-testid="world-profile-create-suggested-bio"
                  onClick={() => setBio(suggested)}
                  className={`text-left text-xs font-semibold underline decoration-dotted underline-offset-2 ${isLight ? "text-[#7A5A12]" : "text-[#d4af37]"}`}
                >
                  {t("worldCreatorRooms.profileSuggestedBio")}
                </button>
              ) : null;
            })() : null}
            <select
              aria-label={t("worldCreatorRooms.profileVerticalAria")}
              data-testid="world-profile-create-vertical"
              className={inputCls(isLight)}
              style={{ colorScheme: isLight ? "light" : "dark" }}
              value={vertical}
              onChange={(e) => setVertical(e.target.value)}
            >
              {CREATOR_PROFILE_VERTICALS.map((v) => (
                <option key={v.key} value={v.key}>
                  {verticalLabel(v.key)}
                </option>
              ))}
            </select>
            {error ? (
              <p data-testid="world-profile-create-error" className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
                {error}
              </p>
            ) : null}
            <button
              type="button"
              data-testid="world-profile-create-submit"
              onClick={create}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target"
            >
              <Crown className="h-4 w-4" /> {busy ? t("worldCreatorRooms.profileClaiming") : t("worldCreatorRooms.profileCreateSubmit")}
            </button>
          </div>
        )}
      </div>
    </NativeCard>
  );
}
