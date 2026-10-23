import { useEffect, useRef, useState } from "react";
import { BadgeCheck, Crown } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { NativeCard } from "./NativeCard";
import { NativeLoadingState } from "./NativeStates";
import {
  CREATOR_PROFILE_VERTICALS,
  buildCreatorProfilePayload,
  creatorProfileErrorLine,
  creatorProfileFormProblem,
  creatorSlugProblem,
  normalizeCreatorSlug,
  parseMyCreatorProfile,
  parseSlugCheck,
  slugCheckLine,
  slugifyCreatorSlug,
  type MyCreatorProfile,
  type SlugCheckState,
} from "@/lib/world/creator-profile-create";

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
  `w-full rounded-xl border px-3 py-2 text-sm outline-none transition focus:border-[#d4af37] ${
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
    if (creatorSlugProblem(candidate)) {
      setSlugCheck({ kind: "invalid", slug: candidate, message: creatorSlugProblem(candidate)! });
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
          setSlugCheck({ kind: "invalid", slug: candidate, message: "The handle check didn't answer — try again." });
          return;
        }
        setSlugCheck(parseSlugCheck(await res.json().catch(() => null), candidate));
      } catch {
        if (seq === checkSeq.current) {
          setSlugCheck({ kind: "invalid", slug: candidate, message: "The handle check didn't answer — try again." });
        }
      }
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, state]);

  const create = async () => {
    if (busy) return;
    const problem = creatorProfileFormProblem({ displayName, slug, slugCheck });
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
        setError(creatorProfileErrorLine(data, "Your profile couldn't be created — try again."));
        // A 409 means the handle went between check and create:
        // re-run the live check so the form says so plainly.
        if (res.status === 409) {
          setSlugCheck({ kind: "taken", slug: normalizeCreatorSlug(slug) });
        }
        return;
      }
      const profile = parseMyCreatorProfile(data);
      if (!profile) {
        setError("The profile was created but didn't read back — reload this panel before publishing.");
        return;
      }
      setMine(profile);
      setState("has");
      onCreated?.(profile);
    } catch {
      setError("The profile desk didn't answer. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (state === "hidden") return null;

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const checkLine = slugCheckLine(slugCheck);

  return (
    <NativeCard isLight={isLight} title="Your creator profile">
      <div data-testid="world-profile-create-card">
        {state === "loading" ? (
          <NativeLoadingState isLight={isLight} message="Checking your creator profile…" />
        ) : state === "failed" ? (
          <p className={`text-sm ${muted}`}>
            Your creator profile wouldn't load just now — publishing needs it, so try this panel again in a moment.
          </p>
        ) : state === "has" && mine ? (
          <div className="space-y-1" data-testid="world-profile-mine">
            <p className={`inline-flex items-center gap-2 text-sm font-black ${strong}`}>
              <BadgeCheck className="h-4 w-4 text-[#d4af37]" /> {mine.displayName}
            </p>
            <p className={`text-xs ${muted}`}>
              @{mine.slug} · {CREATOR_PROFILE_VERTICALS.find((v) => v.key === mine.vertical)?.label ?? mine.vertical} —
              your profile is live, and everything you publish lands on it.
            </p>
          </div>
        ) : (
          <div className="space-y-2" data-testid="world-profile-create-form">
            <p className={`text-sm ${muted}`}>
              {compact
                ? "Publishing needs a creator profile — claim yours right here and the publish goes through without leaving the World. It's free."
                : "You don't have a creator profile yet. Claim yours right here — it's free, and everything you publish in the World lands on it."}
            </p>
            <input
              aria-label="Display name"
              data-testid="world-profile-create-name"
              className={inputCls(isLight)}
              placeholder="Display name (e.g. King Shark)"
              maxLength={80}
              value={displayName}
              onChange={(e) => {
                setDisplayName(e.target.value);
                if (!slugTouched) setSlug(slugifyCreatorSlug(e.target.value));
              }}
            />
            <div>
              <input
                aria-label="Your handle"
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
              aria-label="Bio"
              data-testid="world-profile-create-bio"
              className={inputCls(isLight)}
              rows={2}
              maxLength={2000}
              placeholder="Bio — who you are, what you make"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
            />
            <select
              aria-label="What you make"
              data-testid="world-profile-create-vertical"
              className={inputCls(isLight)}
              style={{ colorScheme: isLight ? "light" : "dark" }}
              value={vertical}
              onChange={(e) => setVertical(e.target.value)}
            >
              {CREATOR_PROFILE_VERTICALS.map((v) => (
                <option key={v.key} value={v.key}>
                  {v.label}
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
              className="inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50"
            >
              <Crown className="h-4 w-4" /> {busy ? "Claiming…" : "Create my creator profile — free"}
            </button>
          </div>
        )}
      </div>
    </NativeCard>
  );
}
