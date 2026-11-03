/* ─── ONE SUGGESTION BRAIN (stack1400 org/design wave #2, audit §3.3) ──
   The single suggestion layer every profile surface reads.

   Audit §3.3 (org-design-tightening-audit-2026-11-02) named this file
   `suggest.ts` and three surfaces that ignore it — but at the wave's
   base (34fdb87aa) NO file by that name existed anywhere in the repo
   or its git history, and no `caption_style` column exists either
   (verified by git ls-files / git grep census, 2026-11-03). The raw
   profile columns the audit meant are the ones the surfaces actually
   read today: the Vault's genre / personality / visual_style /
   voice_style fields and the creator profile's vertical / bio.
   So the brain is built here, for real, and the three surfaces are
   routed through it:

     1. Onboarding / first-run profile setup — pages/artist-setup.tsx
        (was: name + avatar prefilled from the Vault, bio left blank)
     2. Vault profile editor — pages/artist-vault.tsx
        (was: the description field started blank and stayed blank
        unless the creator wrote one from scratch)
     3. World room profile — components/world/native/
        CreatorProfileCreate.tsx via lib/world/creator-profile-create.ts
        (was: the in-World bio field started blank, always)

   The brain is DETERMINISTIC and FREE — house starter suggestions
   derived only from fields the profile itself carries, in the
   collab-match tradition (no AI call, no credits, nothing invented
   beyond the creator's own name / genre / vertical / style words).
   Every suggestion is a starting point the creator edits; surfaces
   label it as a suggestion and never write it over text the creator
   already has.

   Fallback law (never an empty lie): when the profile carries no
   usable signal the brain returns null, and each surface falls back
   to exactly what it did before — the raw profile value when one
   exists, otherwise its existing honest empty state. */

/** The profile fields the brain may read — the union of what the
 *  three surfaces already hold. All optional; the brain works with
 *  whatever subset a surface has. */
export interface SuggestionProfile {
  displayName?: string | null;
  genre?: string | null;
  vertical?: string | null;
  personality?: string | null;
  visualStyle?: string | null;
  voiceStyle?: string | null;
}

export interface ProfileSuggestions {
  /** First-3-seconds opening lines for the creator's next video. */
  hooks: string[];
  /** Post / video titles in the creator's lane. */
  titles: string[];
  /** Ready-to-post caption starters. */
  captions: string[];
  /** A one-paragraph profile bio built from the same fields. */
  bio: string;
  /** The topic line a paid generator (Hook Studio) would be fed —
   *  the brain's summary of what this creator makes. */
  topic: string;
}

/* What each vertical makes, in plain words — the creator profile's
   own vertical vocabulary (lib/artist-profiles VERTICALS). */
const VERTICAL_SUBJECT: Record<string, string> = {
  music: "music",
  video: "videos",
  gaming: "streams and clips",
  podcast: "podcast episodes",
  film: "films",
  tv: "series",
  influencer: "content",
  education: "lessons",
  other: "content",
};

function clean(v: string | null | undefined): string {
  return typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
}

/** The brain's subject for a profile: the genre when the profile
 *  names one, else what the vertical makes, else null (no signal). */
export function suggestionSubject(profile: SuggestionProfile): string | null {
  const genre = clean(profile.genre);
  if (genre) return genre;
  const vertical = clean(profile.vertical).toLowerCase();
  return VERTICAL_SUBJECT[vertical] ?? null;
}

/**
 * The suggestions for a profile, or null when the profile carries no
 * usable signal at all (no name AND no genre/vertical) — callers fall
 * back to their raw profile value / honest empty state, never to an
 * invented suggestion.
 */
export function suggestionsForProfile(profile: SuggestionProfile): ProfileSuggestions | null {
  const name = clean(profile.displayName);
  const subject = suggestionSubject(profile);
  if (!name && !subject) return null;

  const who = name || "This creator";
  const lane = subject ?? "content";
  const personality = clean(profile.personality);
  const visualStyle = clean(profile.visualStyle);
  const voiceStyle = clean(profile.voiceStyle);

  const topic = subject
    ? name
      ? `${name} — ${lane}`
      : lane
    : name;

  const hooks = [
    `Nobody is making ${lane} like this — watch.`,
    name
      ? `${name} here — this is the one you've been waiting for.`
      : `This is the one you've been waiting for.`,
    `I stopped scrolling for this ${lane} moment. You will too.`,
  ];

  const titles = [
    subject ? `${cap(lane)} — the ${who} way` : `${who} — new drop`,
    `Behind the scenes: how ${who} makes it`,
    `${who} — the next chapter`,
  ];

  const captions = [
    subject
      ? `New ${lane} from ${who}. Full piece on my profile — link's right there.`
      : `New drop from ${who}. Full piece on my profile — link's right there.`,
    `Made this one for the day-ones. ${who}, always.`,
  ];

  /* Bio: only the profile's own words, composed. Personality and
     style lines ride only when the profile actually carries them. */
  const bioLines = [
    subject ? `${who} makes ${lane}.` : `${who} creates.`,
    personality ? cap(personality) + (personality.endsWith(".") ? "" : ".") : "",
    visualStyle || voiceStyle
      ? `Signature look & sound: ${[visualStyle, voiceStyle].filter(Boolean).join(" · ")}.`
      : "",
    "New drops, behind-the-scenes, and the work in progress — follow along.",
  ].filter(Boolean);

  return { hooks, titles, captions, bio: bioLines.join(" "), topic };
}

function cap(s: string): string {
  return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Just the bio suggestion, or null — the shape the three profile
 *  surfaces consume. */
export function suggestedBioForProfile(profile: SuggestionProfile): string | null {
  return suggestionsForProfile(profile)?.bio ?? null;
}

/**
 * The prefill rule every surface shares: a field the creator already
 * filled is NEVER overwritten by a suggestion; an empty field takes
 * the suggestion when the brain has one, and otherwise keeps its
 * current (empty / raw-profile) value — the honest fallback.
 */
export function prefillWithSuggestion(current: string, suggestion: string | null): string {
  if (current.trim().length > 0) return current;
  return suggestion ?? current;
}
